import assert from "node:assert/strict";
import { test } from "node:test";
import type { TimedWord } from "./captions.ts";
import { plannedOverlays } from "./effects.ts";
import type { PlanState } from "./plan.ts";

const T = 120_000;

/** One line for each of a, b and c, named Ada Lane, Ben Ito and Cy Hart. */
function talk(): PlanState {
  const source = (id: string) => ({ id, lines: [{ n: 1, first: 0, last: 3 }] });
  const person = (name: string, source: string) => ({ name, role: "", source, line: 1 });
  return {
    fps: { num: 25, den: 1 },
    sources: new Map(["a", "b", "c"].map((id) => [id, source(id)])),
    names: ["Ada Lane", "Ben Ito", "Cy Hart"],
    extras: {},
    regions: new Map(),
    decisions: {
      people: [person("Ada Lane", "a"), person("Ben Ito", "b"), person("Cy Hart", "c")],
      emphasis: [],
    },
  } as unknown as PlanState;
}

/** Four words a second apart from `from` seconds. */
const said = (source: string, from: number): TimedWord[] =>
  [0, 1, 2, 3].map((i) => ({
    source,
    index: i,
    text: source,
    start: (from + i) * T,
    end: (from + i + 0.8) * T,
  }));

const span = (start: number, end: number) => ({ start: start * T, end: end * T });

test("a lower third shows while someone on screen talks, in one shot, or is left out", () => {
  // Ada talks from 0.5 s in a shot cut at 2.9 s. Ben talks from 6 s, but his shot changes at
  // 6.2 s, and the next shows him talking until 9.5 s. Cy talks from 12 s in a shot cut at
  // 16 s, but the camera is on someone who listens.
  const words = [...said("a", 0.5), ...said("b", 6), ...said("c", 12)];
  const changes = [2.9 * T, 6.2 * T, 9.8 * T, 16 * T];
  const speaking = [span(0.5, 2.9), span(6, 6.2), span(6.2, 9.5)];
  const overlays = plannedOverlays(
    talk(),
    words,
    20 * T,
    [],
    [2.9 * T, 9.8 * T],
    new Map(),
    changes,
    speaking,
  );
  const spans = overlays.map((o) => [o.params.name, o.start / T, (o.start + o.duration) / T]);
  // Ada's comes in as she starts, not 1 s later, to show 2 s before the cut; Ben's waits for the
  // shot that shows him; Cy's is left out.
  assert.deepEqual(spans, [
    ["Ada Lane", 0.88, 2.88],
    ["Ben Ito", 7.2, 9.48],
  ]);
});

test("a keyword pop ends before the shot changes, or is left out", () => {
  const state = talk();
  const emphasis = (keyword: string, line: number) => ({
    source: "a",
    line,
    text: keyword,
    keyword,
    reason: "",
  });
  const lines = [
    { n: 1, first: 0, last: 0 },
    { n: 2, first: 1, last: 1 },
  ];
  const said = [{ text: "novel" }, { text: "data" }];
  state.sources.set("a", { id: "a", lines, words: said } as never);
  state.decisions = { people: [], emphasis: [emphasis("novel", 1), emphasis("data", 2)] } as never;
  // "novel" is said 1 s before the cut, "data" 0.5 s before the next.
  const words: TimedWord[] = [
    { source: "a", index: 0, text: "novel", start: 2 * T, end: 2.6 * T },
    { source: "a", index: 1, text: "data", start: 9.5 * T, end: 9.9 * T },
  ];
  const overlays = plannedOverlays(state, words, 60 * T, [], [3 * T, 10 * T], new Map());
  const spans = overlays.map((o) => [o.params.text, o.start / T, (o.start + o.duration) / T]);
  assert.deepEqual(spans, [["novel", 1.84, 3]]);
});
