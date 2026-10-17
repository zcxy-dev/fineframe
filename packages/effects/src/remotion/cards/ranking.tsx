import type { RankingParams } from "../../cards.ts";
import { type CardLayout, COLORS, fit, rgba } from "../../layout.ts";
import { decimalsOf } from "./bar-chart.tsx";
import {
  brandColor,
  CardFrame,
  count,
  DIM,
  glow,
  Heading,
  LINE,
  Mark,
  rise,
  useBuild,
} from "./kit.tsx";

/** The rows rise in from first place down, and each bar grows to its share of the leader while
 * its value counts up; first place is lit in the accent. */
export function Ranking({ params, layout }: { params: RankingParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const { items } = params;
  const values = items.map((item) => item.value);
  const max = Math.max(...values) || 1;
  const decimals = decimalsOf(values);
  const build = useBuild(0.3 + items.length * 0.14 + 0.9);
  const titleSpace = params.title ? type("heading") * 1.2 + 4 * u : 0;
  const rowHeight = Math.min(20 * u, (box.height - titleSpace) / items.length);
  const size = Math.min(type("item"), rowHeight * 0.38);
  const labelWidth = Math.min(box.width * 0.34, size * 7);
  const valueWidth = size * 3.6;
  const barRoom = box.width - size * 2.2 - labelWidth - valueWidth - 6 * u;
  const unit = params.unit ? `${/^[%％]/.test(params.unit) ? "" : " "}${params.unit}` : "";
  return (
    <CardFrame layout={layout} accent={accent}>
      <Heading text={params.title} layout={layout} progress={build.at(0)} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {items.map((item, k) => {
          const shown = build.at(0.15 + k * 0.14);
          const grown = build.at(0.25 + k * 0.14, 0.9);
          const first = k === 0;
          const color = first ? accent : rgba(COLORS.paper, 0.32);
          return (
            <div
              key={item.label}
              style={{
                height: rowHeight,
                display: "flex",
                alignItems: "center",
                gap: 2 * u,
                ...rise(shown, u, 2),
              }}
            >
              <div
                style={{
                  width: size * 2.2,
                  fontSize: size * 1.2,
                  fontWeight: 900,
                  color: first ? accent : DIM,
                  textShadow: first ? glow(accent, u, 0.5) : "none",
                }}
              >
                #{k + 1}
              </div>
              <div
                style={{ width: labelWidth, display: "flex", alignItems: "center", gap: 1.4 * u }}
              >
                <Mark
                  icon={item.icon}
                  logo={item.logo}
                  size={size * 1.1}
                  color={item.logo ? brandColor(item.logo, accent) : COLORS.paper}
                />
                <span
                  style={{
                    fontSize: fit(
                      item.label,
                      size,
                      labelWidth - (item.icon || item.logo ? size * 1.6 : 0),
                    ),
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.label}
                </span>
              </div>
              <div
                style={{
                  width: barRoom,
                  height: rowHeight * 0.32,
                  borderRadius: rowHeight,
                  background: LINE,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${(item.value / max) * grown * 100}%`,
                    height: "100%",
                    borderRadius: rowHeight,
                    background: first
                      ? `linear-gradient(90deg, ${rgba(accent, 0.5)}, ${accent})`
                      : color,
                    boxShadow: first ? glow(accent, u, 0.5) : "none",
                  }}
                />
              </div>
              <div
                style={{
                  width: valueWidth,
                  textAlign: "right",
                  fontSize: size,
                  fontWeight: 900,
                  fontVariantNumeric: "tabular-nums",
                  color: first ? accent : COLORS.paper,
                  whiteSpace: "nowrap",
                }}
              >
                {count(item.value, grown, decimals)}
                {unit}
              </div>
            </div>
          );
        })}
      </div>
    </CardFrame>
  );
}
