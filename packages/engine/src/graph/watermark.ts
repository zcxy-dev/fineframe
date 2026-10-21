// A brand kit's logo as a corner watermark through the whole video (Q192), over the picture and
// the B-roll and under the captions. It never covers text: it leaves the frame while a graphic
// or a template overlay that meets its box shows (Q209).

import type { ResolvedBrand } from "../brand/kit.ts";
import type { Placement } from "./broll.ts";

export type Watermark = NonNullable<ResolvedBrand["watermark"]>;

/** The graph lines that lay the watermark, input `index`, at `at` over `base` as `out`, left
 * out of the piece frames [from, to] of each of `hidden`. */
export function watermarkLines(
  index: number,
  watermark: Pick<Watermark, "opacity">,
  at: Placement,
  hidden: readonly [number, number][],
  base: string,
  out: string,
): string[] {
  const fade = watermark.opacity < 1 ? `,colorchannelmixer=aa=${watermark.opacity}` : "";
  const away = hidden.map(([from, to]) => `between(n,${from},${to})`);
  const enable = away.length > 0 ? `:enable='not(${away.join("+")})'` : "";
  return [
    `[${index}:v]scale=${at.width}:${at.height}:flags=lanczos,format=rgba${fade},format=yuva420p[w]`,
    `${base}[w]overlay=x=${at.x}:y=${at.y}${enable}${out}`,
  ];
}
