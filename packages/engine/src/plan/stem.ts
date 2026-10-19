// What a source's voice stem holds that its words do not say: speech the transcript missed, which
// no cut may fall in, and how sharply its sound jumps, which a cut must not start or end on.

import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { MediaIndex, Word } from "@video-editor/schema";
import { ffmpeg } from "../ffmpeg.ts";
import { QUIET } from "../graph/encode.ts";
import { PEAK_BLOCK, type PlaceSource } from "./place.ts";

const RATE = 48_000;
/** The denoised speech's level is read in frames this long, in seconds. */
const FRAME = 0.01;
/** Speech is where the denoised speech is within this many dB of the median level of the source's
 * words; in the footage measured (MEASUREMENTS.md), the denoiser leaves pauses 30 dB or more
 * under that level. */
const SPEECH_RANGE_DB = 20;
/** A dip in speech shorter than this is part of it, in seconds. */
const DIP = 0.03;
/** Speech shorter than this, in seconds, is a click or a breath and does not count. */
const SHORTEST = 0.05;

/** The speech no word covers, and the peaks a cut is checked against, of a source whose index has
 * a voice stem; none for one without speech. */
export async function stemMarks(
  index: MediaIndex,
  indexPath: string,
): Promise<Pick<PlaceSource, "unheard" | "peaks">> {
  if (!index.voice) return {};
  const path = resolve(dirname(indexPath), index.voice.stem);
  await access(path).catch(() => {
    throw new Error(`${indexPath}: ${path}, its voice stem, is missing; run vework analyze again`);
  });
  return readStem(path, index.transcript.words as Word[]);
}

/**
 * Reads a voice stem, the recording and its denoised speech side by side at 48 kHz from the
 * source's time zero, as vework writes it:
 *
 * - `unheard`: where the denoised speech holds speech (SPEECH_RANGE_DB) that no word covers,
 *   SHORTEST or longer, in seconds: words the transcript missed, or a word's sound it timed short.
 * - `peaks`: the largest second difference of the recording's samples in each PEAK_BLOCK, the
 *   jump `vebench render` reads a click by.
 */
export async function readStem(
  path: string,
  words: readonly Word[],
): Promise<{ unheard: [number, number][]; peaks: Float32Array }> {
  const frame = Math.round(FRAME * RATE);
  const block = Math.round(PEAK_BLOCK * RATE);
  const power: number[] = [];
  const peaks: number[] = [];
  let sum = 0;
  let peak = 0;
  let n = 0;
  let a = 0;
  let b = 0;
  let rest = Buffer.alloc(0);
  const child = spawn(
    await ffmpeg(),
    [...QUIET, "-i", path, "-map", "0:a:0", "-f", "f32le", "-ac", "2", "-ar", String(RATE), "-"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const err: Buffer[] = [];
  child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
  child.stdout.on("data", (chunk: Buffer) => {
    const data = rest.length > 0 ? Buffer.concat([rest, chunk]) : chunk;
    const whole = data.length - (data.length % 8);
    for (let at = 0; at < whole; at += 8) {
      const recorded = data.readFloatLE(at);
      const denoised = data.readFloatLE(at + 4);
      sum += denoised * denoised;
      if (n >= 2) peak = Math.max(peak, Math.abs(recorded - 2 * a + b));
      b = a;
      a = recorded;
      n++;
      if (n % frame === 0) {
        power.push(sum / frame);
        sum = 0;
      }
      if (n % block === 0) {
        peaks.push(peak);
        peak = 0;
      }
    }
    rest = Buffer.from(data.subarray(whole));
  });
  await new Promise<void>((done, fail) => {
    child.on("error", fail);
    child.on("close", (code) => {
      if (code === 0) done();
      else fail(new Error(`${path}: ffmpeg could not read it:\n${Buffer.concat(err).toString()}`));
    });
  });
  if (n % block > 0) peaks.push(peak);
  return { unheard: unheardSpeech(power, words), peaks: Float32Array.from(peaks) };
}

/** Where `power`, the denoised speech's mean square per FRAME, holds speech that no word covers. */
function unheardSpeech(power: readonly number[], words: readonly Word[]): [number, number][] {
  const db = power.map((p) => 10 * Math.log10(p + 1e-12));
  const covered = new Array<boolean>(db.length).fill(false);
  for (const word of words) {
    const last = Math.min(db.length, Math.ceil(word.end / FRAME));
    for (let k = Math.max(0, Math.floor(word.start / FRAME)); k < last; k++) covered[k] = true;
  }
  const said = db.filter((_, k) => covered[k]).sort((x, y) => x - y);
  if (said.length === 0) return [];
  const floor = (said[said.length >> 1] as number) - SPEECH_RANGE_DB;
  const speech = db.map((level) => level > floor);
  for (const [a, b] of runs(speech.map((on) => !on))) {
    if (a > 0 && b < speech.length && b - a < DIP / FRAME) speech.fill(true, a, b);
  }
  for (const [a, b] of runs(speech)) if (b - a < SHORTEST / FRAME) speech.fill(false, a, b);
  return runs(speech.map((on, k) => on && !covered[k]))
    .filter(([a, b]) => b - a >= SHORTEST / FRAME)
    .map(([a, b]) => [a * FRAME, b * FRAME]);
}

/** The runs of true in `flags`, as [first, past the last] indices. */
function runs(flags: readonly boolean[]): [number, number][] {
  const found: [number, number][] = [];
  for (let k = 0; k < flags.length; k++) {
    if (!flags[k]) continue;
    const start = k;
    while (k < flags.length && flags[k]) k++;
    found.push([start, k]);
  }
  return found;
}
