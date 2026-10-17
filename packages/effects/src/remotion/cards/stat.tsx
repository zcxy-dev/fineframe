import type { StatParams } from "../../cards.ts";
import { CARD_COLORS, type CardLayout, COLORS, fit } from "../../layout.ts";
import { CardFrame, count, DIM, glow, Icon, rise, useBuild } from "./kit.tsx";

/** The number counts up from zero in the accent, with its label and context rising under it. */
export function Stat({ params, layout }: { params: StatParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const build = useBuild(1.6);
  const shown = build.at(0, 0.4);
  const counted = build.linear(0, 1.2);
  const decimals = params.decimals ?? 0;
  const final = `${params.prefix ?? ""}${count(params.value, 1, decimals)}${params.suffix ?? ""}`;
  const arrow = params.trend ? 0.8 : 0;
  const size = Math.min(
    box.height * 0.42,
    fit(final, 44 * u, (box.width * 0.94) / (1 + (arrow * 0.6) / Math.max(1, [...final].length))),
  );
  const eased = 1 - (1 - counted) ** 3;
  return (
    <CardFrame
      layout={layout}
      accent={accent}
      style={{ alignItems: "center", justifyContent: "center", textAlign: "center", gap: 2 * u }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 0.15 * size,
          fontSize: size,
          fontWeight: 900,
          lineHeight: 1,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          color: accent,
          textShadow: glow(accent, u),
          whiteSpace: "nowrap",
          ...rise(shown, u, 4),
        }}
      >
        <span>
          {params.prefix}
          {count(params.value, eased, decimals)}
          <span style={{ fontSize: "0.62em", marginLeft: "0.04em" }}>{params.suffix}</span>
        </span>
        {params.trend ? (
          <Icon
            name={params.trend === "up" ? "trending-up" : "trending-down"}
            size={size * 0.48}
            color={params.trend === "up" ? CARD_COLORS.good : CARD_COLORS.bad}
            stroke={2.6}
          />
        ) : null}
      </div>
      <div
        style={{
          fontSize: fit(params.label, type("heading") * 0.8, box.width),
          fontWeight: 700,
          lineHeight: 1.25,
          whiteSpace: "nowrap",
          ...rise(build.at(0.3), u),
        }}
      >
        {params.label}
      </div>
      {params.context ? (
        <div
          style={{
            fontSize: type("body"),
            fontWeight: 500,
            color: DIM,
            letterSpacing: "0.04em",
            ...rise(build.at(0.45), u),
          }}
        >
          {params.context}
        </div>
      ) : null}
    </CardFrame>
  );
}
