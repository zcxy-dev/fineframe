import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateCost } from "./estimate.ts";

test("the estimate's range holds what whole edits cost in the measured runs", () => {
  // packages/engine/README.md's edit measurements: footage, length, what Claude cost.
  const runs: [number, number, number][] = [
    [6.7 * 60, 60, 0.1],
    [11.9 * 60, 60, 0.1],
    [8.8 * 60, 300, 0.13],
  ];
  for (const [footage, length, dollars] of runs) {
    const { low, high } = estimateCost(footage, length);
    assert.ok(low <= dollars && dollars <= high, `${footage} s to ${length} s: ${low}–${high}`);
  }
});

test("a longer edit from more footage costs more", () => {
  const short = estimateCost(120, 30);
  const long = estimateCost(3 * 3600, 3600);
  assert.ok(long.low > short.high);
  assert.ok(estimateCost(600, 60).high < estimateCost(600, 600).high);
  assert.ok(estimateCost(600, 60).high < estimateCost(3600, 60).high);
});
