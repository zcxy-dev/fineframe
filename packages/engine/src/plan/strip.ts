// A filmstrip over a waveform for a stretch of video, with silences shaded and one moment
// marked: the picture a cut check reads, drawn by FFmpeg's tile and showwavespic filters.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ffmpeg, run } from "../ffmpeg.ts";
import { QUIET } from "../graph/encode.ts";
import { decimal } from "../graph/inputs.ts";

export const STRIP_FRAMES = 8;
const WIDTH = 1280;
const WAVE_HEIGHT = 160;
/** Gaps between words at least this long are shaded as silence. */
export const SILENCE = 0.4;

export interface StripOptions {
  /** Seconds into the video. */
  start: number;
  end: number;
  /** The moment to mark with a red line. */
  mark: number;
  /** Silences inside [start, end], in seconds. */
  silences: [number, number][];
  /** A sound file on the video's timeline to draw instead of the video's own sound, such as
   * the render's voice stem, so music under the speech does not fill its pauses. */
  audio?: string;
}

/** Writes the strip as a PNG in `dir` and returns its bytes. */
export async function cutStrip(video: string, dir: string, options: StripOptions): Promise<Buffer> {
  const { start, end, mark, silences, audio } = options;
  const seconds = end - start;
  const x = (t: number) => Math.round(((t - start) / seconds) * WIDTH);
  const boxes = silences.map(
    ([from, to]) =>
      `drawbox=x=${x(from)}:y=0:w=${Math.max(1, x(to) - x(from))}:h=${WAVE_HEIGHT}:color=0x3060c0@0.35:t=fill`,
  );
  const wave = [
    "aformat=channel_layouts=mono",
    `showwavespic=s=${WIDTH}x${WAVE_HEIGHT}:colors=0x8cb4ff:scale=sqrt`,
    "format=rgb24",
    ...boxes,
    `drawbox=x=${Math.max(0, x(mark) - 1)}:y=0:w=3:h=${WAVE_HEIGHT}:color=red:t=fill`,
  ];
  const strip = [
    `fps=${decimal(STRIP_FRAMES / seconds)}`,
    `scale=${WIDTH / STRIP_FRAMES}:-2`,
    "setsar=1",
    `tile=${STRIP_FRAMES}x1`,
    "format=rgb24",
  ];
  const out = join(dir, `strip-${mark.toFixed(3)}.png`);
  await run(await ffmpeg(), [
    ...QUIET,
    "-y",
    "-ss",
    decimal(start),
    "-t",
    decimal(seconds),
    "-i",
    video,
    ...(audio ? ["-ss", decimal(start), "-t", decimal(seconds), "-i", audio] : []),
    "-filter_complex",
    `[0:v]${strip.join(",")}[strip];[${audio ? 1 : 0}:a]${wave.join(",")}[wave];[strip][wave]vstack`,
    "-frames:v",
    "1",
    out,
  ]);
  return readFile(out);
}
