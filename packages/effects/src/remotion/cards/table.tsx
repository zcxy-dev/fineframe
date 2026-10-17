import type { TableParams } from "../../cards.ts";
import { CARD_COLORS, type CardLayout, COLORS, fit, rgba } from "../../layout.ts";
import { brandColor, CardFrame, DIM, glass, Icon, Mark, rise, useBuild } from "./kit.tsx";

/** A feature table: the header rises, then each row in turn, with ticks, crosses or short values
 * under each product; the column the speaker recommends is lit. */
export function Table({ params, layout }: { params: TableParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const { columns, rows } = params;
  const lit = (params.highlight ?? 0) - 1;
  const build = useBuild(0.3 + rows.length * 0.15 + 0.3);
  // The panel's inner width, inside its padding and border, which the cells fill exactly.
  const inner = box.width - 4 * u - 2 * Math.max(1, 0.18 * u);
  const labelWidth = inner * (columns.length === 2 ? 0.4 : 0.34);
  const cellWidth = (inner - labelWidth) / columns.length;
  const rowHeight = Math.min(16 * u, box.height / (rows.length + 1.3));
  const size = Math.min(type("item"), rowHeight * 0.4);
  return (
    <CardFrame layout={layout} accent={accent} style={{ justifyContent: "center", gap: 0 }}>
      <div
        style={{ position: "relative", ...glass(u), padding: `0 ${2 * u}px`, overflow: "hidden" }}
      >
        {lit >= 0 ? (
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: 2 * u + labelWidth + cellWidth * lit,
              width: cellWidth,
              flexShrink: 0,
              background: rgba(accent, 0.1),
              borderLeft: `${Math.max(1, 0.25 * u)}px solid ${rgba(accent, 0.6)}`,
              borderRight: `${Math.max(1, 0.25 * u)}px solid ${rgba(accent, 0.6)}`,
              opacity: build.at(0.3 + rows.length * 0.15, 0.4),
            }}
          />
        ) : null}
        <div
          style={{
            display: "flex",
            height: rowHeight * 1.3,
            alignItems: "center",
            ...rise(build.at(0), u, 2),
          }}
        >
          <div style={{ width: labelWidth, flexShrink: 0 }} />
          {columns.map((column, c) => (
            <div
              key={column.name}
              style={{
                width: cellWidth,
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 1.2 * u,
              }}
            >
              <Mark
                icon={column.icon}
                logo={column.logo}
                size={size * 1.1}
                color={column.logo ? brandColor(column.logo, accent) : COLORS.paper}
              />
              <span
                style={{
                  fontSize: fit(
                    column.name,
                    size,
                    cellWidth - (column.icon || column.logo ? size * 2 : 0) - 2 * u,
                  ),
                  fontWeight: 900,
                  whiteSpace: "nowrap",
                  color: c === lit ? accent : COLORS.paper,
                }}
              >
                {column.name}
              </span>
            </div>
          ))}
        </div>
        {rows.map((row, r) => (
          <div
            key={row.label}
            style={{
              display: "flex",
              height: rowHeight,
              alignItems: "center",
              borderTop: `${Math.max(1, 0.15 * u)}px solid ${rgba(COLORS.paper, 0.1)}`,
              ...rise(build.at(0.2 + r * 0.15), u, 2),
            }}
          >
            <div
              style={{
                width: labelWidth,
                flexShrink: 0,
                fontSize: fit(row.label, size, labelWidth - 4 * u),
                fontWeight: 700,
                color: DIM,
                whiteSpace: "nowrap",
              }}
            >
              {row.label}
            </div>
            {row.values.map((value, c) => (
              <div
                key={columns[c]?.name}
                style={{
                  width: cellWidth,
                  flexShrink: 0,
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                {typeof value === "boolean" ? (
                  <Icon
                    name={value ? "check" : "x"}
                    size={size * 1.2}
                    color={value ? CARD_COLORS.good : rgba(CARD_COLORS.bad, 0.8)}
                    stroke={3}
                  />
                ) : (
                  <span
                    style={{
                      fontSize: fit(value, size, cellWidth - 2 * u),
                      fontWeight: 900,
                      whiteSpace: "nowrap",
                      color: c === lit ? accent : COLORS.paper,
                    }}
                  >
                    {value}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </CardFrame>
  );
}
