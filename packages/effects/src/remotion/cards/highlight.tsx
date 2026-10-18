import { useMemo } from "react";
import type { HighlightParams } from "../../cards.ts";
import { type CardLayout, COLORS, STATEMENT_LEADING, setStatement } from "../../layout.ts";
import { CardFrame, DIM, rise, useBuild } from "./kit.tsx";
import { markStyle } from "./mark.ts";

/** The statement rises in large type, set in balanced lines that fill the card, then a
 * highlighter sweeps across each key phrase in turn, turning it to ink on the accent. */
export function Highlight({ params, layout }: { params: HighlightParams; layout: CardLayout }) {
  const { u, type } = layout;
  const accent = params.accent ?? COLORS.accent;
  const build = useBuild(0.5 + params.highlights.length * 0.4 + 0.2);
  const set = useMemo(
    () =>
      setStatement(
        params.text,
        params.highlights,
        layout,
        layout.box.height - (params.source ? 12 * u : 0),
      ),
    [params.text, params.highlights, params.source, layout, u],
  );
  return (
    <CardFrame layout={layout} accent={accent} style={{ justifyContent: "center", gap: 4 * u }}>
      <div
        style={{
          fontSize: set.size,
          fontWeight: 900,
          lineHeight: STATEMENT_LEADING,
          isolation: "isolate",
          ...rise(build.at(0), u),
        }}
      >
        {set.lines.map((line, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the lines never reorder.
          <div key={i} style={{ whiteSpace: "pre" }}>
            {line.map((segment, j) => {
              // biome-ignore lint/suspicious/noArrayIndexKey: the segments never reorder.
              if (segment.mark < 0) return <span key={j}>{segment.text}</span>;
              const swept = build.at(0.45 + segment.mark * 0.4, 0.45);
              const mark = markStyle(swept, accent);
              return (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: the segments never reorder.
                  key={j}
                  style={{ ...mark.text, color: swept > 0.5 ? COLORS.ink : COLORS.paper }}
                >
                  <span style={mark.box} />
                  {segment.text}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      {params.source ? (
        <div
          style={{
            fontSize: type("body"),
            fontWeight: 500,
            color: DIM,
            ...rise(build.at(0.3), u, 2),
          }}
        >
          — {params.source}
        </div>
      ) : null}
    </CardFrame>
  );
}
