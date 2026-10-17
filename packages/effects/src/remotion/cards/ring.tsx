import type { RingParams } from "../../cards.ts";
import { type CardLayout, COLORS, fit, rgba } from "../../layout.ts";
import { CardFrame, DIM, glow, LINE, rise, useBuild } from "./kit.tsx";

/** The ring fills clockwise to the percentage as the number in it counts up, and the label rises
 * beside it, or under it when the card is narrow. */
export function Ring({ params, layout }: { params: RingParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const build = useBuild(1.6);
  const filled = build.at(0.15, 1.3);
  const row = layout.ratio > 1.3;
  const size = row
    ? Math.min(box.height, box.width * 0.45)
    : Math.min(box.width * 0.75, box.height * 0.62);
  const stroke = size * 0.09;
  const radius = (size - stroke) / 2 - size * 0.04;
  const textWidth = row ? box.width - size - 8 * u : box.width;
  const shown = Math.round(params.value * filled);
  return (
    <CardFrame
      layout={layout}
      accent={accent}
      style={{
        flexDirection: row ? "row" : "column",
        alignItems: "center",
        justifyContent: "center",
        gap: row ? 8 * u : 4 * u,
        textAlign: row ? "left" : "center",
      }}
    >
      <div
        style={{
          position: "relative",
          width: size,
          height: size,
          flexShrink: 0,
          ...rise(build.at(0, 0.5), u),
        }}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{ transform: "rotate(-90deg)", overflow: "visible" }}
          aria-hidden
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={LINE}
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={accent}
            strokeWidth={stroke}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${params.value * filled} 100`}
            // A round cap draws a dot even for an empty arc.
            opacity={params.value * filled > 0 ? 1 : 0}
            style={{ filter: `drop-shadow(0 0 ${1.6 * u}px ${rgba(accent, 0.7)})` }}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: size * 0.26,
            fontWeight: 900,
            fontVariantNumeric: "tabular-nums",
            textShadow: glow(accent, u, 0.4),
          }}
        >
          {shown}
          <span style={{ fontSize: "0.55em", marginLeft: "0.05em" }}>%</span>
        </div>
      </div>
      <div style={{ ...rise(build.at(0.5), u), minWidth: 0 }}>
        <div
          style={{
            fontSize: fit(params.label, type("heading") * 0.9, textWidth),
            fontWeight: 900,
            lineHeight: 1.25,
            whiteSpace: "nowrap",
          }}
        >
          {params.label}
        </div>
        {params.context ? (
          <div
            style={{
              marginTop: 1.2 * u,
              fontSize: fit(params.context, type("body"), textWidth),
              fontWeight: 500,
              color: DIM,
              whiteSpace: "nowrap",
            }}
          >
            {params.context}
          </div>
        ) : null}
      </div>
    </CardFrame>
  );
}
