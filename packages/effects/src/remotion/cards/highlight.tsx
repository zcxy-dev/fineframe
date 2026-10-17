import type { HighlightParams } from "../../cards.ts";
import { type CardLayout, COLORS } from "../../layout.ts";
import { CardFrame, DIM, fitBlock, glue, rise, useBuild } from "./kit.tsx";

/** `text` split into plain runs and the highlighted phrases, each phrase at its first place. */
function runs(text: string, phrases: string[]): { text: string; mark: number; at: number }[] {
  const marks = phrases
    .map((phrase, k) => ({
      at: text.indexOf(phrase),
      end: text.indexOf(phrase) + phrase.length,
      k,
    }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at);
  const out: { text: string; mark: number; at: number }[] = [];
  let at = 0;
  for (const m of marks) {
    if (m.at < at) continue;
    if (m.at > at) out.push({ text: text.slice(at, m.at), mark: -1, at });
    out.push({ text: text.slice(m.at, m.end), mark: m.k, at: m.at });
    at = m.end;
  }
  if (at < text.length) out.push({ text: text.slice(at), mark: -1, at });
  return out;
}

/** The statement rises in large type, then a highlighter sweeps across each key phrase in turn,
 * turning it to ink on the accent. */
export function Highlight({ params, layout }: { params: HighlightParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const build = useBuild(0.5 + params.highlights.length * 0.4 + 0.2);
  const size = fitBlock(
    params.text,
    type("display"),
    box.width * 0.96,
    box.height - (params.source ? 12 * u : 0),
    1.32,
  );
  return (
    <CardFrame layout={layout} accent={accent} style={{ justifyContent: "center", gap: 4 * u }}>
      <div
        style={{
          fontSize: size,
          fontWeight: 900,
          lineHeight: 1.32,
          textWrap: "pretty",
          wordBreak: "keep-all",
          ...rise(build.at(0), u),
        }}
      >
        {runs(params.text, params.highlights).map((run) => {
          if (run.mark < 0) return <span key={run.at}>{glue(run.text)}</span>;
          const swept = build.at(0.45 + run.mark * 0.4, 0.45);
          return (
            <span
              key={run.at}
              style={{
                padding: "0 0.08em",
                margin: "0 -0.02em",
                borderRadius: "0.12em",
                backgroundImage: `linear-gradient(${accent}, ${accent})`,
                backgroundRepeat: "no-repeat",
                backgroundSize: `${swept * 100}% 100%`,
                boxDecorationBreak: "clone",
                WebkitBoxDecorationBreak: "clone",
                color: swept > 0.5 ? COLORS.ink : COLORS.paper,
              }}
            >
              {glue(run.text)}
            </span>
          );
        })}
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
