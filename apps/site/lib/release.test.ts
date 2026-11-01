import assert from "node:assert/strict";
import { test } from "node:test";
import { parseFeed } from "./release.ts";

test("reads the version and the date from an update feed", () => {
  const feed = `version: 0.7.0
files:
  - url: Fineframe-0.7.0-mac-arm64.dmg
    size: 377769382
path: Fineframe-0.7.0-mac-arm64.dmg
releaseDate: '2026-10-28T23:40:10.686Z'
`;
  assert.deepEqual(parseFeed(feed), {
    version: "0.7.0",
    date: new Date("2026-10-28T23:40:10.686Z"),
  });
});

test("names nothing when the feed lacks the version or the date", () => {
  assert.equal(parseFeed("releaseDate: '2026-10-28T23:40:10.686Z'\n"), undefined);
  assert.equal(parseFeed("version: 0.7.0\n"), undefined);
  assert.equal(parseFeed("version: 0.7.0\nreleaseDate: 'soon'\n"), undefined);
});
