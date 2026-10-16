// The finished mix: loudness normalisation of the whole edit's sound, written to its own PCM file
// before encoding, because loudnorm holds back seconds of sound when it falls back to dynamic
// mode, and the encoder must start its sound with no delay (see ./encode.ts). The music bed is
// added before the loudness stage, so the measurement covers it.

import type { Project } from "@video-editor/schema";
import { SAMPLE_RATE } from "../timeline.ts";
import { decimal } from "./inputs.ts";

type Target = Project["audio"]["loudness"];

/** What loudnorm's first pass prints with print_format=json. */
export interface Measurement {
  input_i: number;
  input_tp: number;
  input_lra: number;
  input_thresh: number;
  target_offset: number;
}

/** The loudness range loudnorm aims at when it has to fall back from linear gain; EBU R128's
 * suggested maximum for most programmes. */
const RANGE_LU = 11;

/** The first pass: measures the mix against the target without changing it. */
export function measureLoudness(target: Target): string {
  return `loudnorm=I=${target.integratedLufs}:TP=${target.truePeakDbtp}:LRA=${RANGE_LU}:print_format=json`;
}

/** Reads the measurement from the first pass's log, where loudnorm prints it last. */
export function parseMeasurement(log: string): Measurement {
  const start = log.lastIndexOf("{");
  const end = log.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("loudnorm printed no measurement");
  const json = JSON.parse(log.slice(start, end + 1)) as Record<string, string>;
  const value = (key: keyof Measurement) => {
    const text = json[key];
    if (text === undefined) throw new Error(`loudnorm's measurement lacks ${key}`);
    // loudnorm prints C's "inf" and "-inf" for silence, which Number reads as NaN.
    if (/^[+-]?inf$/.test(text)) return text.startsWith("-") ? -Infinity : Infinity;
    return Number(text);
  };
  return {
    input_i: value("input_i"),
    input_tp: value("input_tp"),
    input_lra: value("input_lra"),
    input_thresh: value("input_thresh"),
    target_offset: value("target_offset"),
  };
}

/** A limiter on the sound oversampled 4×, so it holds the peaks between samples too, with its
 * look-ahead's delay taken out. */
function truePeakLimiter(ceilingDb: number): string[] {
  const limit = decimal(10 ** (ceilingDb / 20));
  return [
    `aresample=${4 * SAMPLE_RATE}`,
    `alimiter=limit=${limit}:attack=1:release=50:level=0:latency=1`,
    `aresample=${SAMPLE_RATE}`,
  ];
}

/** Measures the true peak, 4× oversampled as BS.1770 asks. */
export const truePeakFilter = "ebur128=peak=true";

/** The true peak in dBTP from the log of a run through truePeakFilter; -Infinity for silence. */
export function parseTruePeak(log: string): number {
  const text = /True peak:\s+Peak:\s+(\S+) dBFS/.exec(log)?.[1];
  if (text === undefined) throw new Error("ebur128 printed no true peak");
  return text === "-inf" ? -Infinity : Number(text);
}

/** Whether the second pass can reach the target with one gain, within the true-peak ceiling. */
export function linearReach(measured: Measurement, target: Target): boolean {
  return measured.input_tp + target.integratedLufs - measured.input_i <= target.truePeakDbtp;
}

/**
 * The second pass: a linear gain to the target, from the first pass's measurement, so the mix
 * keeps its dynamics. loudnorm itself falls back to dynamic normalisation when that gain would
 * push the true peak over the target. Silence measures -inf, which loudnorm rejects; there is
 * nothing to normalise, so it passes through. Either way the mix leaves with exactly `samples`
 * samples.
 *
 * Neither loudnorm's limiter nor the AAC encoder after it holds the true peak: sharp transients
 * in noise come out above the target. `ceilingDb` adds a true-peak limiter after loudnorm, its
 * ceiling in dBTP, which the render lowers until the encoded sound meets the target.
 */
export function masterAudio(
  input: string,
  measured: Measurement | null,
  target: Target,
  samples: number,
  ceilingDb?: number,
): string {
  const audible =
    measured && Object.values(measured).every(Number.isFinite) && measured.input_i > -70;
  const range = audible ? Math.min(50, Math.max(RANGE_LU, Math.ceil(measured.input_lra))) : 0;
  // loudnorm takes back a measured loudness below 0 LUFS only, and at exactly 0 gives up its
  // linear gain. A hotter mix (a full-scale square wave measures +3) is turned down to -1 LUFS
  // first, and its measurement with it, so the gain to the target is the same.
  const down = audible ? Math.min(0, -1 - measured.input_i) : 0;
  const at = (level: number) => decimal(level + down);
  const normalise = audible
    ? [
        ...(down < 0 ? [`volume=${decimal(down)}dB`] : []),
        `loudnorm=I=${target.integratedLufs}:TP=${target.truePeakDbtp}:LRA=${range}` +
          `:measured_I=${at(measured.input_i)}:measured_TP=${at(measured.input_tp)}` +
          `:measured_LRA=${measured.input_lra}:measured_thresh=${at(measured.input_thresh)}` +
          `:offset=${measured.target_offset}:linear=true`,
        // Dynamic mode works at 192 kHz.
        `aresample=${SAMPLE_RATE}`,
        ...(ceilingDb === undefined ? [] : truePeakLimiter(ceilingDb)),
      ]
    : [];
  return [
    `${input}${normalise.length > 0 ? normalise.join(",") : "anull"}`,
    // Counted in samples from here on: loudnorm's flush at the end can leave a jump in time.
    `asettb=1/${SAMPLE_RATE}`,
    "asetpts=N",
    `atrim=end_sample=${samples}`,
    `apad=whole_len=${samples}`,
  ].join(",");
}
