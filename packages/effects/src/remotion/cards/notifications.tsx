import type { NotificationsParams } from "../../cards.ts";
import { type CardLayout, COLORS, fit, rgba } from "../../layout.ts";
import { brandColor, CardFrame, DIM, FAINT, rise, Tile, useBuild } from "./kit.tsx";

/** Phone notifications drop in from above one after another, each on a frosted plate with its
 * app's tile, name and time over the title and text. */
export function Notifications({
  params,
  layout,
}: {
  params: NotificationsParams;
  layout: CardLayout;
}) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const { items } = params;
  const per = 0.4;
  const build = useBuild(0.2 + items.length * per + 0.3);
  const width = Math.min(box.width, Math.max(box.height * 1.4, 100 * u));
  const gap = 2 * u;
  const height = Math.min(30 * u, (box.height - gap * (items.length - 1)) / items.length);
  const size = Math.min(type("item"), height * 0.22);
  const tile = Math.min(11 * u, height * 0.5);
  const textWidth = width - tile - 10 * u;
  return (
    <CardFrame
      layout={layout}
      accent={accent}
      style={{ alignItems: "center", justifyContent: "center", gap }}
    >
      {items.map((item, k) => {
        const p = build.at(0.2 + k * per, 0.45);
        const color = item.logo ? brandColor(item.logo, accent) : accent;
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: notifications keep their places in the stack
            key={k}
            style={{
              width,
              height,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 2.4 * u,
              padding: `0 ${3 * u}px`,
              borderRadius: 3.4 * u,
              background: rgba("#2a2c33", 0.82),
              border: `${Math.max(1, 0.18 * u)}px solid ${rgba(COLORS.paper, 0.12)}`,
              boxShadow: `0 ${1.6 * u}px ${5 * u}px ${rgba("#000000", 0.5)}`,
              opacity: p,
              transform: `translateY(${-(1 - p) * 6 * u}px) scale(${0.94 + 0.06 * p})`,
            }}
          >
            <Tile
              icon={item.icon ?? (item.logo ? undefined : "bell")}
              logo={item.logo}
              size={tile}
              color={color}
              u={u}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: size * 0.72,
                  fontWeight: 700,
                  color: FAINT,
                  letterSpacing: "0.04em",
                }}
              >
                <span style={{ whiteSpace: "nowrap" }}>{item.app}</span>
                <span>{item.time}</span>
              </div>
              <div
                style={{
                  fontSize: fit(item.title, size, textWidth),
                  fontWeight: 900,
                  whiteSpace: "nowrap",
                  lineHeight: 1.3,
                }}
              >
                {item.title}
              </div>
              <div
                style={{
                  fontSize: fit(item.text, size * 0.86, textWidth),
                  fontWeight: 500,
                  color: DIM,
                  whiteSpace: "nowrap",
                  ...rise(Math.min(1, p * 1.2), u, 0.5),
                }}
              >
                {item.text}
              </div>
            </div>
          </div>
        );
      })}
    </CardFrame>
  );
}
