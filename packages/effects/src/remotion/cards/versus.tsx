import type { VersusParams } from "../../cards.ts";
import { type CardLayout, COLORS, fit, rgba } from "../../layout.ts";
import { brandColor, CardFrame, DIM, glass, glow, rise, Tile, useBuild } from "./kit.tsx";

/** The two sides slide in from their own edges, the VS badge lands between them, and the side
 * the speaker favours lights up in the accent. Side by side, or one above the other when the
 * card is narrow. */
export function Versus({ params, layout }: { params: VersusParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const build = useBuild(1.4);
  const row = layout.ratio > 0.75;
  const badge = 14 * u;
  const panelWidth = row ? (box.width - badge * 0.6) / 2 : box.width;
  const panelHeight = row ? box.height : (box.height - badge * 0.6) / 2;
  const sides = [
    ["left", params.left],
    ["right", params.right],
  ] as const;
  const verdict = build.at(0.8);
  return (
    <CardFrame
      layout={layout}
      accent={accent}
      style={{ alignItems: "center", justifyContent: "center" }}
    >
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: row ? "row" : "column",
          gap: badge * 0.6,
          width: "100%",
          height: "100%",
        }}
      >
        {sides.map(([key, side], k) => {
          const p = build.at(k * 0.12, 0.6);
          const winner = params.winner === key;
          const loser = params.winner !== undefined && !winner;
          const offset = (1 - p) * 8 * u * (k === 0 ? -1 : 1);
          const color = side.logo ? brandColor(side.logo, accent) : winner ? accent : COLORS.paper;
          const inner = Math.min(panelWidth, panelHeight * 1.2) - 6 * u;
          return (
            <div
              key={key}
              style={{
                ...glass(u, winner ? 1.5 : 1),
                width: panelWidth,
                height: panelHeight,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 2.4 * u,
                padding: 3 * u,
                textAlign: "center",
                opacity: p * (loser ? 1 - 0.35 * verdict : 1),
                transform: row ? `translateX(${offset}px)` : `translateY(${offset}px)`,
                ...(winner
                  ? {
                      border: `${Math.max(1, 0.3 * u)}px solid ${rgba(accent, 0.3 + 0.6 * verdict)}`,
                      boxShadow: `0 0 ${6 * u * verdict}px ${rgba(accent, 0.35)}`,
                    }
                  : {}),
              }}
            >
              {side.icon || side.logo ? (
                <Tile
                  icon={side.icon}
                  logo={side.logo}
                  size={Math.min(18 * u, panelHeight * 0.26)}
                  color={color === COLORS.paper ? accent : color}
                  u={u}
                />
              ) : null}
              <div
                style={{
                  fontSize: fit(side.name, type("heading"), inner),
                  fontWeight: 900,
                  whiteSpace: "nowrap",
                  color: winner ? accent : COLORS.paper,
                  textShadow: winner ? glow(accent, u, verdict * 0.6) : "none",
                }}
              >
                {side.name}
              </div>
              {(side.points ?? []).map((point, j) => (
                <div
                  key={point}
                  style={{
                    fontSize: fit(point, type("body") * 1.1, inner),
                    fontWeight: 500,
                    color: DIM,
                    whiteSpace: "nowrap",
                    ...rise(build.at(0.45 + j * 0.1 + k * 0.05), u, 2),
                  }}
                >
                  {point}
                </div>
              ))}
            </div>
          );
        })}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: badge,
            height: badge,
            marginLeft: -badge / 2,
            marginTop: -badge / 2,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: accent,
            color: COLORS.ink,
            fontSize: badge * 0.4,
            fontWeight: 900,
            fontStyle: "italic",
            boxShadow: `${glow(accent, u)}, 0 0 0 ${1.2 * u}px ${COLORS.ink}`,
            transform: `scale(${build.at(0.3, 0.4)})`,
          }}
        >
          VS
        </div>
      </div>
    </CardFrame>
  );
}
