// Colour matching across sources: shots from different cameras or phones are brought toward one
// reference source, so a cut between them does not jump in white balance, exposure, contrast or
// saturation.
//
// Each source is measured on frames sampled from the clips the edit uses, as the render shows
// them after their auto grade. The correction is a camera's own pipeline run backwards: a
// saturation matrix, then a gain and offset per channel, which covers white balance, exposure and
// contrast. It is fitted so that the distribution of each channel matches the reference's, which
// needs no pixel of one source to correspond to a pixel of the other. Two sources that show
// different things, such as a screen recording and a face, cannot be matched that way: their
// distributions differ in shape, not by a camera's correction, and they are left as they are.

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Grade, type Project, TICKS_PER_SECOND } from "@video-editor/schema";
import { ffmpeg, run } from "./ffmpeg.ts";
import { sampleRate } from "./grade.ts";
import { QUIET } from "./graph/encode.ts";
import { decimal } from "./graph/inputs.ts";
import { colour, fill } from "./graph/video.ts";
import { loadSources, type SourceFacts } from "./sources.ts";

/** Pixels of one clip as the render shows them before the match and look: R'G'B' triplets in 8
 * bits. */
export type ColourSample = Uint8Array;

type Vector = [number, number, number];
type Matrix = [Vector, Vector, Vector];

export interface MatchFit {
  /** rgb' = matrix × rgb + offset, on normalised R'G'B'. */
  matrix: Matrix;
  offset: Vector;
  /** The saturation multiplier and the gain per channel the matrix is made of. */
  saturation: number;
  gains: Vector;
  /** How far the matched channel distributions still lie from the reference's: the root mean
   * square difference of their quantiles, 0 to 1. */
  residual: number;
}

/** Frames are measured at this size, with the output's shape: enough pixels for the
 * distributions, few enough to keep the measurement quick. */
const SAMPLE_LONG_SIDE = 128;
/** Pixels kept per clip and per source. */
const CLIP_PIXELS = 6_000;
const SOURCE_PIXELS = 30_000;
/** Quantiles compared, 2 % to 98 %. */
const LEVELS = Array.from({ length: 49 }, (_, i) => 0.02 + i * 0.02);
/** Quantiles within this of black or white are clipped in one source but not the other, so they
 * say nothing about the correction. */
const CLIPPED = 0.01;
// BT.709 luma, which the saturation matrix keeps.
const LUMA: Vector = [0.2126, 0.7152, 0.0722];

/** Above this residual, after the best correction, the two sources show different things: one
 * scene through two cameras fits far below it, and different footage far above, even footage
 * drawn with the same colours (packages/engine/README.md#matching). */
export const MAX_RESIDUAL = 0.02;
/** A correction larger than this is no camera's difference: about a stop and a half of exposure
 * or white balance, a third more or less saturation. */
const GAINS = [0.67, 1.5] as const;
const BALANCE = [0.67, 1.5] as const;
const SATURATION = [0.7, 1.4] as const;
const OFFSET = 0.15;

/** Samples a clip's picture as the render shows it after its auto grade: frames spread over it
 * as the auto grade samples them, framed into a small box of the output's shape. */
async function measureColour(
  source: SourceFacts,
  clip: { in: number; out: number; framing?: Project["main"][number]["framing"]; grade?: Grade },
  aspect: { width: number; height: number },
): Promise<ColourSample> {
  const seconds = (clip.out - clip.in) / TICKS_PER_SECOND;
  const long = Math.max(aspect.width, aspect.height);
  const even = (side: number) => Math.max(2, Math.round((side * SAMPLE_LONG_SIDE) / long / 2) * 2);
  const box = { width: even(aspect.width), height: even(aspect.height) };
  const auto = clip.grade?.auto;
  const rate = sampleRate(seconds);
  // fps runs first, so a crop path moves with the sampled frames' own source times.
  const span = {
    start: clip.in,
    frames: Math.ceil(seconds * rate),
    frameTicks: TICKS_PER_SECOND / rate,
  };
  const filters = [
    `fps=${decimal(rate)}`,
    ...fill(clip.framing, box, source, span),
    ...colour(auto ? { auto } : undefined),
    "scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags=accurate_rnd+full_chroma_int",
    "format=rgb24",
  ];
  const dir = await mkdtemp(join(tmpdir(), "colour-"));
  try {
    const raw = join(dir, "frames.rgb");
    await run(await ffmpeg(), [
      ...QUIET,
      "-ss",
      decimal(clip.in / TICKS_PER_SECOND),
      "-i",
      source.path,
      "-t",
      decimal(seconds),
      "-vf",
      filters.join(","),
      "-an",
      "-f",
      "rawvideo",
      raw,
    ]);
    return thin(new Uint8Array(await readFile(raw)), CLIP_PIXELS);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** At most `pixels` pixels, taken evenly through the sample. */
function thin(sample: ColourSample, pixels: number): ColourSample {
  const count = sample.length / 3;
  if (count <= pixels) return sample;
  const out = new Uint8Array(pixels * 3);
  for (let i = 0; i < pixels; i++) {
    const from = Math.floor((i * count) / pixels) * 3;
    out.set(sample.subarray(from, from + 3), i * 3);
  }
  return out;
}

/** The luma-keeping saturation matrix: `k` times each colour's difference from its luma. */
function saturationMatrix(k: number): Matrix {
  return [0, 1, 2].map((row) =>
    [0, 1, 2].map((col) => (row === col ? k : 0) + (1 - k) * (LUMA[col] as number)),
  ) as Matrix;
}

/** Sorted copies of each channel. */
function channels(pixels: Float64Array[]): Float64Array[] {
  return pixels.map((channel) => Float64Array.from(channel).sort());
}

const quantile = (sorted: Float64Array, level: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(level * sorted.length))] as number;

function unpack(sample: ColourSample): Float64Array[] {
  const count = sample.length / 3;
  const out = [new Float64Array(count), new Float64Array(count), new Float64Array(count)];
  for (let i = 0; i < count; i++) {
    for (let c = 0; c < 3; c++) (out[c] as Float64Array)[i] = (sample[i * 3 + c] as number) / 255;
  }
  return out;
}

/**
 * The correction that brings `source` toward `reference`: for each saturation tried, the gain
 * and offset per channel that best map the source's quantiles onto the reference's, by least
 * squares; the saturation whose fit leaves the smallest residual wins. Only a difference that a
 * camera's pipeline makes maps every quantile at once.
 */
export function solveMatch(source: ColourSample, reference: ColourSample): MatchFit {
  const x = unpack(source);
  const xSorted = channels(x);
  const refSorted = channels(unpack(reference));
  const valid = (c: number) =>
    LEVELS.filter((level) =>
      [
        quantile(xSorted[c] as Float64Array, level),
        quantile(refSorted[c] as Float64Array, level),
      ].every((v) => v > CLIPPED && v < 1 - CLIPPED),
    );
  const levels = [0, 1, 2].map(valid);
  const count = (x[0] as Float64Array).length;

  const fitAt = (k: number) => {
    const s = saturationMatrix(k);
    const y = [0, 1, 2].map((row) => {
      const out = new Float64Array(count);
      const [a, b, c] = s[row] as Vector;
      const [r, g, bl] = x as [Float64Array, Float64Array, Float64Array];
      for (let i = 0; i < count; i++) {
        out[i] = a * (r[i] as number) + b * (g[i] as number) + c * (bl[i] as number);
      }
      return out.sort();
    });
    let squares = 0;
    let points = 0;
    const gains: number[] = [];
    const offsets: number[] = [];
    for (let c = 0; c < 3; c++) {
      const used = levels[c] as number[];
      const from = used.map((level) => quantile(y[c] as Float64Array, level));
      const to = used.map((level) => quantile(refSorted[c] as Float64Array, level));
      const [gain, offset] = line(from, to);
      gains.push(gain);
      offsets.push(offset);
      for (const [i, v] of from.entries()) squares += (gain * v + offset - (to[i] as number)) ** 2;
      points += used.length;
    }
    return { k, s, gains, offsets, residual: points > 0 ? Math.sqrt(squares / points) : 1 };
  };

  // Golden-section search over the saturation, on a log scale so halving and doubling weigh the
  // same.
  let [low, high] = [Math.log(0.5), Math.log(2)];
  const golden = (Math.sqrt(5) - 1) / 2;
  let a = high - golden * (high - low);
  let b = low + golden * (high - low);
  let fa = fitAt(Math.exp(a));
  let fb = fitAt(Math.exp(b));
  for (let step = 0; step < 30; step++) {
    if (fa.residual <= fb.residual) {
      high = b;
      b = a;
      fb = fa;
      a = high - golden * (high - low);
      fa = fitAt(Math.exp(a));
    } else {
      low = a;
      a = b;
      fa = fb;
      b = low + golden * (high - low);
      fb = fitAt(Math.exp(b));
    }
  }
  const best = fa.residual <= fb.residual ? fa : fb;
  const matrix = best.s.map((row, c) =>
    row.map((v) => round(v * (best.gains[c] as number))),
  ) as Matrix;
  return {
    matrix,
    offset: best.offsets.map(round) as Vector,
    saturation: round(best.k),
    gains: best.gains.map(round) as Vector,
    residual: best.residual,
  };
}

/** The least-squares line through points. */
function line(from: number[], to: number[]): [number, number] {
  const n = from.length;
  if (n < 2) return [1, 0];
  const mx = from.reduce((s, v) => s + v, 0) / n;
  const my = to.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const [i, v] of from.entries()) {
    sxy += (v - mx) * ((to[i] as number) - my);
    sxx += (v - mx) ** 2;
  }
  if (sxx < 1e-9) return [1, my - mx];
  const gain = sxy / sxx;
  return [gain, my - gain * mx];
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;

/** Why a fit is not used, or null when it is. */
export function matchProblem(fit: MatchFit): string | null {
  if (fit.residual > MAX_RESIDUAL) {
    return `its colours differ from the reference's in shape (residual ${fit.residual.toFixed(3)}), so the two show different things`;
  }
  const [r, g, b] = fit.gains;
  const inside = (v: number, [low, high]: readonly [number, number]) => v >= low && v <= high;
  if (
    !fit.gains.every((gain) => inside(gain, GAINS)) ||
    !inside(r / g, BALANCE) ||
    !inside(b / g, BALANCE) ||
    !inside(fit.saturation, SATURATION) ||
    fit.offset.some((v) => Math.abs(v) > OFFSET)
  ) {
    return "the correction it needs is larger than any camera's difference";
  }
  return null;
}

/** Whether a fit changes any colour by at least half an 8-bit level. */
function moves(fit: MatchFit): boolean {
  for (const corner of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const rgb = [corner & 1, (corner >> 1) & 1, (corner >> 2) & 1];
    for (const [c, row] of fit.matrix.entries()) {
      const [r, g, b] = rgb as Vector;
      const out = row[0] * r + row[1] * g + row[2] * b + fit.offset[c as 0 | 1 | 2];
      if (Math.abs(out - (rgb[c] as number)) >= 0.5 / 255) return true;
    }
  }
  return false;
}

export interface MatchReport {
  source: string;
  reference: string;
  fit: MatchFit;
  /** Why it was left unmatched, or null when its clips now carry the match. */
  problem: string | null;
}

/**
 * Matches every video source on the main track to the one it uses longest, writing `grade.match`
 * on each clip of a source whose fit is used, B-roll included, and removing it from the others.
 * `samples` caches each clip's measurement by everything it depends on, so measuring again after
 * a change measures only the clips that changed.
 */
export async function matchColour(
  project: Project,
  projectPath: string,
  samples = new Map<string, ColourSample>(),
): Promise<{ project: Project; reports: MatchReport[] }> {
  const kinds = new Map(project.sources.map((source) => [source.id, source.kind]));
  const files = new Map(project.sources.map((source) => [source.id, source.fingerprint.sha256]));
  const { width, height } = project.output;
  // Loaded only to measure: it checks every file's SHA-256.
  let sources: Map<string, SourceFacts> | undefined;
  const pooled = new Map<string, ColourSample[]>();
  const seconds = new Map<string, number>();
  const videos = project.main.filter((clip) => kinds.get(clip.source) === "video");
  // One source has nothing to match against, so it is not decoded.
  const several = new Set(videos.map((clip) => clip.source)).size > 1;
  for (const clip of several ? videos : []) {
    const auto = clip.grade?.auto;
    const key = JSON.stringify([
      clip.source,
      files.get(clip.source),
      clip.in,
      clip.out,
      clip.framing?.crop,
      auto,
      width,
      height,
    ]);
    let sample = samples.get(key);
    if (!sample) {
      sources ??= await loadSources(project, projectPath);
      const source = sources.get(clip.source);
      if (!source) throw new Error(`No source ${clip.source}`);
      // Measured without its punch-in, which shows the same colours.
      const framing = clip.framing?.crop ? { crop: clip.framing.crop } : undefined;
      sample = await measureColour(source, { ...clip, framing }, project.output);
      samples.set(key, sample);
    }
    pooled.set(clip.source, [...(pooled.get(clip.source) ?? []), sample]);
    seconds.set(clip.source, (seconds.get(clip.source) ?? 0) + clip.out - clip.in);
  }
  const reference = [...seconds.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const reports: MatchReport[] = [];
  const matches = new Map<string, NonNullable<Grade["match"]>>();
  if (reference) {
    const target = pool(pooled.get(reference) ?? []);
    for (const [id, list] of pooled) {
      if (id === reference) continue;
      const fit = solveMatch(pool(list), target);
      const problem = matchProblem(fit);
      reports.push({ source: id, reference, fit, problem });
      if (!problem && moves(fit)) {
        matches.set(id, { reference, matrix: fit.matrix, offset: fit.offset });
      }
    }
  }
  const matched = <C extends { source: string; grade?: Grade }>(clip: C): C => {
    const { match: _, ...rest } = clip.grade ?? {};
    const match = matches.get(clip.source);
    const grade: Grade = match ? { ...rest, match } : rest;
    const { grade: __, ...plain } = clip;
    return (Object.keys(grade).length > 0 ? { ...plain, grade } : plain) as C;
  };
  return {
    project: {
      ...project,
      main: project.main.map(matched) as Project["main"],
      ...(project.broll ? { broll: project.broll.map(matched) } : {}),
    },
    reports,
  };
}

/** One source's clip samples as one, thinned to SOURCE_PIXELS. */
function pool(list: readonly ColourSample[]): ColourSample {
  const out = new Uint8Array(list.reduce((sum, sample) => sum + sample.length, 0));
  let at = 0;
  for (const sample of list) {
    out.set(sample, at);
    at += sample.length;
  }
  return thin(out, SOURCE_PIXELS);
}
