import { AbsoluteFill } from "remotion";
import type { TitleParams } from "../../catalog.ts";
import { COLORS, type Layout, MOTION, rgba } from "../../layout.ts";
import { Rise, useMotion } from "../motion.tsx";

/** A rule draws across, the title rises from behind it, and a soft pool of shade gathers behind
 * the type so it reads over any footage. */
export function Title({ params, layout }: { params: TitleParams; layout: Layout }) {
  const { u, safe, type } = layout;
  const motion = useMotion();
  const draw = motion.enter(0, MOTION.draw);
  const head = motion.enter(MOTION.stagger, MOTION.reveal);
  const sub = motion.enter(MOTION.stagger * 2, MOTION.reveal);
  const out = motion.exit;
  // A landscape frame keeps the title to a comfortable measure instead of the full width.
  const maxWidth = layout.aspect === "16:9" ? layout.width * 0.62 : layout.safeWidth;
  const shadow = `0 ${0.2 * u}px ${1.4 * u}px ${rgba(COLORS.ink, 0.4)}`;
  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse 80% 48% at 50% 44%, ${rgba(COLORS.ink, 0.62)}, ${rgba(COLORS.ink, 0)})`,
          opacity: head * (1 - out),
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: `${safe.top}px ${safe.right}px ${safe.bottom}px ${safe.left}px`,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          paddingBottom: 6 * u,
          opacity: 1 - out,
          transform: `translateY(${-out * 1.5 * u}px)`,
        }}
      >
        <div
          style={{
            width: 16 * u,
            height: 1 * u,
            marginBottom: 3 * u,
            background: params.accent ?? COLORS.accent,
            transform: `scaleX(${draw})`,
          }}
        />
        <Rise
          progress={head}
          style={{
            maxWidth,
            fontSize: type("title"),
            fontWeight: 900,
            lineHeight: 1.16,
            letterSpacing: "0.01em",
            textWrap: "balance",
            textShadow: shadow,
          }}
        >
          {params.text}
        </Rise>
        {params.subtitle ? (
          <Rise
            progress={sub}
            style={{
              maxWidth,
              marginTop: 2.2 * u,
              fontSize: type("subtitle"),
              fontWeight: 500,
              lineHeight: 1.4,
              letterSpacing: "0.04em",
              color: rgba(COLORS.paper, 0.88),
              textWrap: "balance",
              textShadow: shadow,
            }}
          >
            {params.subtitle}
          </Rise>
        ) : null}
      </div>
    </AbsoluteFill>
  );
}
