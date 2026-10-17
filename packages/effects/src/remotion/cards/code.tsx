import type { CodeParams } from "../../cards.ts";
import { type CardLayout, COLORS, rgba } from "../../layout.ts";
import { CardFrame, FAINT, monoFamily, rise, useBuild } from "./kit.tsx";
import { Window } from "./window.tsx";

const KEYWORDS = new Set(
  "const let var function return await async if else for while import from export class new def await true false null None True False self this type interface".split(
    " ",
  ),
);
const TOKEN = /(\/\/.*|#.*|"[^"]*"|'[^']*'|`[^`]*`|\b\d+(?:\.\d+)?\b|[A-Za-z_]\w*|\s+|.)/g;

/** A line split into coloured runs: keywords in the accent, strings, numbers and comments in their
 * own colours. A light highlighter, not a parser. */
function colourise(line: string, accent: string): { text: string; color: string }[] {
  return (line.match(TOKEN) ?? []).map((text) => {
    let color: string = COLORS.paper;
    if (/^(\/\/|#)/.test(text)) color = FAINT;
    else if (/^["'`]/.test(text)) color = "#a6e3a1";
    else if (/^\d/.test(text)) color = "#fab387";
    else if (KEYWORDS.has(text)) color = accent;
    else if (/^[^\w\s]$/.test(text)) color = rgba(COLORS.paper, 0.6);
    return { text, color };
  });
}

/** An editor window: the code writes in line by line beside its line numbers, and the lines the
 * speaker points at light up. */
export function Code({ params, layout }: { params: CodeParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const { lines } = params;
  const per = Math.min(0.18, 1.4 / lines.length);
  const build = useBuild(0.35 + lines.length * per + 0.5);
  const width = Math.min(box.width, Math.max(box.height * 2.2, 100 * u));
  const longest = Math.max(...lines.map((line) => line.length + 4));
  const size = Math.max(
    type("body") * 0.85,
    Math.min(type("body") * 1.2, (width - 6 * u) / (longest * 0.6)),
  );
  const lit = new Set(params.highlight ?? []);
  const glowOn = build.at(0.35 + lines.length * per, 0.4);
  return (
    <CardFrame
      layout={layout}
      accent={accent}
      style={{ alignItems: "center", justifyContent: "center" }}
    >
      <Window
        layout={layout}
        title={params.filename}
        width={width}
        style={rise(build.at(0, 0.4), u, 2)}
      >
        <div
          style={{
            padding: `${2 * u}px 0`,
            fontFamily: monoFamily,
            fontSize: size,
            lineHeight: 1.6,
          }}
        >
          {lines.map((line, k) => {
            const written = build.linear(0.35 + k * per, per);
            const on = lit.has(k + 1) ? glowOn : 0;
            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: lines keep their places in the file
                key={k}
                style={{
                  display: "flex",
                  whiteSpace: "pre-wrap",
                  background: rgba(accent, 0.14 * on),
                  boxShadow: `inset ${0.6 * u}px 0 0 ${rgba(accent, on)}`,
                  opacity: written > 0 ? 1 : 0,
                }}
              >
                <span
                  style={{
                    width: 4 * size * 0.6 + 2 * u,
                    flexShrink: 0,
                    textAlign: "right",
                    paddingRight: 2 * u,
                    color: FAINT,
                  }}
                >
                  {k + 1}
                </span>
                <span style={{ minWidth: 0, clipPath: `inset(0 ${(1 - written) * 100}% 0 0)` }}>
                  {colourise(line, accent).map((run, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: runs keep their places in the line
                    <span key={j} style={{ color: run.color }}>
                      {run.text}
                    </span>
                  ))}
                </span>
              </div>
            );
          })}
        </div>
      </Window>
    </CardFrame>
  );
}
