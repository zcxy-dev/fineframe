import assert from "node:assert/strict";
import { test } from "node:test";
import { afterAnalysis, Finish, formatEstimate } from "./eta.ts";
import type { Job, Stage } from "./jobs.ts";

type Step = NonNullable<NonNullable<Job["progress"]>["step"]>;

/** Where the bar is at the start of each step of an edit that analyses one file: vework's steps
 * (../../../packages/engine/src/edit/analyze.ts) over nine tenths of it, the transcript in
 * chunks, then the plan, the render and the check. */
const ANALYSIS = [
  ...[0, 0.2, 0.2, 0.21, 0.22, 0.34],
  ...Array.from({ length: 10 }, (_, i) => 0.35 + 0.042 * i),
  ...Array.from({ length: 5 }, (_, i) => 0.77 + 0.046 * i),
].map((start) => start * 0.9);
/** The step each line of ANALYSIS starts. */
const STEPS: Step[] = [
  ...(["probe", "speech", "loudness", "events", "faces", "denoise"] as const),
  ...Array.from({ length: 10 }, () => "transcribe" as const),
  ...Array.from({ length: 5 }, () => "align" as const),
];
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
    ...ANALYSIS.map((fraction, i): [number, Stage, Step?] => [fraction, "analyze", STEPS[i]]),
    ...AFTER,
  ].map(([fraction, stage, step], i, all) => {
    const share = ((all[i + 1]?.[0] ?? 1) - fraction) / (stage === "analyze" ? 0.9 : 0.1);
    const seconds = share * (stage === "analyze" ? analysis : afterAnalysis(length));
    return { fraction, stage, step, takes: seconds * 1000 * (0.6 + 0.8 * random()) };
  });
  let at = 0;
  const lines = steps.map(({ fraction, stage, step, takes }) => {
    const line = { at, fraction, stage, step };
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
      for (const { at, fraction, stage, step } of lines) {
        const estimate = finish.update(at, fraction, stage, false, step);
        if (estimate === undefined) continue;
        if (previous) {
          // The finish moves later by at most half the time since the last line and earlier by
          // at most as long: the time left only goes down, at half to twice the clock's pace.
          const since = at - previous.at;
          const moved = estimate - previous.estimate;
          assert.ok(
            moved <= since / 2 + 1e-6 && moved >= -since - 1e-6,
            `${analysis} s run ${seed}: the finish moved ${moved / 1000} s`,
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

test("a first edit's setup before the footage's steps is not counted at the analysis's pace", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const finish = new Finish(30);
    const { lines, end } = run(120, 30, seed);
    // Checking Claude, FFmpeg downloading, the analysis's Python starting and the music analysed
    // with its beat model downloading: 100 s before the footage's first step.
    const setup: [number, Stage, boolean, Step?][] = [
      [0, "analyze", false],
      [1_000, "analyze", true],
      [40_000, "analyze", false],
      [70_000, "analyze", false, "music"],
      [80_000, "analyze", true, "music"],
      [95_000, "analyze", false, "music"],
    ];
    for (const [at, stage, paused, step] of setup) finish.update(at, 0, stage, paused, step);
    for (const { at, fraction, stage, step } of lines) {
      const estimate = finish.update(100_000 + at, fraction, stage, false, step);
      if (estimate === undefined) continue;
      // The time left within a quarter of the edit's length of the truth from the first estimate
      // on, as the steps after it allow.
      assert.ok(
        Math.abs(estimate - (100_000 + end)) < (100_000 + end) / 4,
        `run ${seed}: ${(estimate - 100_000 - end) / 1000} s off at ${at / 1000} s`,
      );
    }
  }
});

test("a slow start of the footage's first step is not taken as the analysis's pace", () => {
  // Shot detection's first 5 % took 43 s, with its model loading, and each later 5 % 18 s, in a
  // 30 s edit with cloud speech (#224's run 2); the steps after it go at that later pace, then the
  // plan, the render and the check take what afterAnalysis says.
  const share = (0.46 * 0.9) / 20;
  const pace = share / 18_000;
  const lines: [number, number, Stage, Step][] = [[0, 0, "analyze", "probe"]];
  let at = 43_000;
  for (let i = 1; i < 20; i++, at += 18_000) lines.push([at, i * share, "analyze", "shots"]);
  const steps: [number, Step][] = [
    [0.46, "speech"],
    [0.49, "events"],
    [0.52, "faces"],
    [0.66, "denoise"],
    [0.69, "transcribe"],
    [0.76, "align"],
  ];
  let fraction = 19 * share;
  for (const [start, step] of steps) {
    at += (start * 0.9 - fraction) / pace;
    fraction = start * 0.9;
    lines.push([at, fraction, "analyze", step]);
  }
  at += (0.9 - fraction) / pace;
  lines.push([at, 0.9, "plan", "align"]);
  const end = at + afterAnalysis(30) * 1000;
  const finish = new Finish(30);
  for (const [at, fraction, stage, step] of lines) {
    const estimate = finish.update(at, fraction, stage, false, step);
    if (estimate === undefined || at < 60_000) continue;
    // From the first minute on, within a quarter of the edit's time of the truth.
    assert.ok(
      Math.abs(estimate - end) < end / 4,
      `${(estimate - end) / 1000} s off at ${at / 1000} s of ${end / 1000} s`,
    );
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
  const shots = (at: number, fraction: number, downloading = false) =>
    finish.update(at, fraction, "analyze", downloading, "shots");
  assert.equal(shots(0, 0), undefined);
  assert.equal(shots(20_000, 0.1), undefined, "too soon to say");
  // 0.3 of the bar in a minute: the analysis's 0.9 in three.
  const before = Math.round(shots(60_000, 0.3) ?? assert.fail("no estimate"));
  assert.equal(before, 180_000 + after);
  // Two minutes of download are not the edit's work: the finish moves by as long, and the rate
  // after it is what it was.
  shots(60_000, 0.3, true);
  assert.equal(Math.round(shots(180_000, 0.3, true) ?? 0), before + 120_000);
  assert.equal(Math.round(shots(180_000, 0.3) ?? 0), before + 120_000);
  assert.equal(Math.round(shots(200_000, 0.4) ?? 0), before + 120_000);
});

test("the time left reads more roughly the longer it is", () => {
  assert.equal(formatEstimate(40), "Less than a minute left");
  assert.equal(formatEstimate(4 * 60 + 20), "About 4 min left");
  assert.equal(formatEstimate(23 * 60), "About 25 min left");
  assert.equal(formatEstimate(64 * 60), "About 1 h 5 min left");
  assert.equal(formatEstimate(119 * 60), "About 2 h left");
});
