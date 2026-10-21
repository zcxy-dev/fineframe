import assert from "node:assert/strict";
import { test } from "node:test";
import { fileUrl, frames, rational, relativeUrl, xmlText } from "./xml.ts";

test("file URLs encode spaces, Chinese and reserved characters on every system", () => {
  assert.equal(
    fileUrl("/Users/me/影片 素材/a#1.mp4"),
    "file:///Users/me/%E5%BD%B1%E7%89%87%20%E7%B4%A0%E6%9D%90/a%231.mp4",
  );
  assert.equal(
    fileUrl("C:\\Users\\me\\影片\\it's.mp4"),
    "file:///C:/Users/me/%E5%BD%B1%E7%89%87/it%27s.mp4",
  );
  assert.equal(fileUrl("\\\\nas\\share\\a b.mov"), "file://nas/share/a%20b.mov");
  assert.equal(fileUrl("/home/me/a.mp4", "localhost"), "file://localhost/home/me/a.mp4");
  assert.equal(relativeUrl("media/配樂 1.wav"), "media/%E9%85%8D%E6%A8%82%201.wav");
});

test("XML text escapes its five characters", () => {
  assert.equal(xmlText(`a<b>&"c'`), "a&lt;b&gt;&amp;&quot;c&apos;");
});

test("times are reduced rational seconds", () => {
  assert.equal(rational(0), "0s");
  assert.equal(rational(240_000), "2s");
  assert.equal(rational(4004), "1001/30000s");
  assert.equal(frames(1, { num: 30000, den: 1001 }), "1001/30000s");
  assert.equal(frames(30, { num: 30, den: 1 }), "30/30s");
  assert.equal(frames(3, { num: 24000, den: 1001 }), "3003/24000s");
});
