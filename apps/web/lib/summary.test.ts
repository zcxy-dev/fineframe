import assert from "node:assert/strict";
import { test } from "node:test";
import type { Job } from "./jobs.ts";
import { summaryRows } from "./summary.ts";

const cost = (plan: number, check: number) => ({
  plan: { dollars: plan, requests: 1 },
  check: { dollars: check, requests: 3 },
});

/** An edit at 1 min, 9:16, warm with bold captions, then a re-edit and a re-plan at 30 s, 1:1. */
const job = (current: number): Job => ({
  id: "a",
  created: 0,
  settings: {
    length: 60,
    aspect: "9:16",
    style: "warm",
    names: [],
    asr: "local",
    visuals: "rich",
    captions: "bold",
  } as Job["settings"],
  files: [{ path: "a.mp4", size: 1, use: "video", received: 1 }],
  status: "done",
  stages: {},
  claude: cost(0.19, 0.01),
  result: { message: "Finished", captions: true },
  versions: [
    { n: 1, created: 0, summary: "The edit", video: true },
    { n: 2, created: 1, summary: "Look film", video: true, look: "film", captions: "boxed" },
    {
      n: 3,
      created: 2,
      summary: "Planned again",
      video: true,
      length: 30,
      aspect: "1:1",
      look: "film",
      captions: "boxed",
      claude: cost(0.1, 0.02),
    },
  ],
  current,
});

const row = (rows: [string, string][], name: string) => rows.find(([each]) => each === name)?.[1];

test("the summary is the shown version's: its length, aspect, look, captions and cost", () => {
  const replanned = summaryRows(job(3));
  assert.equal(row(replanned, "Length"), "30 s");
  assert.equal(row(replanned, "Aspect"), "1:1");
  assert.equal(row(replanned, "Style"), "Film");
  assert.equal(row(replanned, "Captions"), "Boxed");
  assert.equal(row(replanned, "Claude, planning"), "$0.10");
  assert.equal(row(replanned, "Claude, checking cuts"), "$0.02");
  // Every version's cost together, labelled as the total.
  assert.equal(row(replanned, "Claude, all versions in total"), "$0.32");

  // A change made without a plan cost nothing.
  const reedited = summaryRows(job(2));
  assert.equal(row(reedited, "Aspect"), "9:16");
  assert.equal(row(reedited, "Style"), "Film");
  assert.equal(row(reedited, "Claude, planning"), undefined);
  assert.equal(row(reedited, "Claude"), "None: changed without a new plan");

  const first = summaryRows(job(1));
  assert.equal(row(first, "Length"), "1 min");
  assert.equal(row(first, "Style"), "Warm");
  assert.equal(row(first, "Captions"), "Bold");
  assert.equal(row(first, "Claude, planning"), "$0.19");

  // An edit never changed has no total, which would only repeat its own cost.
  const single = summaryRows({ ...job(1), versions: undefined, current: undefined });
  assert.equal(row(single, "Claude, all versions in total"), undefined);
});

test("the summary says the edit was planned with instructions, for version 1 only", () => {
  const asked = (current: number) => {
    const each = job(current);
    return { ...each, settings: { ...each.settings, instructions: "Open with the goal" } };
  };
  assert.equal(row(summaryRows(asked(1)), "Planned"), "With instructions");
  assert.equal(row(summaryRows(asked(3)), "Planned"), undefined);
  assert.equal(row(summaryRows(job(1)), "Planned"), undefined);
});
