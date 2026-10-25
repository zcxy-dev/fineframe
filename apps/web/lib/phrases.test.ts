import assert from "node:assert/strict";
import { test } from "node:test";
import { phrased } from "./phrases.ts";

const BREAK = "​";

test("Chinese gets a break between its words and nowhere inside one", () => {
  const text = "素材留在執行此頁面的伺服器上";
  const out = phrased(text);
  assert.equal(out.replaceAll(BREAK, ""), text);
  assert.ok(out.includes(BREAK));
  for (const word of ["素材", "伺服器"]) assert.ok(out.includes(word), word);
});

test("no break comes before punctuation, which may not start a line", () => {
  const out = phrased("剪輯完成，影片可以下載了。");
  assert.doesNotMatch(out, new RegExp(`${BREAK}[，。、；：）」』]`));
});

test("Latin text and the spaces beside it are left as they are", () => {
  assert.equal(phrased("API key saved · Replace"), "API key saved · Replace");
  assert.equal(phrased("由 Claude 規劃"), "由 Claude 規劃");
});

test("text already broken into words comes out the same", () => {
  const once = phrased("每個剪接點都會檢查");
  assert.equal(phrased(once), once);
});
