import assert from "node:assert/strict";
import { test } from "node:test";
import { fitLength, type Span } from "./fit.ts";

/** Segments of lines with the given lengths in seconds; the edit's length is the sum of the kept
 * lines plus a breath of `join` seconds × breath at each join between segments. */
function edit(lines: number[][], join = 0.4) {
  return (spans: readonly Span[], breath: number) => {
    let seconds = 0;
    let joins = -1;
    for (const [i, span] of spans.entries()) {
      if (!span) continue;
      joins++;
      for (let k = span[0]; k <= span[1]; k++) seconds += (lines[i] as number[])[k] as number;
    }
    return Math.round((seconds + Math.max(0, joins) * join * breath) * 120_000);
  };
}
const T = 120_000;

test("an edit within the tolerance is left as chosen", () => {
  const lines = [[10, 10], [9.6]];
  const fit = fitLength(
    [
      { lines: 2, priority: 1 },
      { lines: 1, priority: 5 },
    ],
    edit(lines),
    30 * T,
    0.05,
  );
  assert.deepEqual(fit.spans, [
    [0, 1],
    [0, 0],
  ]);
  assert.equal(fit.breath, 1);
  assert.equal(fit.passes, 0);
});

test("the highest priority number goes first, the later of equals first", () => {
  const lines = [[10], [10], [10], [10]];
  const fit = fitLength(
    [
      { lines: 1, priority: 1 },
      { lines: 1, priority: 3 },
      { lines: 1, priority: 3 },
      { lines: 1, priority: 2 },
    ],
    edit(lines),
    20 * T,
    0.05,
  );
  assert.deepEqual(fit.spans, [[0, 0], null, null, [0, 0]]);
  // Two segments dropped, and the breath shrunk to bring 20.4 s nearer.
  assert.equal(fit.passes, 3);
});

test("when dropping a segment would undershoot, its first lines stay", () => {
  // 40.8 s; dropping the last segment (priority 4) would leave 20 s. Its first two lines give
  // 27.4 s, which the longest breath brings to 27.64 s.
  const lines = [
    [10, 10],
    [4, 3, 7, 6],
  ];
  const fit = fitLength(
    [
      { lines: 2, priority: 1 },
      { lines: 4, priority: 4 },
    ],
    edit(lines),
    28 * T,
    0.05,
  );
  assert.deepEqual(fit.spans, [
    [0, 1],
    [0, 1],
  ]);
  assert.equal(fit.breath, 1.6);
  assert.equal(fit.length, 27.64 * T);
});

test("the breath at joins makes up what whole lines cannot", () => {
  // Five 6 s segments and four joins: 31.6 s, and nothing to drop that lands in 30 s ± 1 %.
  const lines = [[6], [6], [6], [6], [6]];
  const fit = fitLength(
    lines.map(() => ({ lines: 1, priority: 1 })),
    edit(lines),
    31 * T,
    0.01,
  );
  assert.ok(fit.breath < 1);
  assert.ok(Math.abs(fit.length - 31 * T) <= 0.31 * T);
  assert.equal(fit.passes, 1);
});

test("an edit too short to reach the target is returned short; the caller decides", () => {
  const fit = fitLength([{ lines: 1, priority: 1 }], edit([[10]]), 60 * T, 0.05);
  assert.equal(fit.length, 10 * T);
  assert.deepEqual(fit.spans, [[0, 0]]);
});

test("an edit within the tolerance still moves to the line choice nearest the target", () => {
  // 31.2 s is +4 % of 30 s; ending the nice-to-have on its first line lands on 30 s exactly.
  const lines = [
    [10, 10],
    [9.6, 1.2],
  ];
  const fit = fitLength(
    [
      { lines: 2, priority: 1 },
      { lines: 2, priority: 5 },
    ],
    edit(lines),
    30 * T,
    0.05,
  );
  assert.deepEqual(fit.spans, [
    [0, 1],
    [0, 0],
  ]);
  assert.equal(fit.length, 30 * T);
  assert.equal(fit.breath, 1);
  assert.equal(fit.passes, 1);
});

test("the breath moves an edit within the tolerance nearer the target", () => {
  // 30.8 s with one join; the shortest breath gives 30.64 s, and no line can go.
  const lines = [[10, 10], [10.4]];
  const fit = fitLength(
    [
      { lines: 2, priority: 1 },
      { lines: 1, priority: 1 },
    ],
    edit(lines),
    30 * T,
    0.05,
  );
  assert.equal(fit.breath, 0.6);
  assert.equal(fit.length, 30.64 * T);
});

test("a nearer length never trims a segment while a less important one plays whole", () => {
  // 31.6 s, 31.44 s at the shortest breath; trimming the important segment's last line would
  // land nearer, but the nice-to-have would then play whole.
  const lines = [[10, 1.2], [20]];
  const fit = fitLength(
    [
      { lines: 2, priority: 1 },
      { lines: 1, priority: 5 },
    ],
    edit(lines),
    30 * T,
    0.05,
  );
  assert.deepEqual(fit.spans, [
    [0, 1],
    [0, 0],
  ]);
  assert.equal(fit.breath, 0.6);
});

test("segments of equal priority may each be trimmed while the other plays whole", () => {
  // 32.3 s. Ending the later segment on its first line gives 28.64 s at the longest breath;
  // ending the earlier one on its second gives 30.54 s at the shortest, which is nearer.
  const lines = [
    [10, 10, 1.6],
    [6.4, 3.9],
  ];
  const fit = fitLength(
    [
      { lines: 3, priority: 2 },
      { lines: 2, priority: 2 },
    ],
    edit(lines),
    30 * T,
    0.05,
  );
  assert.deepEqual(fit.spans, [
    [0, 1],
    [0, 1],
  ]);
  assert.equal(fit.length, 30.54 * T);
});

test("when no single change lands within the tolerance, two may, losing the fewest important lines", () => {
  // The lines and priorities of a 30 s plan of the synthetic talk-a1 (#84), whose joins add
  // little: 42.08 s whole. Dropping by priority leaves 32.66 s, then 27.36 s, and trimming any one
  // segment of the 32.66 s lands at 28.12 s at most. Dropping the priority-3 segment and the
  // priority-2 one's last line, with the priority-4 one whole, gives 31.38 s at the shortest
  // breath and keeps every priority-1 line.
  const lines = [[3.56, 5.2, 5.04], [5.24], [3.4, 4.72], [5.2], [4.36, 4.4]];
  const priorities = [1, 1, 2, 3, 4];
  const fit = fitLength(
    lines.map((l, i) => ({ lines: l.length, priority: priorities[i] as number })),
    edit(lines, 0.1),
    30 * T,
    0.05,
  );
  assert.deepEqual(fit.spans, [[0, 2], [0, 0], [0, 0], null, [0, 1]]);
  assert.equal(fit.breath, 0.6);
  assert.equal(fit.length, 31.38 * T);
});

test("when no changes together land within the tolerance either, the nearest choice is returned", () => {
  // 10 s lines with no breath: 16 s ± 5 % lies between 10 and 20 s.
  const lines = [[10], [10], [10]];
  const fit = fitLength(
    lines.map(() => ({ lines: 1, priority: 3 })),
    edit(lines, 0),
    16 * T,
    0.05,
  );
  assert.equal(fit.length, 20 * T);
});
