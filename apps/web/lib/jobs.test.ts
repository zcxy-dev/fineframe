import assert from "node:assert/strict";
import { test } from "node:test";
import { footageToPrune, secondsLeft } from "./jobs.ts";

test("a download's time left is its bytes left at the rate since it started", () => {
  const start = { at: 0, bytes: 1000 };
  assert.equal(secondsLeft(start, { at: 10_000, bytes: 11_000 }, 21_000), 10);
  // Too soon, or nothing arrived yet, to say.
  assert.equal(secondsLeft(start, { at: 1000, bytes: 2000 }, 21_000), undefined);
  assert.equal(secondsLeft(start, { at: 10_000, bytes: 1000 }, 21_000), undefined);
});

test("only the newest projects keep their footage, and a running edit keeps its own", () => {
  const job = (
    id: string,
    created: number,
    status: "done" | "error" | "running" | "cancelled",
  ) => ({
    id,
    created,
    status,
  });
  const jobs = [
    job("a", 1, "done"),
    job("b", 2, "error"),
    job("c", 3, "cancelled"),
    job("d", 4, "done"),
    job("e", 5, "done"),
  ];
  // A failed or cancelled edit cannot be edited again, so it takes no place among the newest.
  assert.deepEqual(footageToPrune(jobs, 2), ["a", "b", "c"]);
  assert.deepEqual(footageToPrune(jobs, 4), ["b", "c"]);
  assert.deepEqual(footageToPrune([job("r", 1, "running"), job("n", 2, "done")], 1), []);
  assert.deepEqual(footageToPrune(jobs, 0), ["a", "b", "c", "d", "e"]);
});
