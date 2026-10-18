import assert from "node:assert/strict";
import { test } from "node:test";
import { afterAnalysis, Finish, formatEstimate } from "./eta.ts";
import type { Stage } from "./jobs.ts";

/** Where the bar is at the start of each step of an edit that analyses one file: vework's steps
 * (../../../packages/engine/src/edit/analyze.ts) over nine tenths of it, the transcript in
 * chunks, then the plan, the render and the check. */
const ANALYSIS = [
  ...[0, 0.2, 0.2, 0.21, 0.22, 0.34],
  ...Array.from({ length: 10 }, (_, i) => 0.35 + 0.042 * i),
  ...Array.from({ length: 5 }, (_, i) => 0.77 + 0.046 * i),
].map((start) => start * 0.9);
const AFTER: [number, Stage][] = [
  [0.9, "plan"],
  [0.915, "plan"],
  [0.93, "render"],
  [0.945, "render"],
  [0.96, "check"],
  [0.98, "check"],
];

/** A line at each step's start of an edit of `length` seconds whose analysis takes `analysis`
 * seconds, each of its steps 0.6 to 1.4 times its share of the bar, and whose later stages take
 * 0.6 to 1.4 times what afterAnalysis says. Seeded, so the test always sees the same runs. */
function run(analysis: number, length: number, seed: number) {
  let state = seed;
  const random = () => {
    state = (state * 16807) % 2147483647;
    return state / 2147483647;
  };
  const steps = [
    ...ANALYSIS.map((fraction): [number, Stage] => [fraction, "analyze"]),
    ...AFTER,
  ].map(([fraction, stage], i, all) => {
    const share = ((all[i + 1]?.[0] ?? 1) - fraction) / (stage === "analyze" ? 0.9 : 0.1);
    const seconds = share * (stage === "analyze" ? analysis : afterAnalysis(length));
    return { fraction, stage, takes: seconds * 1000 * (0.6 + 0.8 * random()) };
  });
  let at = 0;
  const lines = steps.map(({ fraction, stage, takes }) => {
    const line = { at, fraction, stage };
    at += takes;
    return line;
  });
  return { lines, end: at };
}

test("the time left counts down, never jumping, and nears the truth as the edit goes on", () => {
  for (const [analysis, length] of [
    [120, 60],
    [600, 60],
    [1500, 300],
    [3600, 600],
  ] as const) {
    for (let seed = 1; seed <= 20; seed++) {
      const finish = new Finish(length);
      const { lines, end } = run(analysis, length, seed);
      let previous: { at: number; estimate: number } | undefined;
      for (const { at, fraction, stage } of lines) {
        const estimate = finish.update(at, fraction, stage);
        if (estimate === undefined) continue;
        if (previous) {
          // The finish moves by at most half the time since the last line: the time left only
          // goes down, at half to one and a half times the clock's pace.
          const most = (at - previous.at) / 2;
          assert.ok(
            Math.abs(estimate - previous.estimate) <= most + 1e-6,
            `${analysis} s run ${seed}: the finish moved ${(estimate - previous.estimate) / 1000} s`,
          );
        }
        // Past half the edit, within a quarter of its length of the truth, as near as steps
        // that each take up to 40 % more or less than their share allow.
        if (at > end / 2) {
          assert.ok(Math.abs(estimate - end) < end / 4, `${analysis} s run ${seed}`);
        }
        previous = { at, estimate };
      }
      assert.ok(previous, "an estimate");
    }
  }
});

test("the stages after the analysis take what the edit's length says, from where they start", () => {
  // Analysed before: the plan starts at once, and the estimate with it.
  const finish = new Finish(60);
  assert.equal(finish.update(0, 0, "analyze"), undefined);
  assert.equal(finish.update(1000, 0, "plan"), 1000 + afterAnalysis(60) * 1000);
});

test("a download's wait moves the finish by as long, without changing the rate", () => {
  const finish = new Finish(60);
  const after = afterAnalysis(60) * 1000;
  assert.equal(finish.update(0, 0, "analyze"), undefined);
  assert.equal(finish.update(20_000, 0.1, "analyze"), undefined, "too soon to say");
  // 0.3 of the bar in a minute: the analysis's 0.9 in three.
  const before = Math.round(finish.update(60_000, 0.3, "analyze") ?? assert.fail("no estimate"));
  assert.equal(before, 180_000 + after);
  // Two minutes of download are not the edit's work: the finish moves by as long, and the rate
  // after it is what it was.
  finish.update(60_000, 0.3, "analyze", true);
  assert.equal(Math.round(finish.update(180_000, 0.3, "analyze", true) ?? 0), before + 120_000);
  assert.equal(Math.round(finish.update(180_000, 0.3, "analyze") ?? 0), before + 120_000);
  assert.equal(Math.round(finish.update(200_000, 0.4, "analyze") ?? 0), before + 120_000);
});

test("the time left reads more roughly the longer it is", () => {
  assert.equal(formatEstimate(40), "Less than a minute left");
  assert.equal(formatEstimate(4 * 60 + 20), "About 4 min left");
  assert.equal(formatEstimate(23 * 60), "About 25 min left");
  assert.equal(formatEstimate(64 * 60), "About 1 h 5 min left");
  assert.equal(formatEstimate(119 * 60), "About 2 h left");
});
