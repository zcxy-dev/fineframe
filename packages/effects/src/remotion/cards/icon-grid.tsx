import type { IconGridParams } from "../../cards.ts";
import { type CardLayout, COLORS, fit } from "../../layout.ts";
import { brandColor, CardFrame, Heading, rise, Tile, useBuild } from "./kit.tsx";

/** The number of columns that gives each cell, a tile over its label, the largest tile. */
function columnsFor(n: number, width: number, height: number): number {
  let best = 1;
  let size = 0;
  for (let columns = 1; columns <= n; columns++) {
    const rows = Math.ceil(n / columns);
    const cell = Math.min(width / columns, height / rows / 1.4);
    if (cell > size) [best, size] = [columns, cell];
  }
  return best;
}

/** The tiles pop in one after another in reading order, each with its label under it. */
export function IconGrid({ params, layout }: { params: IconGridParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const { items } = params;
  const build = useBuild(0.3 + items.length * 0.09 + 0.4);
  const titleSpace = params.title ? type("heading") * 1.2 + 4 * u : 0;
  const room = box.height - titleSpace;
  const columns = columnsFor(items.length, box.width, room);
  const rows = Math.ceil(items.length / columns);
  const cellWidth = box.width / columns;
  const cellHeight = room / rows;
  const tile = Math.min(cellWidth * 0.6, cellHeight * 0.58, 26 * u);
  return (
    <CardFrame layout={layout} accent={accent}>
      <Heading text={params.title} layout={layout} progress={build.at(0)} />
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, ${cellWidth}px)`,
          gridAutoRows: `${Math.min(cellHeight, tile * 1.8)}px`,
          alignContent: "center",
          justifyContent: "center",
        }}
      >
        {items.map((item, k) => {
          const p = build.at(0.2 + k * 0.09, 0.4);
          const color = item.logo ? brandColor(item.logo, accent) : accent;
          return (
            <div
              key={item.label}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 1.6 * u,
                opacity: p,
                transform: `scale(${0.7 + 0.3 * p})`,
              }}
            >
              <Tile
                icon={item.icon ?? (item.logo ? undefined : "sparkles")}
                logo={item.logo}
                size={tile}
                color={color}
                u={u}
              />
              <div
                style={{
                  fontSize: fit(item.label, Math.min(type("item"), tile * 0.32), cellWidth - 2 * u),
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  ...rise(p, u, 1),
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
