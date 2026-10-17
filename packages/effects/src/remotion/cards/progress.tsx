import type { ProgressParams } from "../../cards.ts";
import { CARD_COLORS, type CardLayout, COLORS, fit, rgba } from "../../layout.ts";
import { CardFrame, DIM, glow, Heading, LINE, rise, useBuild } from "./kit.tsx";

/** Each bar fills to its percentage in turn while its number counts up; a full bar turns to the
 * colour of done. */
export function Progress({ params, layout }: { params: ProgressParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const { items } = params;
  const build = useBuild(0.3 + items.length * 0.18 + 1);
  const titleSpace = params.title ? type("heading") * 1.2 + 4 * u : 0;
  const rowHeight = Math.min(24 * u, (box.height - titleSpace) / items.length);
  const size = Math.min(type("item") * 1.1, rowHeight * 0.34);
  const bar = Math.min(4.4 * u, rowHeight * 0.22);
  return (
    <CardFrame layout={layout} accent={accent}>
      <Heading text={params.title} layout={layout} progress={build.at(0)} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        {items.map((item, k) => {
          const shown = build.at(0.15 + k * 0.18);
          const filled = build.at(0.25 + k * 0.18, 1);
          const done = item.value >= 100 && filled >= 1;
          const color = done ? CARD_COLORS.good : accent;
          return (
            <div
              key={item.label}
              style={{
                height: rowHeight,
                display: "flex",
                flexDirection: "column",
                justifyContent: "center",
                gap: 1.4 * u,
                ...rise(shown, u, 2),
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  fontSize: size,
                  fontWeight: 700,
                }}
              >
                <span
                  style={{
                    fontSize: fit(item.label, size, box.width * 0.7),
                    whiteSpace: "nowrap",
                    color: done ? DIM : COLORS.paper,
                  }}
                >
                  {item.label}
                </span>
                <span style={{ fontWeight: 900, fontVariantNumeric: "tabular-nums", color }}>
                  {Math.round(item.value * filled)}%
                </span>
              </div>
              <div style={{ height: bar, borderRadius: bar, background: LINE, overflow: "hidden" }}>
                <div
                  style={{
                    width: `${item.value * filled}%`,
                    height: "100%",
                    borderRadius: bar,
                    background: `linear-gradient(90deg, ${rgba(color, 0.55)}, ${color})`,
                    boxShadow: glow(color, u, 0.5),
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </CardFrame>
  );
}
