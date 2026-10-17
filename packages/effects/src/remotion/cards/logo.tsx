import type { LogoParams } from "../../cards.ts";
import { type CardLayout, COLORS, fit, rgba } from "../../layout.ts";
import { brandColor, CardFrame, DIM, glow, rise, Tile, useBuild } from "./kit.tsx";

/** The logo's tile lands from a little larger with a ring rippling out from it, and the brand's
 * name rises beside it, or under it when the card is narrow. */
export function LogoReveal({ params, layout }: { params: LogoParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const build = useBuild(1);
  const color = params.logo ? brandColor(params.logo, accent) : accent;
  const row = layout.ratio > 1.3;
  const tile = row
    ? Math.min(box.height * 0.6, 40 * u)
    : Math.min(box.width * 0.45, box.height * 0.42);
  const landed = build.at(0, 0.5);
  const ripple = build.linear(0.25, 0.7);
  const textWidth = row ? box.width - tile - 8 * u : box.width;
  return (
    <CardFrame
      layout={layout}
      accent={color}
      style={{
        flexDirection: row ? "row" : "column",
        alignItems: "center",
        justifyContent: "center",
        gap: row ? 6 * u : 4 * u,
        textAlign: row ? "left" : "center",
      }}
    >
      <div
        style={{
          position: "relative",
          opacity: landed,
          transform: `scale(${1.25 - 0.25 * landed})`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            borderRadius: tile * 0.26,
            border: `${0.5 * u}px solid ${rgba(color, 0.8 * (1 - ripple))}`,
            transform: `scale(${1 + ripple * 0.6})`,
          }}
        />
        <Tile
          icon={params.icon ?? (params.logo ? undefined : "sparkles")}
          logo={params.logo}
          size={tile}
          color={color}
          u={u}
        />
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: fit(params.name, type("display"), textWidth),
            fontWeight: 900,
            lineHeight: 1.1,
            whiteSpace: "nowrap",
            textShadow: glow(color, u, 0.4),
            ...rise(build.at(0.3), u),
          }}
        >
          {params.name}
        </div>
        {params.tagline ? (
          <div
            style={{
              marginTop: 1.6 * u,
              fontSize: fit(params.tagline, type("item"), textWidth),
              fontWeight: 500,
              color: DIM,
              whiteSpace: "nowrap",
              ...rise(build.at(0.45), u),
            }}
          >
            {params.tagline}
          </div>
        ) : null}
      </div>
    </CardFrame>
  );
}
