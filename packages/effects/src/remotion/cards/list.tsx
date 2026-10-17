import type { ListParams } from "../../cards.ts";
import { type CardLayout, COLORS, fit, rgba } from "../../layout.ts";
import { CardFrame, DIM, glass, glow, Heading, rise, useBuild } from "./kit.tsx";

/** Items build in one after another, each behind a numbered badge: rows down the card, or side
 * by side in a wide panel. With `active`, that item is lit and the rest wait dimmed, so one card
 * serves every item of a spoken list. */
export function List({ params, layout }: { params: ListParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const { items, active } = params;
  const build = useBuild(0.6 + items.length * 0.14);
  const wide = layout.ratio > 2.2;
  const titleSpace = params.title ? type("heading") * 1.2 + 4 * u : 0;
  const gap = 2.4 * u;
  const room = box.height - titleSpace;
  // A row's height, or in a wide panel the height of each item's card.
  const cell = wide
    ? Math.min(room, 60 * u)
    : Math.min(26 * u, (room - (items.length - 1) * gap) / items.length);
  const badge = wide ? Math.min(14 * u, cell * 0.3) : cell * 0.56;
  const textWidth = wide
    ? (box.width - (items.length - 1) * gap) / items.length - 6 * u
    : box.width - badge - 9 * u;
  const hasDetail = items.some((item) => item.detail);
  const itemSize = wide
    ? type("item") * 1.1
    : Math.min(type("item") * 1.15, cell * (hasDetail ? 0.34 : 0.42));
  return (
    <CardFrame layout={layout} accent={accent}>
      <Heading text={params.title} layout={layout} progress={build.at(0)} />
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: wide ? "row" : "column",
          justifyContent: "center",
          alignItems: "stretch",
          gap,
        }}
      >
        {items.map((item, k) => {
          const lit = active === undefined || active === k + 1;
          const p = build.at(0.12 + k * 0.14);
          return (
            <div
              key={item.text}
              style={{
                ...glass(u, lit ? 1.4 : 0.7),
                flex: wide ? 1 : undefined,
                height: wide ? cell : cell,
                alignSelf: "center",
                width: wide ? undefined : "100%",
                display: "flex",
                flexDirection: wide ? "column" : "row",
                alignItems: wide ? "flex-start" : "center",
                justifyContent: wide ? "center" : "flex-start",
                gap: wide ? 2.4 * u : 3 * u,
                padding: wide ? `0 ${3 * u}px` : `0 ${3 * u}px`,
                opacity: p * (lit ? 1 : 0.38),
                transform: rise(p, u).transform,
                ...(active === k + 1
                  ? {
                      border: `${Math.max(1, 0.25 * u)}px solid ${rgba(accent, 0.8)}`,
                      boxShadow: `0 0 ${4 * u}px ${rgba(accent, 0.3)}`,
                    }
                  : {}),
              }}
            >
              <div
                style={{
                  width: badge,
                  height: badge,
                  flexShrink: 0,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: lit ? accent : rgba(COLORS.paper, 0.18),
                  color: COLORS.ink,
                  fontSize: badge * 0.54,
                  fontWeight: 900,
                  boxShadow: lit ? glow(accent, u, 0.6) : "none",
                }}
              >
                {k + 1}
              </div>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontSize: fit(item.text, itemSize, textWidth),
                    fontWeight: 700,
                    lineHeight: 1.2,
                    whiteSpace: "nowrap",
                  }}
                >
                  {item.text}
                </div>
                {item.detail ? (
                  <div
                    style={{
                      marginTop: 0.6 * u,
                      fontSize: fit(item.detail, itemSize * 0.66, textWidth),
                      fontWeight: 500,
                      color: DIM,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {item.detail}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </CardFrame>
  );
}
