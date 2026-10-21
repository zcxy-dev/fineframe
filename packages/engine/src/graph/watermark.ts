// A brand kit's logo as a corner watermark through the whole video (Q192), over the picture, the
// B-roll, the graphics and the overlays, and under the captions.

import type { ResolvedBrand } from "../brand/kit.ts";
import type { GraphicLayer } from "../pieces.ts";
import type { Placement } from "./broll.ts";

export type Watermark = NonNullable<ResolvedBrand["watermark"]>;

/** Whether the watermark leaves the frame while a panel or full-frame graphic shows, so it never
 * covers their text; false draws it over them too. */
const HIDE_UNDER_GRAPHICS = true;

/** The graph lines that lay the watermark, input `index`, over `base` as `out`: hidden over the
 * piece frames of each panel or full-frame graphic in `graphics` while HIDE_UNDER_GRAPHICS. */
export function watermarkLines(
  index: number,
  watermark: Pick<Watermark, "opacity">,
  at: Placement,
  graphics: readonly Pick<GraphicLayer, "atFrame" | "frames" | "clip">[],
  base: string,
  out: string,
): string[] {
  const fade = watermark.opacity < 1 ? `,colorchannelmixer=aa=${watermark.opacity}` : "";
  const hidden = HIDE_UNDER_GRAPHICS
    ? graphics
        .filter(
          (layer) => layer.clip.graphic.layout === "panel" || layer.clip.graphic.layout === "full",
        )
        .map((layer) => `between(n,${layer.atFrame},${layer.atFrame + layer.frames - 1})`)
    : [];
  const enable = hidden.length > 0 ? `:enable='not(${hidden.join("+")})'` : "";
  return [
    `[${index}:v]scale=${at.width}:${at.height}:flags=lanczos,format=rgba${fade},format=yuva420p[w]`,
    `${base}[w]overlay=x=${at.x}:y=${at.y}${enable}${out}`,
  ];
}
