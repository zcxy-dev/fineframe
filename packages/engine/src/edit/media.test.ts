import assert from "node:assert/strict";
import { test } from "node:test";
import { kindOf } from "./media.ts";

test("a file's kind is read from its extension in any case", () => {
  assert.equal(kindOf("talk.MP4"), "video");
  assert.equal(kindOf("footage/訪談.mov"), "video");
  assert.equal(kindOf("song.m4a"), "audio");
  assert.equal(kindOf("photo.JPEG"), "image");
  assert.equal(kindOf("notes.txt"), null);
  assert.equal(kindOf(".mp4"), null);
  assert.equal(kindOf("v1.0/README"), null);
});
