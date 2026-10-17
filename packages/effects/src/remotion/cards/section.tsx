import type { SectionParams } from "../../cards.ts";
import { type CardLayout, COLORS, fit, rgba } from "../../layout.ts";
import { Rise } from "../motion.tsx";
import { CardFrame, glow, useBuild } from "./kit.tsx";

/** A section card: the big number rises from behind its mask, a rule draws, and the kicker and
 * the section's name rise after it. The number sits beside the name, or above it when the card
 * is narrow. */
export function Section({ params, layout }: { params: SectionParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const build = useBuild(1);
  const number = params.index === undefined ? undefined : String(params.index).padStart(2, "0");
  const row = layout.ratio > 1.3 && number !== undefined;
  const numberSize = row
    ? Math.min(box.height * 0.8, box.width * 0.3)
    : Math.min(box.height * 0.36, box.width * 0.5);
  const textWidth = row ? box.width - numberSize * 1.3 - 6 * u : box.width;
  return (
    <CardFrame
      layout={layout}
      accent={accent}
      style={{
        flexDirection: row ? "row" : "column",
        alignItems: row ? "center" : "flex-start",
        justifyContent: "center",
        gap: row ? 6 * u : 2 * u,
      }}
    >
      {number ? (
        <Rise progress={build.at(0, 0.5)} style={{ flexShrink: 0 }}>
          <div
            style={{
              fontSize: numberSize,
              fontWeight: 900,
              lineHeight: 0.9,
              letterSpacing: "-0.04em",
              fontVariantNumeric: "tabular-nums",
              color: "transparent",
              backgroundImage: `linear-gradient(180deg, ${accent}, ${rgba(accent, 0.35)})`,
              backgroundClip: "text",
              WebkitBackgroundClip: "text",
              filter: `drop-shadow(0 0 ${3 * u}px ${rgba(accent, 0.45)})`,
            }}
          >
            {number}
          </div>
        </Rise>
      ) : null}
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 1.6 * u }}>
        <div
          style={{
            width: 14 * u,
            height: 0.9 * u,
            background: accent,
            boxShadow: glow(accent, u, 0.6),
            transform: `scaleX(${build.at(0.15, 0.32)})`,
            transformOrigin: "left",
          }}
        />
        {params.kicker ? (
          <Rise progress={build.at(0.22)}>
            <div
              style={{
                fontSize: type("body"),
                fontWeight: 700,
                letterSpacing: "0.18em",
                color: accent,
              }}
            >
              {params.kicker}
            </div>
          </Rise>
        ) : null}
        <Rise progress={build.at(0.3)}>
          <div
            style={{
              fontSize: fit(params.title, type("display"), textWidth),
              fontWeight: 900,
              lineHeight: 1.15,
              whiteSpace: "nowrap",
            }}
          >
            {params.title}
          </div>
        </Rise>
      </div>
    </CardFrame>
  );
}
