// How clips join. Pieces are rendered in output order and joined as raw frames and samples into
// one encoder (see ../render.ts), so a cut needs no filter; a dissolve blends two clips inside
// one piece.

import type { FrameRate } from "@video-editor/schema";
import { decimal } from "./inputs.ts";

/** Blends two spans of `frames` frames each into `frames` frames, from all of the first to
 * nearly all of the second. */
export function dissolve(frames: number, fps: FrameRate): string {
  return `xfade=transition=fade:duration=${decimal((frames * fps.den) / fps.num)}:offset=0`;
}

/** Cross-fades two spans of `samples` samples each into `samples` samples, with quarter-sine
 * curves, which keep the power of two unrelated takes even across the blend. */
export function crossfade(samples: number): string {
  return `acrossfade=ns=${samples}:c1=qsin:c2=qsin`;
}
