// Effect overlays and graphics over the picture, rendered by @video-editor/effects and drawn
// frame for frame.

import { panelShare, SLIDE } from "@video-editor/effects";
import type { FrameRate, Graphic, Project } from "@video-editor/schema";
import type { GraphicLayer, OverlayLayer } from "../pieces.ts";
import { type Placement, placement } from "./broll.ts";
import { decimal } from "./inputs.ts";

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
export function overlayTiming(
  layer: Pick<OverlayLayer, "fromFrame" | "frames" | "atFrame">,
  fps: FrameRate,
): string[] {
  return [
    `trim=start_frame=${layer.fromFrame}:end_frame=${layer.fromFrame + layer.frames}`,
    `settb=expr=${fps.den}/${fps.num}`,
    `setpts=N+${layer.atFrame}`,
    "format=yuva420p",
  ];
}

/** Where a graphic is drawn, in output pixels: a label or a lower third at its box, a panel in
 * the upper panel of the split, a full-frame graphic over the whole frame. Its render has this
 * size. */
export function graphicPlacement(
  graphic: Pick<Graphic, "layout" | "box">,
  output: Pick<Project["output"], "width" | "height" | "aspect">,
): Placement {
  if (graphic.layout === "panel") {
    return placement({ x: 0, y: 0, w: 1, h: panelShare(output.aspect) }, output);
  }
  if (graphic.layout === "full") return placement(undefined, output);
  if (!graphic.box) throw new Error(`A ${graphic.layout} needs its box`);
  return placement(graphic.box, output);
}

/** Lays a full-frame graphic or a panel over the picture, pushed in over its first SLIDE seconds:
 * a full-frame graphic from the right, a panel down from the top, settling with the house's
 * fast-start curve. */
export function slideIn(
  layout: "panel" | "full",
  at: Placement,
  layer: Pick<GraphicLayer, "fromFrame" | "atFrame">,
  output: Pick<Project["output"], "fps">,
): string {
  const { num, den } = output.fps;
  const still = `overlay=x=${at.x}:y=${at.y}:eof_action=pass:repeatlast=0`;
  if ((layer.fromFrame * den) / num >= SLIDE) return still;
  // The piece's time, in seconds, at which the graphic's first frame shows.
  const zero = decimal(((layer.atFrame - layer.fromFrame) * den) / num);
  const left = `pow(1-min(1,max(0,(t-${zero})/${SLIDE})),3)`;
  const x = layout === "full" ? `${at.x}+${at.width}*${left}` : `${at.x}`;
  const y = layout === "panel" ? `${at.y}-${at.height}*${left}` : `${at.y}`;
  return `overlay=x='${x}':y='${y}':eval=frame:eof_action=pass:repeatlast=0`;
}
