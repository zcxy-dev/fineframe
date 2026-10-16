import assert from "node:assert/strict";
import { test } from "node:test";
import { fontFile, metrics } from "./fonts.ts";

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
