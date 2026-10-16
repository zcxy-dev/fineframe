import { AbsoluteFill } from "remotion";
import type { CalloutParams } from "../../catalog.ts";
import { COLORS, ems, fit, type Layout, MOTION, rgba } from "../../layout.ts";
import { useMotion } from "../motion.tsx";

/** The frame dims around the region while an accent outline draws itself around it, and the
 * label slides out from the outline's corner. */
export function Callout({ params, layout }: { params: CalloutParams; layout: Layout }) {
  const { u, safe, type, width, height } = layout;
  const motion = useMotion();
  const dim = motion.enter(0, MOTION.reveal);
  const draw = motion.enter(MOTION.stagger, MOTION.reveal);
  const tag = motion.enter(MOTION.stagger + MOTION.reveal / 2, MOTION.reveal);
  const out = motion.exit;
  const accent = params.accent ?? COLORS.accent;

  // The outline stands a little off the region, so it never covers what it points at.
  const gap = 0.8 * u;
  const box = {
    x: params.rect.x * width - gap,
    y: params.rect.y * height - gap,
    w: params.rect.w * width + 2 * gap,
    h: params.rect.h * height + 2 * gap,
  };
  const radius = 1.2 * u;

  const label = params.label;
  const padX = 1.2 * u;
  const size = label ? fit(label, type("label"), layout.safeWidth - 2 * padX) : 0;
  const labelWidth = label ? ems(label) * size + 2 * padX : 0;
  const labelHeight = size * 1.3 + 1.1 * u;
  // Above the outline when there is room inside the safe area, below it otherwise.
  const above = box.y - gap - labelHeight >= safe.top;
  const labelTop = above ? box.y - gap - labelHeight : box.y + box.h + gap;
  const labelLeft = Math.max(safe.left, Math.min(box.x, width - safe.right - labelWidth));

  return (
    <AbsoluteFill style={{ opacity: 1 - out }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {(params.dim ?? true) ? (
          <>
            <defs>
              <mask id="outside">
                <rect width={width} height={height} fill="white" />
                <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={radius} fill="black" />
              </mask>
            </defs>
            <rect
              width={width}
              height={height}
              fill={COLORS.ink}
              fillOpacity={0.5 * dim}
              mask="url(#outside)"
            />
          </>
        ) : null}
        <rect
          x={box.x}
          y={box.y}
          width={box.w}
          height={box.h}
          rx={radius}
          fill="none"
          stroke={accent}
          strokeWidth={0.45 * u}
          pathLength={1}
          strokeDasharray={1}
          strokeDashoffset={1 - draw}
        />
      </svg>
      {label ? (
        <div
          style={{
            position: "absolute",
            left: labelLeft,
            top: labelTop,
            padding: `${0.5 * u}px ${padX}px ${0.6 * u}px`,
            background: accent,
            color: COLORS.ink,
            fontSize: size,
            fontWeight: 700,
            lineHeight: 1.3,
            whiteSpace: "nowrap",
            boxShadow: `0 ${0.3 * u}px ${1.2 * u}px ${rgba(COLORS.ink, 0.3)}`,
            // Room around the box for its shadow once it shows, and none before.
            clipPath: `inset(${-2 * u}px ${(1 - tag) * 100}% ${-2 * u}px ${tag > 0 ? -2 * u : 0}px)`,
          }}
        >
          {label}
        </div>
      ) : null}
    </AbsoluteFill>
  );
}
