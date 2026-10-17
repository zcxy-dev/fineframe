import type { ChecklistParams } from "../../cards.ts";
import { type CardLayout, COLORS, fit, rgba } from "../../layout.ts";
import { CardFrame, DIM, Heading, rise, useBuild } from "./kit.tsx";

/** The items rise in together, then their boxes tick one after another from the top, each item
 * brightening as it is ticked. */
export function Checklist({ params, layout }: { params: ChecklistParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const { items } = params;
  const checked = params.checked ?? items.length;
  const build = useBuild(0.6 + checked * 0.32);
  const columns = layout.ratio > 2.4 && items.length >= 4 ? 2 : 1;
  const perColumn = Math.ceil(items.length / columns);
  const titleSpace = params.title ? type("heading") * 1.2 + 4 * u : 0;
  const rowHeight = Math.min(18 * u, (box.height - titleSpace) / perColumn);
  const size = Math.min(type("item") * 1.15, rowHeight * 0.48);
  const boxSize = size * 1.2;
  const textWidth = box.width / columns - boxSize - 6 * u;
  return (
    <CardFrame layout={layout} accent={accent}>
      <Heading text={params.title} layout={layout} progress={build.at(0)} />
      <div
        style={{
          flex: 1,
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, 1fr)`,
          gridAutoFlow: "column",
          gridTemplateRows: `repeat(${perColumn}, ${rowHeight}px)`,
          alignContent: "center",
          columnGap: 4 * u,
        }}
      >
        {items.map((item, k) => {
          const shown = build.at(0.1 + k * 0.06);
          const tick = k < checked ? build.at(0.5 + k * 0.32, 0.36) : 0;
          return (
            <div
              key={item}
              style={{ display: "flex", alignItems: "center", gap: 2.6 * u, ...rise(shown, u, 2) }}
            >
              <svg
                width={boxSize}
                height={boxSize}
                viewBox="0 0 24 24"
                style={{ flexShrink: 0 }}
                aria-hidden
              >
                <rect
                  x="1.5"
                  y="1.5"
                  width="21"
                  height="21"
                  rx="5"
                  fill={rgba(accent, 0.9 * tick)}
                  stroke={tick > 0 ? accent : rgba(COLORS.paper, 0.5)}
                  strokeWidth="2"
                />
                <path
                  d="M6.5 12.5l3.6 3.6 7.4-8"
                  fill="none"
                  stroke={COLORS.ink}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength={1}
                  strokeDasharray={1}
                  strokeDashoffset={1 - tick}
                />
              </svg>
              <div
                style={{
                  fontSize: fit(item, size, textWidth),
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  color: tick > 0.5 ? COLORS.paper : DIM,
                }}
              >
                {item}
              </div>
            </div>
          );
        })}
      </div>
    </CardFrame>
  );
}
