import assert from "node:assert/strict";
import { test } from "node:test";
import { timecodeTicks } from "./media.ts";

test("a start timecode is the time its frame count stands for, drop-frame included", () => {
  // An hour of frames at each rate, its last frame 1/30 s or 1001/30000 s long.
  assert.equal(timecodeTicks("01:00:00:00", { num: 25, den: 1 }), 3600 * 120_000);
  assert.equal(timecodeTicks("01:00:00:00", { num: 30000, den: 1001 }), 108_000 * 4004);
  // Drop-frame skips 2 frame numbers a minute but every tenth, 4 at 59.94: 107 892 frames in
  // the hour, and 00:01:00;04 the first frame of minute 1.
  assert.equal(timecodeTicks("01:00:00;00", { num: 30000, den: 1001 }), 107_892 * 4004);
  assert.equal(timecodeTicks("00:01:00;04", { num: 60000, den: 1001 }), 3600 * 2002);
  assert.equal(timecodeTicks("10:00:00:12", { num: 24000, den: 1001 }), (864_000 + 12) * 5005);
  assert.equal(timecodeTicks("", { num: 30, den: 1 }), 0);
});
