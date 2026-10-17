import type { AppParams } from "../../cards.ts";
import { type CardLayout, COLORS, fit, rgba } from "../../layout.ts";
import { brandColor, CardFrame, DIM, fitBlock, glass, Icon, rise, Tile, useBuild } from "./kit.tsx";

/** A product card rises in: its logo on a lit tile, then its name, tagline, tags and address, one
 * after another. The logo sits beside the text, or above it when the card is narrow. */
export function AppCard({ params, layout }: { params: AppParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const build = useBuild(1.3);
  const color = params.logo ? brandColor(params.logo, accent) : accent;
  const row = layout.ratio > 1.2;
  const cardWidth = Math.min(box.width, row ? box.height * 2.6 : box.width);
  const cardHeight = Math.min(box.height, row ? box.height : box.width * 1.1);
  const tile = row ? Math.min(cardHeight * 0.5, 30 * u) : Math.min(cardWidth * 0.32, 30 * u);
  const textWidth = row ? cardWidth - tile - 14 * u : cardWidth - 8 * u;
  return (
    <CardFrame
      layout={layout}
      accent={accent}
      style={{ alignItems: "center", justifyContent: "center" }}
    >
      <div
        style={{
          ...glass(u, 1.3),
          width: cardWidth,
          height: cardHeight,
          display: "flex",
          flexDirection: row ? "row" : "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: row ? "left" : "center",
          gap: row ? 5 * u : 3 * u,
          padding: 4 * u,
          ...rise(build.at(0, 0.5), u),
        }}
      >
        <div style={{ transform: `scale(${0.7 + 0.3 * build.at(0.1, 0.5)})` }}>
          <Tile
            icon={params.icon ?? (params.logo ? undefined : "sparkles")}
            logo={params.logo}
            size={tile}
            color={color}
            u={u}
          />
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: row ? "flex-start" : "center",
            gap: 1.6 * u,
            minWidth: 0,
          }}
        >
          <div
            style={{
              fontSize: fit(params.name, type("heading") * 1.2, textWidth),
              fontWeight: 900,
              lineHeight: 1.1,
              whiteSpace: "nowrap",
              ...rise(build.at(0.2), u, 2),
            }}
          >
            {params.name}
          </div>
          <div
            style={{
              fontSize: fitBlock(params.tagline, type("item"), textWidth, type("item") * 2.8),
              fontWeight: 500,
              lineHeight: 1.35,
              color: DIM,
              maxWidth: textWidth,
              ...rise(build.at(0.3), u, 2),
            }}
          >
            {params.tagline}
          </div>
          {params.tags ? (
            <div
              style={{
                display: "flex",
                gap: 1.2 * u,
                flexWrap: "wrap",
                justifyContent: row ? "flex-start" : "center",
              }}
            >
              {params.tags.map((tag, k) => (
                <div
                  key={tag}
                  style={{
                    padding: `${0.5 * u}px ${1.8 * u}px`,
                    borderRadius: 999,
                    fontSize: type("small"),
                    fontWeight: 700,
                    color: accent,
                    background: rgba(accent, 0.12),
                    border: `${Math.max(1, 0.18 * u)}px solid ${rgba(accent, 0.5)}`,
                    ...rise(build.at(0.45 + k * 0.08), u, 1.5),
                  }}
                >
                  {tag}
                </div>
              ))}
            </div>
          ) : null}
          {params.url ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 1 * u,
                marginTop: 0.6 * u,
                padding: `${0.6 * u}px ${2 * u}px`,
                borderRadius: 999,
                background: rgba(COLORS.paper, 0.08),
                fontSize: type("small"),
                fontWeight: 500,
                color: DIM,
                ...rise(build.at(0.7), u, 1.5),
              }}
            >
              <Icon name="globe" size={type("small")} color={DIM} />
              {params.url}
            </div>
          ) : null}
        </div>
      </div>
    </CardFrame>
  );
}
