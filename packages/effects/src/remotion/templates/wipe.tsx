import { AbsoluteFill, interpolate } from "remotion";
import type { WipeParams } from "../../catalog.ts";
import { COLORS, type Layout } from "../../layout.ts";
import { sweep, useMotion } from "../motion.tsx";

// Fractions of the wipe over which each edge of each band crosses the frame. The accent band
// leads in and trails out around the ink band, which covers the whole frame from 0.44 to 0.56:
// the cut goes in the middle.
const ACCENT = { leading: [0, 0.36], trailing: [0.64, 1] } as const;
const INK = { leading: [0.08, 0.44], trailing: [0.56, 0.92] } as const;

/** Two bands, accent then ink, sweep across the frame with a slanted edge and cover the cut. */
export function Wipe({ params, layout }: { params: WipeParams; layout: Layout }) {
  const { width, height } = layout;
  const { t } = useMotion();
  const direction = params.direction ?? "right";
  const horizontal = direction === "left" || direction === "right";
  const along = horizontal ? width : height;
  const across = horizontal ? height : width;
  const slant = across * 0.18;

  /** Where an edge is along the way the band travels, from wholly before the frame to wholly
   * past it. */
  const edge = ([from, to]: readonly [number, number]) => {
    const p = interpolate(t, [from, to], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: sweep,
    });
    return -slant / 2 + p * (along + slant);
  };
  /** The band between its two edges, in screen coordinates, as a CSS polygon. */
  const band = (bounds: typeof ACCENT | typeof INK) => {
    const back = edge(bounds.trailing);
    const front = edge(bounds.leading);
    const corners: [number, number][] = [
      [back + slant / 2, 0],
      [front + slant / 2, 0],
      [front - slant / 2, across],
      [back - slant / 2, across],
    ];
    const screen = corners.map(([a, b]) => {
      if (direction === "right") return [a, b];
      if (direction === "left") return [width - a, b];
      if (direction === "down") return [b, a];
      return [b, height - a];
    });
    return `polygon(${screen.map(([x, y]) => `${x}px ${y}px`).join(", ")})`;
  };

  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{ background: params.accent ?? COLORS.accent, clipPath: band(ACCENT) }}
      />
      <AbsoluteFill style={{ background: params.color ?? COLORS.ink, clipPath: band(INK) }} />
    </AbsoluteFill>
  );
}
