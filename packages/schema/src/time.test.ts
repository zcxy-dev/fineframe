import assert from "node:assert/strict";
import { test } from "node:test";
import {
  frameToTicks,
  secondsToTicks,
  TICKS_PER_SECOND,
  ticksPerFrame,
  ticksToFrame,
  ticksToSeconds,
} from "./time.ts";

const fps30 = { num: 30, den: 1 };

test("seconds and ticks convert both ways", () => {
  assert.equal(TICKS_PER_SECOND, 120_000);
  assert.equal(secondsToTicks(1.5), 180_000);
  assert.equal(ticksToSeconds(180_000), 1.5);
  // 1.234 * 120000 is 148079.99999999997 in floating point.
  assert.equal(secondsToTicks(1.234), 148_080);
});

test("seconds round to the nearest tick, halves away from zero", () => {
  const halfTick = 0.5 / TICKS_PER_SECOND;
  assert.equal(secondsToTicks(halfTick), 1);
  assert.equal(secondsToTicks(-halfTick), -1);
  assert.equal(secondsToTicks(0.4 / TICKS_PER_SECOND), 0);
  assert.ok(Object.is(secondsToTicks(-0.4 / TICKS_PER_SECOND), 0));
});

test("seconds that are not a number, or too large, are refused", () => {
  for (const seconds of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1e12]) {
    assert.throws(() => secondsToTicks(seconds), RangeError);
  }
  assert.throws(() => ticksToSeconds(1.5), RangeError);
});

test("every common frame rate has a whole number of ticks per frame", () => {
  const rates: [number, number, number][] = [
    [24_000, 1_001, 5_005],
    [24, 1, 5_000],
    [25, 1, 4_800],
    [30_000, 1_001, 4_004],
    [30, 1, 4_000],
    [48, 1, 2_500],
    [50, 1, 2_400],
    [60_000, 1_001, 2_002],
    [60, 1, 2_000],
    [120, 1, 1_000],
  ];
  for (const [num, den, ticks] of rates) assert.equal(ticksPerFrame({ num, den }), ticks);
});

test("rates that are invalid or not a whole number of ticks are refused", () => {
  for (const [num, den] of [
    [0, 1],
    [1, 0],
    [7, 3],
    [29.97, 1],
  ] as const) {
    assert.throws(() => ticksPerFrame({ num, den }), RangeError);
  }
});

test("frames start on exact ticks, NTSC rates included", () => {
  assert.equal(frameToTicks(38, fps30), 152_000);
  assert.equal(frameToTicks(30_000, { num: 30_000, den: 1_001 }), 1_001 * TICKS_PER_SECOND);
  assert.throws(() => frameToTicks(1.5, fps30), RangeError);
});

test("a time between frames picks a frame by the rounding asked for", () => {
  const frame5 = 5 * 4_000;
  const cases: [number, number, number, number][] = [
    // ticks, floor, ceil, round
    [frame5, 5, 5, 5],
    [frame5 + 1, 5, 6, 5],
    [frame5 + 1_999, 5, 6, 5],
    [frame5 + 2_000, 5, 6, 6], // a tie goes to the later frame
    [-1, -1, 0, 0],
  ];
  for (const [ticks, floor, ceil, round] of cases) {
    assert.equal(ticksToFrame(ticks, fps30, "floor"), floor);
    assert.equal(ticksToFrame(ticks, fps30, "ceil"), ceil);
    assert.equal(ticksToFrame(ticks, fps30, "round"), round);
  }
  assert.equal(ticksToFrame(secondsToTicks(1.26), fps30, "round"), 38);
});
