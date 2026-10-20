import assert from "node:assert/strict";
import { test } from "node:test";
import { estimateCost } from "./estimate.ts";

test("the estimate's range holds what whole edits cost in the measured runs", () => {
  // packages/engine/MEASUREMENTS.md's edit measurements: footage, length, what Claude cost.
  const minimal: [number, number, number][] = [
    [11.9 * 60, 60, 0.1],
    [8.8 * 60, 300, 0.13],
  ];
  for (const [footage, length, dollars] of minimal) {
    const { low, high } = estimateCost(footage, length, "minimal");
    assert.ok(low <= dollars && dollars <= high, `${footage} s to ${length} s: ${low}–${high}`);
  }
  // With rich visuals: the planner's synthetic edits, the synthetic edit and the real-footage edits.
  const rich: [number, number, number][] = [
    [420, 30, 0.34], [420, 60, 0.25], [420, 300, 0.98], [402, 30, 0.25], [402, 60, 0.41],
    [402, 300, 1.19], [144, 30, 0.32], [144, 60, 0.59], [126, 30, 0.37], [126, 60, 0.57],
    [77, 30, 0.32], [77, 60, 0.51], [75, 30, 0.22], [75, 60, 0.3], [402, 60, 0.57],
    [831, 60, 0.51], [412, 60, 0.48], [700, 60, 0.45], [870, 60, 0.41], [831, 180, 0.76],
    [1257, 180, 0.93],
  ]; // biome-ignore format: one row per edit
  for (const [footage, length, dollars] of rich) {
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
