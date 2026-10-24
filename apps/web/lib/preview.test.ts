import assert from "node:assert/strict";
import { test } from "node:test";
import { previewAfter } from "./preview.ts";

test("a preview loads until its sound plays, and a second click stops it", () => {
  const loading = previewAfter(null, { type: "click", track: "a" });
  assert.deepEqual(loading, { track: "a", state: "loading" });
  const playing = previewAfter(loading, { type: "playing" });
  assert.deepEqual(playing, { track: "a", state: "playing" });
  assert.equal(previewAfter(playing, { type: "click", track: "a" }), null);
  assert.equal(previewAfter(loading, { type: "click", track: "a" }), null);
});

test("only a preview that plays stops when the sound pauses or ends", () => {
  // Loading the next track pauses the one playing.
  const next = previewAfter({ track: "a", state: "playing" }, { type: "click", track: "b" });
  assert.deepEqual(previewAfter(next, { type: "stopped" }), { track: "b", state: "loading" });
  assert.equal(previewAfter({ track: "b", state: "playing" }, { type: "stopped" }), null);
});

test("a preview that fails says so on its track until it is tried again", () => {
  const failed = previewAfter({ track: "a", state: "loading" }, { type: "failed" });
  assert.deepEqual(failed, { track: "a", state: "failed" });
  assert.deepEqual(previewAfter(failed, { type: "stopped" }), failed);
  assert.deepEqual(previewAfter(failed, { type: "click", track: "a" }), {
    track: "a",
    state: "loading",
  });
  // The play of a track left behind fails late; the one asked for since is still loading.
  const loading = { track: "b", state: "loading" } as const;
  assert.deepEqual(previewAfter(loading, { type: "failed", track: "a" }), loading);
});
