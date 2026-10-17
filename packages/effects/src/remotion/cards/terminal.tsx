import type { TerminalParams } from "../../cards.ts";
import { CARD_COLORS, type CardLayout, COLORS } from "../../layout.ts";
import { CardFrame, Caret, DIM, monoFamily, rise, typed, useBuild } from "./kit.tsx";
import { Window } from "./window.tsx";

/** When each line starts and how long it takes: commands type out, output prints at once after
 * a beat. Seconds. */
function schedule(lines: TerminalParams["lines"]) {
  let at = 0.35;
  return lines.map((line) => {
    const start = at;
    const length = line.kind === "command" ? Math.min(1.2, [...line.text].length / 28) : 0;
    at += length + (line.kind === "command" ? 0.3 : 0.12);
    return { start, length };
  });
}

/** A terminal window: each command types out after its prompt with a cursor, and its output
 * prints after a beat, green for success and red for errors. */
export function Terminal({ params, layout }: { params: TerminalParams; layout: CardLayout }) {
  const { u, type, box } = layout;
  const accent = params.accent ?? COLORS.accent;
  const steps = schedule(params.lines);
  const last = steps[steps.length - 1] as (typeof steps)[number];
  const build = useBuild(last.start + last.length + 0.2);
  const width = Math.min(box.width, Math.max(box.height * 2.2, 100 * u));
  const longest = Math.max(...params.lines.map((line) => [...line.text].length + 2));
  // A size at which most lines fit on one line; longer ones wrap.
  const size = Math.max(
    type("body") * 0.95,
    Math.min(type("body") * 1.2, (width - 6 * u) / (longest * 0.6)),
  );
  // The cursor waits at the end of the last line printed so far.
  const cursorLine = steps.filter((step) => build.at(step.start, 0.01) > 0).length - 1;
  const colors = {
    command: COLORS.paper,
    output: DIM,
    success: CARD_COLORS.good,
    error: CARD_COLORS.bad,
  };
  return (
    <CardFrame
      layout={layout}
      accent={accent}
      style={{ alignItems: "center", justifyContent: "center" }}
    >
      <Window
        layout={layout}
        title={params.title ?? "terminal"}
        width={width}
        style={rise(build.at(0, 0.4), u, 2)}
      >
        <div
          style={{
            padding: `${2.4 * u}px ${3 * u}px`,
            fontFamily: monoFamily,
            fontSize: size,
            lineHeight: 1.55,
            whiteSpace: "pre-wrap",
          }}
        >
          {params.lines.map((line, k) => {
            const step = steps[k] as (typeof steps)[number];
            const progress = build.linear(step.start, step.length);
            // Lines still to come keep their place, so the window does not grow as they print.
            const started = build.at(step.start, 0.01) > 0;
            const command = line.kind === "command";
            return (
              <div
                key={step.start}
                style={{
                  color: colors[line.kind],
                  fontWeight: command ? 700 : 400,
                  visibility: started ? "visible" : "hidden",
                }}
              >
                {command ? <span style={{ color: accent }}>$ </span> : null}
                {command ? typed(line.text, progress) : line.text}
                {k === cursorLine ? (
                  <Caret seconds={build.seconds} color={COLORS.paper} height={size} />
                ) : null}
                {command ? (
                  <span style={{ color: "transparent" }}>
                    {line.text.slice(typed(line.text, progress).length)}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </Window>
    </CardFrame>
  );
}
