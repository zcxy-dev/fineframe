import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { FaceError, fontFile, metrics, readFace } from "./fonts.ts";

test("the pinned caption faces draw Traditional Chinese, rare ideographs and English", async () => {
  for (const weight of [700, 900] as const) {
    const face = await metrics(await fontFile(weight));
    for (const char of "繁體中文字幕，臺灣「𠮷」靐ABCxyz0-9？！") {
      assert.ok(face.advance(char.codePointAt(0) as number), `${weight}: ${char}`);
    }
    assert.equal(face.advance(0x4e00), 1, "an ideograph is an em wide");
    assert.ok((face.advance(0x41) ?? 1) < 1, "Latin is narrower");
    assert.equal(face.advance(0x1f600), undefined, "no emoji, which would draw as a box");
    // libass sizes the face by winAscent + winDescent.
    assert.ok(face.lineHeight > 1 && face.emTop + face.emBottom === 1);
  }
});

test("a face whose glyph widths run past their table is refused, never read past it", async () => {
  const font = Buffer.from(await readFile(await fontFile(700)));
  const tables = new Map<string, number>();
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    tables.set(font.toString("latin1", 12 + 16 * i, 16 + 16 * i), font.readUInt32BE(20 + 16 * i));
  }
  // numberOfHMetrics says more widths than hmtx holds.
  font.writeUInt16BE(0xffff, (tables.get("hhea") as number) + 34);
  assert.throws(() => readFace(font), FaceError);
  assert.throws(() => readFace(font.subarray(0, 200)), FaceError);
});
