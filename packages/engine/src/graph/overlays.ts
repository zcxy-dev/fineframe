// Effect overlays over the picture, rendered by @video-editor/effects and drawn frame for frame.

import type { FrameRate } from "@video-editor/schema";
import type { OverlayLayer } from "../pieces.ts";

/** Opens a rendered overlay. It is VP9 with alpha, which only the libvpx decoder reads with its
 * alpha; FFmpeg's own VP9 decoder would drop it. */
export function overlayInput(file: string): string[] {
  return ["-c:v", "libvpx-vp9", "-i", file];
}

/**
 * Takes the layer's frames of the overlay by count and numbers them in the piece's time base,
 * one tick per frame, so overlay frame k lands on exactly piece frame `atFrame + k` whatever
 * timestamps the file carries.
 */
export function overlayTiming(layer: OverlayLayer, fps: FrameRate): string[] {
  return [
    `trim=start_frame=${layer.fromFrame}:end_frame=${layer.fromFrame + layer.frames}`,
    `settb=expr=${fps.den}/${fps.num}`,
    `setpts=N+${layer.atFrame}`,
    "format=yuva420p",
  ];
}
