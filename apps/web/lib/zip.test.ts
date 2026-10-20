import assert from "node:assert/strict";
import { test } from "node:test";
import { fileTitle } from "./paths.ts";
import { ArchiveTooLarge, fitsZip, zipStream } from "./zip.ts";

test("a title becomes a file name every system keeps", () => {
  assert.equal(fileTitle('a/b\\c:d*e?f"g<h>i|j'), "a b c d e f g h i j");
  assert.equal(fileTitle("剪輯：一天…  "), "剪輯：一天…");
  assert.equal(fileTitle("Ends with dots..."), "Ends with dots");
  assert.equal(fileTitle("tab\there\nnewline"), "tab here newline");
  assert.equal(fileTitle("???"), "short");
  // At most 60 characters, counted as people read them, not as UTF-16 halves.
  assert.equal([...fileTitle("影".repeat(80))].length, 60);
  assert.equal([...fileTitle("😀".repeat(80))].length, 60);
});

test("more files than a zip without its 64-bit extension holds are refused before any byte", async () => {
  const entries = Array.from({ length: 65_536 }, (_, i) => ({ name: `${i}.txt`, text: "" }));
  await assert.rejects(zipStream(entries), ArchiveTooLarge);
});

test("a size ZIP64 marks, or an entry count it marks, is refused, not written", async () => {
  assert.equal(fitsZip(0xffff_fffe), true);
  assert.equal(fitsZip(0xffff_ffff), false);
  const entries = Array.from({ length: 0xffff }, (_, i) => ({ name: `${i}.txt`, text: "" }));
  await assert.rejects(zipStream(entries), ArchiveTooLarge);
});
