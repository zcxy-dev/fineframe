import assert from "node:assert/strict";
import { test } from "node:test";
import { secondsLeft } from "./jobs.ts";

test("a download's time left is its bytes left at the rate since it started", () => {
  const start = { at: 0, bytes: 1000 };
  assert.equal(secondsLeft(start, { at: 10_000, bytes: 11_000 }, 21_000), 10);
  // Too soon, or nothing arrived yet, to say.
  assert.equal(secondsLeft(start, { at: 1000, bytes: 2000 }, 21_000), undefined);
  assert.equal(secondsLeft(start, { at: 10_000, bytes: 1000 }, 21_000), undefined);
});
