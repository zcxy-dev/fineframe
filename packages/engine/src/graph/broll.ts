// B-roll over the main track: where it sits, how it fades and how its sound mixes in.

import type { FrameRate, Project, Rect } from "@video-editor/schema";
import type { BrollLayer } from "../pieces.ts";
import { fades } from "./audio.ts";
import { decimal } from "./inputs.ts";
import type { Box } from "./video.ts";

export interface Placement extends Box {
  x: number;
  y: number;
}

/** The B-roll's rect in output pixels, with even sizes for 4:2:0; the whole frame without one. */
export function placement(rect: Rect | undefined, output: Project["output"]): Placement {
  if (!rect) return { x: 0, y: 0, width: output.width, height: output.height };
  const even = (value: number) => Math.max(2, Math.round(value / 2) * 2);
  return {
    x: Math.round(rect.x * output.width),
    y: Math.round(rect.y * output.height),
    width: Math.min(even(rect.w * output.width), output.width),
    height: Math.min(even(rect.h * output.height), output.height),
  };
}

/**
 * Times a B-roll span for compositing: its fades follow the B-roll clip's own time, so a fade
 * split across two pieces continues where it left off, and the span then starts `layer.atFrame`
 * frames into its piece.
 */
export function brollTiming(layer: BrollLayer, fps: FrameRate): string[] {
  const seconds = (frames: number) => decimal((frames * fps.den) / fps.num);
  const { fade, start, end } = layer.clip;
  const fades =
    fade > 0
      ? [
          `setpts=PTS+${seconds(layer.fromFrame)}/TB`,
          "format=yuva420p",
          `fade=t=in:alpha=1:st=0:d=${seconds(fade)}`,
          `fade=t=out:alpha=1:st=${seconds(end - start - fade)}:d=${seconds(fade)}`,
        ]
      : [];
  return [...fades, `setpts=PTS-STARTPTS+${seconds(layer.atFrame)}/TB`];
}

export function overlay(at: Placement): string {
  // Before the B-roll's first frame and after its last, the main track shows through.
  return `overlay=x=${at.x}:y=${at.y}:eof_action=pass:repeatlast=0`;
}

/** The B-roll's sound at its gain, faded over `fade` samples at the edges of the whole B-roll
 * clip (`total` samples) on its own time, then delayed to where the span sits in its piece. */
export function brollSound(
  layer: BrollLayer,
  fade: number,
  total: number,
  gainDb: number,
): string[] {
  return [
    `asetpts=PTS+${layer.fromSample}`,
    ...fades(fade, fade, total),
    `volume=${gainDb}dB`,
    "asetpts=PTS-STARTPTS",
    `adelay=delays=${layer.atSample}S:all=1`,
  ];
}

/** Sums sounds at their own levels, keeping the first one's length, or the longest one's. */
export function mix(inputs: number, duration: "first" | "longest" = "first"): string {
  return `amix=inputs=${inputs}:duration=${duration}:dropout_transition=0:normalize=0`;
}
