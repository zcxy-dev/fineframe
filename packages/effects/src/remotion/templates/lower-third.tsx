import type { LowerThirdParams } from "../../catalog.ts";
import { COLORS, fit, type Layout, MOTION, rgba } from "../../layout.ts";
import { Rise, useMotion } from "../motion.tsx";

/** An accent bar grows up from the baseline, the plate opens out of it, and the name and role
 * rise in turn. It leaves by folding back into the bar. */
export function LowerThird({ params, layout }: { params: LowerThirdParams; layout: Layout }) {
  const { u, safe, type } = layout;
  const motion = useMotion();
  const draw = motion.enter(0, MOTION.draw);
  const plate = motion.enter(MOTION.stagger, MOTION.reveal);
  const name = motion.enter(MOTION.stagger * 2, MOTION.reveal);
  const role = motion.enter(MOTION.stagger * 3, MOTION.reveal);
  const out = motion.exit;
  const bar = 0.8 * u;
  const pad = 2.4 * u;
  const room = layout.safeWidth - bar - 2 * pad;
  // At 9:16 the band just above the captions is where a talking head's mouth and chin fall, so
  // the name goes into the headroom at the top instead.
  const place = layout.aspect === "9:16" ? { top: safe.top } : { bottom: safe.bottom };
  return (
    <div
      style={{
        position: "absolute",
        left: safe.left,
        ...place,
        display: "flex",
        alignItems: "stretch",
      }}
    >
      <div
        style={{
          width: bar,
          background: params.accent ?? COLORS.accent,
          transform: `scaleY(${draw * (1 - out)})`,
          transformOrigin: "bottom",
        }}
      />
      <div
        style={{
          padding: `${1.5 * u}px ${pad}px ${1.7 * u}px`,
          background: rgba(COLORS.ink, 0.84),
          clipPath: `inset(0 ${Math.min(1, 1 - plate + out) * 100}% 0 0)`,
        }}
      >
        <Rise
          progress={name}
          style={{
            fontSize: fit(params.name, type("name"), room),
            fontWeight: 700,
            lineHeight: 1.25,
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
          }}
        >
          {params.name}
        </Rise>
        {params.role ? (
          <Rise
            progress={role}
            style={{
              marginTop: 0.5 * u,
              fontSize: fit(params.role, type("role"), room),
              fontWeight: 500,
              lineHeight: 1.35,
              letterSpacing: "0.03em",
              color: rgba(COLORS.paper, 0.8),
              whiteSpace: "nowrap",
            }}
          >
            {params.role}
          </Rise>
        ) : null}
      </div>
    </div>
  );
}
