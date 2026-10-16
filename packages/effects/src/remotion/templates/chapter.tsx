import type { ChapterParams } from "../../catalog.ts";
import { COLORS, fit, type Layout, MOTION, rgba } from "../../layout.ts";
import { Rise, useMotion } from "../motion.tsx";

/** One segment per chapter draws in along the top, the plate opens down from them, the current
 * segment fills with the accent, and the chapter's number and name rise. The row of segments
 * says how far through the video this is. */
export function Chapter({ params, layout }: { params: ChapterParams; layout: Layout }) {
  const { u, safe, type } = layout;
  const motion = useMotion();
  const { index, total } = params;
  const gap = 0.6 * u;
  const pad = 2.2 * u;
  const segment = Math.min(7 * u, (layout.safeWidth * 0.6 - gap * (total - 1)) / total);
  // The row draws in no longer than one stagger step per segment, and 0.24 s in all.
  const step = Math.min(0.04, 0.24 / total);
  const plate = motion.enter(MOTION.stagger, MOTION.reveal);
  const fill = motion.enter(total * step + 0.04, MOTION.reveal);
  const count = motion.enter(MOTION.stagger * 2, MOTION.reveal);
  const title = motion.enter(MOTION.stagger * 3, MOTION.reveal);
  const out = motion.exit;
  const accent = params.accent ?? COLORS.accent;
  return (
    <div
      style={{
        position: "absolute",
        left: safe.left,
        top: safe.top,
        padding: `${1.8 * u}px ${pad}px ${2 * u}px`,
        background: rgba(COLORS.ink, 0.84),
        clipPath: `inset(0 0 ${Math.min(1, 1 - plate + out) * 100}% 0)`,
      }}
    >
      <div style={{ display: "flex", gap }}>
        {Array.from({ length: total }, (_, k) => {
          const drawn = motion.enter(k * step, MOTION.draw);
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: segments are positions, never reordered
              key={k}
              style={{
                position: "relative",
                width: segment,
                height: 0.7 * u,
                borderRadius: 0.35 * u,
                overflow: "hidden",
                background: rgba(COLORS.paper, k < index - 1 ? 0.92 : 0.28),
                transform: `scaleX(${drawn})`,
                transformOrigin: "left",
              }}
            >
              {k === index - 1 ? (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: accent,
                    transform: `scaleX(${fill})`,
                    transformOrigin: "left",
                  }}
                />
              ) : null}
            </div>
          );
        })}
      </div>
      <Rise
        progress={count}
        style={{
          marginTop: 1.6 * u,
          fontSize: type("count"),
          fontWeight: 700,
          letterSpacing: "0.08em",
          fontVariantNumeric: "tabular-nums",
          color: accent,
        }}
      >
        {index} / {total}
      </Rise>
      <Rise
        progress={title}
        style={{
          marginTop: 0.3 * u,
          fontSize: fit(params.title, type("chapter"), layout.safeWidth - 2 * pad),
          fontWeight: 700,
          lineHeight: 1.25,
          letterSpacing: "0.02em",
          whiteSpace: "nowrap",
        }}
      >
        {params.title}
      </Rise>
    </div>
  );
}
