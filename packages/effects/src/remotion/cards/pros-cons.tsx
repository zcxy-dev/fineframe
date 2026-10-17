import type { ProsConsParams } from "../../cards.ts";
import { CARD_COLORS, type CardLayout, COLORS, fit, rgba } from "../../layout.ts";
import { CardFrame, glass, Heading, Icon, rise, useBuild } from "./kit.tsx";

/** Two columns rise in, the upsides with ticks and then the downsides with crosses, one row at a
 * time: side by side, or one above the other when the card is narrow. */
export function ProsCons({ params, layout }: { params: ProsConsParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const rows = Math.max(params.pros.length, params.cons.length);
  const build = useBuild(0.4 + (params.pros.length + params.cons.length) * 0.14 + 0.3);
  const row = layout.ratio > 0.8;
  const gap = 3 * u;
  const titleSpace = params.title ? type("heading") * 1.2 + 4 * u : 0;
  const columnWidth = row ? (box.width - gap) / 2 : box.width;
  const columnHeight = row ? box.height - titleSpace : (box.height - titleSpace - gap) / 2;
  const lineHeight =
    (columnHeight - 14 * u) / (row ? rows : Math.max(params.pros.length, params.cons.length));
  const size = Math.min(type("item"), lineHeight * 0.5);
  const columns = [
    {
      label: params.prosLabel ?? "優點",
      items: params.pros,
      color: CARD_COLORS.good,
      icon: "check" as const,
      from: 0.15,
    },
    {
      label: params.consLabel ?? "缺點",
      items: params.cons,
      color: CARD_COLORS.bad,
      icon: "x" as const,
      from: 0.25 + params.pros.length * 0.14,
    },
  ];
  return (
    <CardFrame layout={layout} accent={accent}>
      <Heading text={params.title} layout={layout} progress={build.at(0)} />
      <div style={{ flex: 1, display: "flex", flexDirection: row ? "row" : "column", gap }}>
        {columns.map((column, c) => (
          <div
            key={column.label}
            style={{
              ...glass(u),
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: 1.2 * u,
              padding: `${3 * u}px ${3.4 * u}px`,
              borderTop: `${0.6 * u}px solid ${column.color}`,
              ...rise(build.at(c * 0.1), u),
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 1.4 * u,
                fontSize: type("item"),
                fontWeight: 900,
                color: column.color,
                marginBottom: 0.8 * u,
              }}
            >
              {column.label}
            </div>
            {column.items.map((item, k) => (
              <div
                key={item}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1.8 * u,
                  minHeight: lineHeight * 0.8,
                  ...rise(build.at(column.from + k * 0.14), u, 2),
                }}
              >
                <div
                  style={{
                    width: size * 1.2,
                    height: size * 1.2,
                    flexShrink: 0,
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: rgba(column.color, 0.18),
                  }}
                >
                  <Icon name={column.icon} size={size * 0.8} color={column.color} stroke={3} />
                </div>
                <div
                  style={{
                    fontSize: fit(item, size, columnWidth - size * 1.2 - 10 * u),
                    fontWeight: 700,
                    whiteSpace: "nowrap",
                  }}
                >
                  {item}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </CardFrame>
  );
}
