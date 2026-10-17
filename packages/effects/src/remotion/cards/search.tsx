import type { SearchParams } from "../../cards.ts";
import { type CardLayout, COLORS, fit, rgba } from "../../layout.ts";
import { CardFrame, Caret, DIM, glass, Icon, rise, typed, useBuild } from "./kit.tsx";

/** The search box rises, the query types into it behind a cursor, the box lights as if searched,
 * and the results slide in under it. */
export function Search({ params, layout }: { params: SearchParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const results = params.results ?? [];
  const typing = Math.min(1.2, [...params.query].length / 18);
  const searched = 0.35 + typing + 0.15;
  const build = useBuild(searched + results.length * 0.15 + 0.4);
  const width = Math.min(box.width, Math.max(box.height * 1.8, 100 * u));
  const resultRoom = box.height - 18 * u;
  const barHeight = Math.min(16 * u, box.height / (results.length + 1.6));
  const size = Math.min(type("item") * 1.1, barHeight * 0.38);
  const lit = build.at(searched, 0.3);
  const resultHeight = Math.min(
    barHeight * 1.05,
    results.length ? resultRoom / results.length - 2 * u : 0,
  );
  return (
    <CardFrame
      layout={layout}
      accent={accent}
      style={{ alignItems: "center", justifyContent: "center", gap: 3 * u }}
    >
      <div
        style={{
          width,
          height: barHeight,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 2.4 * u,
          padding: `0 ${3.6 * u}px`,
          borderRadius: 999,
          background: rgba(COLORS.paper, 0.1),
          border: `${Math.max(1, 0.3 * u)}px solid ${rgba(accent, 0.3 + 0.6 * lit)}`,
          boxShadow: `0 0 ${5 * u * lit}px ${rgba(accent, 0.35)}, 0 ${1.6 * u}px ${5 * u}px ${rgba("#000000", 0.45)}`,
          ...rise(build.at(0, 0.4), u, 2),
        }}
      >
        <Icon name="search" size={size * 1.2} color={lit > 0.5 ? accent : DIM} stroke={2.4} />
        <div
          style={{
            fontSize: fit(params.query, size, width - 14 * u),
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
          {typed(params.query, build.linear(0.35, typing))}
          {lit < 1 ? <Caret seconds={build.seconds} color={accent} height={size * 1.1} /> : null}
        </div>
      </div>
      {results.map((result, k) => (
        <div
          key={result.url + result.title}
          style={{
            ...glass(u),
            width,
            height: resultHeight,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: 0.6 * u,
            padding: `0 ${3.6 * u}px`,
            ...rise(build.at(searched + 0.1 + k * 0.15), u, 3),
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 1 * u,
              fontSize: size * 0.62,
              color: DIM,
            }}
          >
            <Icon name="globe" size={size * 0.62} color={DIM} />
            {result.url}
          </div>
          <div
            style={{
              fontSize: fit(result.title, size * 0.9, width - 8 * u),
              fontWeight: 700,
              color: k === 0 ? accent : COLORS.paper,
              whiteSpace: "nowrap",
            }}
          >
            {result.title}
          </div>
        </div>
      ))}
    </CardFrame>
  );
}
