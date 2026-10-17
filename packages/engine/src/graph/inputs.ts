import { type FrameRate, TICKS_PER_SECOND } from "@video-editor/schema";
import type { SourceFacts } from "../sources.ts";

/** How far before a span the seek lands: room to decode the frame on screen at the span's first
 * instant, and the packets the audio decoder needs before it outputs clean samples. */
const PREROLL_SECONDS = 0.5;

export interface Input {
  /** FFmpeg's input options and `-i`. */
  args: string[];
  /** Seconds from the input's time zero to the span's first instant; the chains subtract it. */
  offset: number;
}

/**
 * Opens a source at source time `ticks`. The fast seek lands on a keyframe at or before the
 * target and keeps the earlier frames, with negative times, so the clock can pick the frame on
 * screen at the span's first instant instead of the first one that starts after it. The seek is
 * to a container timestamp counted from the media index's time zero, not from where FFmpeg starts
 * the file, which for Matroska and WebM is up to a codec's priming earlier.
 */
export function openSource(source: SourceFacts, ticks: number, fps: FrameRate): Input {
  if (source.kind === "image") {
    const args = ["-loop", "1", "-framerate", `${fps.num}/${fps.den}`, "-i", source.path];
    return { args, offset: 0 };
  }
  const micros = Math.round((ticks * 1_000_000) / TICKS_PER_SECOND);
  const seek = Math.max(0, micros - PREROLL_SECONDS * 1_000_000);
  const at = (source.zero + seek / 1_000_000).toFixed(6);
  return {
    args: ["-noaccurate_seek", "-seek_timestamp", "1", "-ss", at, "-i", source.path],
    offset: ticks / TICKS_PER_SECOND - seek / 1_000_000,
  };
}

/** A number as a filter option, in plain decimal notation, which every FFmpeg option parser
 * reads; nanosecond precision is far below a sample. */
export function decimal(value: number): string {
  const text = value.toFixed(9).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
}
