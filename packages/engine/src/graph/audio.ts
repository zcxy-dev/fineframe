// One clip's sound, as a chain of filters: clock, then fades and gain. A source with a voice
// decision goes through its chain (./voice.ts) between the clock and the span.

import { SAMPLE_RATE } from "../timeline.ts";
import { decimal } from "./inputs.ts";

/** Every chain ends in this layout, so spans from any source mix and join. */
const FORMAT = `aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo`;

/** Raised-cosine fades at cuts: they start and end with zero slope, so the splice has no corner
 * to click, where a quarter-sine fade starts steeply (packages/engine/README.md has the
 * measurement). */
const EDGE_CURVE = "hsin";

/**
 * Exactly `samples` samples of the source's first audio stream, `from` samples after the clip's
 * first instant, at 48 kHz stereo. Samples sit at their timestamps: a late start or a gap of more
 * than 20 ms in the source becomes silence, as vework hears it, and a source that ends early is
 * padded. The input is opened at the clip's start, not the span's: every span of one clip is then
 * cut from the same decode, so spans in neighbouring pieces join without a sample's shift, which
 * a seek of their own would leave.
 */
export function soundClock(input: string, offset: number, from: number, samples: number): string {
  return [clock(input, offset), ...span(from, samples)].join(",");
}

/** The input's samples at 48 kHz from the clip's first instant, which is `offset` seconds into
 * the input as opened, placed by their timestamps. */
export function clock(input: string, offset: number): string {
  return [
    `${input}asetpts=PTS-${decimal(offset)}/TB`,
    `aresample=${SAMPLE_RATE}:async=1:first_pts=0:min_hard_comp=0.02`,
  ].join(",");
}

/** Exactly `samples` samples in stereo, `from` samples after the clock's first instant. */
export function span(from: number, samples: number): string[] {
  return [
    FORMAT,
    `atrim=start_sample=${from}:end_sample=${from + samples}`,
    "asetpts=PTS-STARTPTS",
    `apad=whole_len=${samples}`,
  ];
}

/** Silence for a span whose source has no sound, so every piece has an audio track. */
export function silence(samples: number): string {
  return `anullsrc=r=${SAMPLE_RATE}:cl=stereo,${FORMAT},atrim=end_sample=${samples}`;
}

/** Fades over the first and last samples of a span of `samples`, after `muteIn` samples of
 * silence and before `muteOut`: a fade in is silent before it starts, and a fade out after it
 * ends. */
export function fades(
  fadeIn: number,
  fadeOut: number,
  samples: number,
  muteIn = 0,
  muteOut = 0,
): string[] {
  return [
    ...(fadeIn > 0 || muteIn > 0
      ? [`afade=t=in:ss=${muteIn}:ns=${Math.max(1, fadeIn)}:curve=${EDGE_CURVE}`]
      : []),
    ...(fadeOut > 0 || muteOut > 0
      ? [
          `afade=t=out:ss=${samples - muteOut - Math.max(1, fadeOut)}:ns=${Math.max(1, fadeOut)}:curve=${EDGE_CURVE}`,
        ]
      : []),
  ];
}
