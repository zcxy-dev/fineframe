import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLength, parseSpan } from "./length.ts";

test("lengths are read as people write them", () => {
  const cases: [string, number][] = [
    ["15s", 15],
    ["90", 90],
    ["90s", 90],
    ["1.5m", 90],
    ["3m", 180],
    ["1m30s", 90],
    ["1m30", 90],
    ["1h", 3600],
    ["1h5m", 3900],
    ["0.5h", 1800],
    ["1:30", 90],
    ["0:15", 15],
    ["59:59", 3599],
    ["1:00:00", 3600],
    ["1:02:03", 3723],
    // A bare number after a unit counts in the next unit down, as people say "1h30" or "2m15".
    ["1h30", 5400],
    ["0h45", 2700],
    ["2m15", 135],
  ];
  for (const [text, seconds] of cases) assert.equal(parseLength(text), seconds, text);
});

test("anything else is not a length", () => {
  for (const text of [
    "",
    "s",
    "m",
    "abc",
    "1:3",
    "1:60",
    "1:60:00",
    "-5s",
    "5 s",
    "1h30x",
    "1::30",
  ]) {
    assert.equal(parseLength(text), null, text);
  }
});

test("a span is two lengths joined by a dash, the first under the second", () => {
  assert.deepEqual(parseSpan("30-60s"), [30, 60]);
  assert.deepEqual(parseSpan("90s-3m"), [90, 180]);
  assert.deepEqual(parseSpan("10:12-11:30"), [612, 690]);
  assert.deepEqual(parseSpan("612.4-671"), [612.4, 671]);
  for (const text of ["60-30s", "30", "30-60-90", "-60", "30-", "a-b", "30-30"]) {
    assert.equal(parseSpan(text), null, text);
  }
});
