import type { KeywordParams } from "../../catalog.ts";
import { COLORS, fit, type Layout, MOTION, rgba } from "../../layout.ts";
import { useMotion } from "../motion.tsx";

/** A highlighter swipe: the accent block sweeps in from the left and the word appears in its
 * wake, settling from a touch larger. It leaves the way it came, off to the right. */
export function Keyword({ params, layout }: { params: KeywordParams; layout: Layout }) {
  const { u, safe, type } = layout;
  const motion = useMotion();
  const swipe = motion.enter(0, MOTION.draw);
  const word = motion.enter(MOTION.stagger / 2, MOTION.draw);
  const settle = motion.enter(0, MOTION.reveal);
  const out = motion.exit;
  const pad = 1.8 * u;
  const upper = (params.position ?? "upper") === "upper";
  const leaving = out > 0;
  return (
    <div
      style={{
        position: "absolute",
        left: safe.left,
        right: safe.right,
        ...(upper ? { top: safe.top + 2 * u } : { bottom: safe.bottom + 2 * u }),
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div style={{ position: "relative", transform: `scale(${1.06 - 0.06 * settle})` }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: params.accent ?? COLORS.accent,
            boxShadow: `0 ${0.5 * u}px ${2 * u}px ${rgba(COLORS.ink, 0.3)}`,
            transform: `scaleX(${leaving ? 1 - out : swipe})`,
            transformOrigin: leaving ? "right" : "left",
          }}
        />
        <div
          style={{
            position: "relative",
            padding: `${0.3 * u}px ${pad}px ${0.5 * u}px`,
            color: COLORS.ink,
            fontSize: fit(params.text, type("keyword"), layout.safeWidth - 2 * pad),
            fontWeight: 900,
            lineHeight: 1.2,
            whiteSpace: "nowrap",
            clipPath: leaving ? `inset(0 0 0 ${out * 100}%)` : `inset(0 ${(1 - word) * 100}% 0 0)`,
          }}
        >
          {params.text}
        </div>
      </div>
    </div>
  );
}
