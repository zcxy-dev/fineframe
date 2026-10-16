import { type Grade, type Project, TICKS_PER_SECOND } from "@video-editor/schema";
import { ffmpeg, run } from "./ffmpeg.ts";
import { QUIET } from "./graph/encode.ts";
import { decimal } from "./graph/inputs.ts";
import { toneMap } from "./graph/video.ts";
import { loadSources, type SourceFacts } from "./sources.ts";

export type AutoGrade = NonNullable<Grade["auto"]>;

/** Picture statistics of a clip, each from 0 to 1. */
export interface PictureStats {
  /** Mean luma. */
  luma: number;
  /** Mean of each frame's luma range, maximum minus minimum. */
  range: number;
  /** Mean saturation. */
  saturation: number;
}

/** Reads FFmpeg's signalstats of 8-bit frames from `metadata=print` output, scaled to 0..1.
 * Scaling by 2^YBITDEPTH - 1 would be wrong: YBITDEPTH counts the bits the picture uses, so a dark
 * frame reads 7 and measures twice as bright; measurePicture converts to 8 bits instead. Null
 * when no frame was measured. */
export function parseSignalstats(text: string): PictureStats | null {
  const values = (key: string) =>
    [...text.matchAll(new RegExp(`lavfi\\.signalstats\\.${key}=([0-9.]+)`, "g"))].map((match) =>
      Number(match[1]),
    );
  const mean = (list: number[]) => list.reduce((sum, value) => sum + value, 0) / list.length;
  const averages = values("YAVG");
  if (averages.length === 0) return null;
  const top = 255;
  const minima = values("YMIN");
  const maxima = values("YMAX");
  const saturation = values("SATAVG");
  return {
    luma: mean(averages) / top,
    range: minima.length && maxima.length ? (mean(maxima) - mean(minima)) / top : 0.7,
    saturation: saturation.length ? mean(saturation) / top : 0.25,
  };
}

/**
 * A subtle correction that makes a clip look clean, not graded: it lifts dark footage, adds a
 * little contrast to flat footage and a little saturation to very flat colour, and never shifts
 * hue. Every value stays within a few percent of 1.
 */
export function gradeFromStats(stats: PictureStats): AutoGrade {
  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
  const along = (value: number, from: number, to: number) =>
    clamp((value - from) / (to - from), 0, 1);

  // Aim for a luma range of about 0.72: boost flat footage gently, never reduce contrast.
  const contrast = stats.range < 0.65 ? 1.08 - 0.05 * along(stats.range, 0.5, 0.65) : 1.03;
  // Aim for a mean luma of about 0.48: lift dark footage, pull overexposed footage back a touch.
  let gamma = 1;
  if (stats.luma < 0.42) gamma = 1.1 - 0.08 * along(stats.luma, 0.3, 0.42);
  else if (stats.luma > 0.6) gamma = 0.97;
  // Most digital video is a little oversaturated on consumer screens, so the default pulls back.
  let saturation = 0.98;
  if (stats.saturation < 0.18) saturation = 1.04;
  else if (stats.saturation > 0.38) saturation = 0.96;

  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    contrast: round(clamp(contrast, 0.94, 1.08)),
    gamma: round(clamp(gamma, 0.94, 1.1)),
    saturation: round(clamp(saturation, 0.94, 1.06)),
  };
}

/** Frames a second to sample a stretch of `seconds` at: ten frames spread over it, or one every
 * two seconds of a stretch over 20 s, and at most ten a second. */
export function sampleRate(seconds: number): number {
  return Math.max(0.5, Math.min(10 / Math.max(seconds, 0.1), 10));
}

/** The statistics of frames spread over `seconds` from `start` (sampleRate), measured in 8 bits
 * after tone mapping, as the render will show them. */
export async function measurePicture(
  source: SourceFacts,
  start: number,
  seconds: number,
): Promise<PictureStats | null> {
  const still = source.kind === "image";
  // An image is one frame with no duration, which the fps filter drops.
  const sample = still ? [] : [`fps=${decimal(sampleRate(seconds))}`];
  const filters = [...toneMap(source.hdr), ...sample, "format=yuv420p", "signalstats"];
  const range = still
    ? ["-i", source.path, "-frames:v", "1"]
    : ["-ss", decimal(start), "-i", source.path, "-t", decimal(seconds)];
  const { stdout } = await run(await ffmpeg(), [
    ...QUIET,
    ...range,
    "-vf",
    `${filters.join(",")},metadata=print:file=-`,
    "-an",
    "-f",
    "null",
    "-",
  ]);
  return parseSignalstats(stdout);
}

/**
 * Measures every main-track and B-roll clip and writes its correction into `grade.auto`,
 * leaving the rest of each grade as it is. The planner calls this before rendering.
 */
export async function autoGrade(project: Project, projectPath: string): Promise<Project> {
  const sources = await loadSources(project, projectPath);
  const graded = async <C extends { source: string; in: number; out: number; grade?: Grade }>(
    clip: C,
  ): Promise<C> => {
    const source = sources.get(clip.source);
    if (!source) throw new Error(`No source ${clip.source}`);
    const start = clip.in / TICKS_PER_SECOND;
    const stats = await measurePicture(source, start, (clip.out - clip.in) / TICKS_PER_SECOND);
    if (!stats) return clip;
    return { ...clip, grade: { ...clip.grade, auto: gradeFromStats(stats) } };
  };
  // One measurement at a time: each decodes a stretch of footage.
  const main = [];
  for (const clip of project.main) main.push(await graded(clip));
  const broll = [];
  for (const clip of project.broll ?? []) broll.push(await graded(clip));
  return {
    ...project,
    main: main as Project["main"],
    ...(project.broll ? { broll } : {}),
  };
}
