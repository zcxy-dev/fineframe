import assert from "node:assert/strict";
import { test } from "node:test";
import type { Job } from "./jobs.ts";
import { analysisSteps } from "./steps.ts";

/** A first edit of a talk with a music track, at the line `progress`. */
const job = (progress: Job["progress"], status: Job["status"] = "running"): Job => ({
  id: "a",
  created: 0,
  settings: { length: 30, aspect: "16:9", correct: false } as Job["settings"],
  files: [
    { path: "talk.mp4", size: 1, use: "video", received: 1 },
    { path: "beat.wav", size: 1, use: "music", received: 1 },
  ],
  status,
  stages: { analyze: { start: 0 } },
  ...(progress ? { progress } : {}),
});

/** Each step's state, in the checklist's order. */
const states = (of: Job) =>
  Object.fromEntries(analysisSteps(of).map(({ step, state }) => [step, state]));

test("the checklist shows getting ready and the music's analysis as they happen", () => {
  // FFmpeg downloading on its first use, before any file is analysed.
  const downloading = job({
    stage: "analyze",
    fraction: 0,
    message: "Downloading FFmpeg, the first time it is used",
  });
  assert.deepEqual(analysisSteps(downloading).slice(0, 3), [
    { step: "ready", state: "active" },
    { step: "music", state: "pending" },
    { step: "probe", state: "pending" },
  ]);

  // The music analysed first, its beat model downloading.
  const music = job({
    stage: "analyze",
    fraction: 0,
    message: "Downloading beat_this final0",
    file: "beat.wav",
    step: "music",
  });
  assert.deepEqual(analysisSteps(music).slice(0, 3), [
    { step: "ready", state: "done" },
    { step: "music", state: "active" },
    { step: "probe", state: "pending" },
  ]);

  // Then the footage's own steps.
  const shots = states(
    job({
      stage: "analyze",
      fraction: 0.05,
      message: "Detecting shots 25%",
      file: "talk.mp4",
      step: "shots",
    }),
  );
  assert.equal(shots.ready, "done");
  assert.equal(shots.music, "done");
  assert.equal(shots.probe, "done");
  assert.equal(shots.shots, "active");

  // Past the analysis, every step is done.
  const planning = states(job({ stage: "plan", fraction: 0.9, message: "Planning" }));
  assert.ok(Object.values(planning).every((state) => state === "done"));
});

test("an edit without music lists no music step, and a failure shows where it stopped", () => {
  // Before the edit's first line, while a link downloads, it is getting ready.
  assert.equal(states(job(undefined)).ready, "active");

  const talk = job({
    stage: "analyze",
    fraction: 0,
    message: "Checking that Claude can plan the edit",
  });
  talk.files = talk.files.filter((file) => file.use !== "music");
  assert.ok(!analysisSteps(talk).some(({ step }) => step === "music"));

  const refused = job(
    { stage: "analyze", fraction: 0, message: "Checking that Claude can plan the edit" },
    "error",
  );
  assert.equal(states(refused).ready, "failed");

  // A file analysed before: getting ready and the music are done, its steps still to come.
  const cached = states(
    job({ stage: "analyze", fraction: 0, message: "Analysed before", file: "beat.wav" }),
  );
  assert.equal(cached.ready, "done");
  assert.equal(cached.music, "done");
  assert.equal(cached.probe, "pending");
});

test("a long step says how far it is", () => {
  const transcribing = analysisSteps(
    job({
      stage: "analyze",
      fraction: 0.4,
      message: "Transcribing 3/12",
      file: "talk.mp4",
      step: "transcribe",
    }),
  );
  assert.deepEqual(
    transcribing.find(({ step }) => step === "transcribe"),
    { step: "transcribe", state: "active", count: "3/12" },
  );
});
