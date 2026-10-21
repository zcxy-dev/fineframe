import assert from "node:assert/strict";
import { test } from "node:test";
import { checkRevision, type Version, versionFiles, videosToPrune } from "./versions.ts";

const version = (n: number, video = true): Version => ({ n, created: n, summary: "", video });

test("only the newest three versions and the one shown keep their videos", () => {
  const versions = [1, 2, 3, 4, 5].map((n) => version(n));
  assert.deepEqual(videosToPrune(versions, 5), [1, 2]);
  // An older version shown again keeps its video beside the newest three.
  assert.deepEqual(videosToPrune(versions, 1), [2]);
  // One whose video already went is not deleted twice.
  assert.deepEqual(videosToPrune([version(1, false), ...versions.slice(1)], 5), [2]);
  assert.deepEqual(videosToPrune(versions.slice(0, 3), 3), []);
});

test("versions are named as the skill names them", () => {
  assert.match(versionFiles(1).video, /out[\\/]edit\.mp4$/);
  assert.match(versionFiles(2).project, /out[\\/]edit-v2\.project\.json$/);
});

test("a revision's shape is checked, and only the changes it knows are kept", () => {
  assert.deepEqual(checkRevision({ cuts: [[0, 10]], look: "warm", other: 1 }), {
    cuts: [[0, 10]],
    look: "warm",
  });
  assert.equal(typeof checkRevision({ cuts: [[0]] }), "string");
  assert.equal(typeof checkRevision({ words: [{ line: 0, word: -1, text: "x" }] }), "string");
  assert.equal(typeof checkRevision({ remove: [{ kind: "main", index: 0 }] }), "string");
  assert.equal(typeof checkRevision({ music: { gainDb: "loud" } }), "string");
  assert.deepEqual(checkRevision({ music: "remove" }), { music: "remove" });
  // A brand kit is named by its id, or null for none; the server copies the kit in.
  assert.deepEqual(checkRevision({ kit: null, captions: "pop" }), { captions: "pop", kit: null });
  assert.equal(typeof checkRevision({ kit: 5 }), "string");
  assert.equal("brand" in (checkRevision({ brand: { name: "x" } }) as object), false);
});
