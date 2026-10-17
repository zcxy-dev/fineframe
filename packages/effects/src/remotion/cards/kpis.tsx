import type { KpisParams } from "../../cards.ts";
import { type CardLayout, COLORS, fit } from "../../layout.ts";
import { CardFrame, count, DIM, glass, glow, Heading, rise, useBuild } from "./kit.tsx";

/** Tiles rise in one after another and each number counts up: side by side, or stacked when the
 * card is narrow. */
export function Kpis({ params, layout }: { params: KpisParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const { items } = params;
  const build = useBuild(0.4 + items.length * 0.15 + 1);
  const row = layout.ratio > 1.25;
  const gap = 2.4 * u;
  const titleSpace = params.title ? type("heading") * 1.2 + 4 * u : 0;
  const tileWidth = row ? (box.width - gap * (items.length - 1)) / items.length : box.width;
  const tileHeight = row
    ? Math.min(box.height - titleSpace, 60 * u)
    : (box.height - titleSpace - gap * (items.length - 1)) / items.length;
  return (
    <CardFrame layout={layout} accent={accent}>
      <Heading text={params.title} layout={layout} progress={build.at(0)} />
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: row ? "row" : "column",
          alignItems: "center",
          justifyContent: "center",
          gap,
        }}
      >
        {items.map((item, k) => {
          const p = build.at(0.15 + k * 0.15);
          const counted = build.linear(0.15 + k * 0.15, 1);
          const decimals = item.decimals ?? 0;
          const final = `${item.prefix ?? ""}${count(item.value, 1, decimals)}${item.suffix ?? ""}`;
          const numberSize = row
            ? fit(final, Math.min(tileHeight * 0.4, 22 * u), tileWidth - 9 * u)
            : fit(final, tileHeight * 0.52, tileWidth * 0.5);
          return (
            <div
              key={item.label}
              style={{
                ...glass(u),
                width: tileWidth,
                height: tileHeight,
                display: "flex",
                flexDirection: row ? "column" : "row",
                alignItems: "center",
                justifyContent: row ? "center" : "space-between",
                gap: row ? 1.4 * u : 3 * u,
                padding: `0 ${3 * u}px`,
                textAlign: row ? "center" : "left",
                ...rise(p, u),
              }}
            >
              <div
                style={{
                  fontSize: numberSize,
                  fontWeight: 900,
                  lineHeight: 1,
                  fontVariantNumeric: "tabular-nums",
                  color: accent,
                  textShadow: glow(accent, u, 0.7),
                  whiteSpace: "nowrap",
                }}
              >
                {item.prefix}
                {count(item.value, 1 - (1 - counted) ** 3, decimals)}
                {item.suffix}
              </div>
              <div
                style={{
                  fontSize: fit(
                    item.label,
                    type("item"),
                    row ? tileWidth - 4 * u : tileWidth * 0.45,
                  ),
                  fontWeight: 700,
                  color: DIM,
                  whiteSpace: "nowrap",
                }}
              >
                {item.label}
              </div>
            </div>
          );
        })}
      </div>
    </CardFrame>
  );
}
