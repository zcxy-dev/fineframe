import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { test } from "node:test";
import { pickSfx, SFX_KINDS, sfxOf } from "./sfx.ts";

test("every kind has at least two short Ogg files to vary between", async () => {
  for (const kind of SFX_KINDS) {
    const all = sfxOf(kind);
    assert.ok(all.length >= 2, kind);
    for (const sfx of all) {
      assert.equal((await readFile(sfx.path)).subarray(0, 4).toString(), "OggS", sfx.path);
      assert.ok((await stat(sfx.path)).size < 40_000, sfx.path);
    }
  }
});

test("repeated uses of a kind take the next file, round and round", () => {
  const all = sfxOf("click").map((sfx) => sfx.path);
  assert.deepEqual(
    [0, 1, all.length, -1].map((nth) => pickSfx("click", nth).path),
    [all[0], all[1], all[0], all.at(-1)],
  );
});
