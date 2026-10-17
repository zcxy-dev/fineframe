import type { BarChartParams } from "../../cards.ts";
import { type CardLayout, COLORS, fit, rgba } from "../../layout.ts";
import { CardFrame, count, DIM, glow, Heading, LINE, rise, useBuild } from "./kit.tsx";

/** The decimal places a series needs, up to two. */
export function decimalsOf(values: number[]): number {
  return Math.min(2, Math.max(0, ...values.map((v) => (String(v).split(".")[1] ?? "").length)));
}

/** Columns grow from the baseline one after another while their values count up above them; one
 * column, the largest unless `highlight` says otherwise, is lit in the accent. */
export function BarChart({ params, layout }: { params: BarChartParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const { bars } = params;
  const values = bars.map((bar) => bar.value);
  const max = Math.max(...values) || 1;
  const lit = (params.highlight ?? values.indexOf(Math.max(...values)) + 1) - 1;
  const decimals = decimalsOf(values);
  const build = useBuild(0.3 + bars.length * 0.12 + 0.9);
  const titleSpace = params.title ? type("heading") * 1.2 + 4 * u : 0;
  const valueSize = type("item");
  const labelSize = type("body");
  const plot = box.height - titleSpace - valueSize * 1.6 - labelSize * 1.8;
  const slot = box.width / bars.length;
  const barWidth = Math.min(slot * 0.62, 30 * u);
  const unit = params.unit ? ` ${params.unit}` : "";
  return (
    <CardFrame layout={layout} accent={accent}>
      <Heading text={params.title} layout={layout} progress={build.at(0)} />
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "flex-end",
          borderBottom: `${Math.max(1, 0.25 * u)}px solid ${LINE}`,
        }}
      >
        {bars.map((bar, k) => {
          const grown = build.at(0.25 + k * 0.12, 0.9);
          const isLit = k === lit;
          const label = `${count(bar.value, grown, decimals)}${unit}`;
          return (
            <div
              key={bar.label}
              style={{
                width: slot,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "flex-end",
              }}
            >
              <div
                style={{
                  fontSize: fit(`${count(bar.value, 1, decimals)}${unit}`, valueSize, slot - u),
                  fontWeight: 900,
                  fontVariantNumeric: "tabular-nums",
                  marginBottom: 1 * u,
                  color: isLit ? accent : COLORS.paper,
                  textShadow: isLit ? glow(accent, u, 0.6) : "none",
                  whiteSpace: "nowrap",
                  opacity: Math.min(1, grown * 3),
                }}
              >
                {label}
              </div>
              <div
                style={{
                  width: barWidth,
                  height: Math.max(0.6 * u, (bar.value / max) * plot * grown),
                  borderRadius: `${1.4 * u}px ${1.4 * u}px 0 0`,
                  background: isLit
                    ? `linear-gradient(180deg, ${accent}, ${rgba(accent, 0.55)})`
                    : `linear-gradient(180deg, ${rgba(COLORS.paper, 0.32)}, ${rgba(COLORS.paper, 0.12)})`,
                  boxShadow: isLit ? glow(accent, u, 0.6) : "none",
                }}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", marginTop: -2.6 * u }}>
        {bars.map((bar, k) => (
          <div
            key={bar.label}
            style={{
              width: slot,
              textAlign: "center",
              fontSize: fit(bar.label, labelSize, slot - u),
              fontWeight: 700,
              color: k === lit ? COLORS.paper : DIM,
              whiteSpace: "nowrap",
              ...rise(build.at(0.2 + k * 0.12), u, 1),
            }}
          >
            {bar.label}
          </div>
        ))}
      </div>
    </CardFrame>
  );
}
