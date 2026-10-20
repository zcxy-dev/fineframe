import assert from "node:assert/strict";
import { test } from "node:test";
import { normalized, repeated, unnamed, unsaid } from "./wording.ts";

test("numbers read the same in Chinese numerals and digits", () => {
  assert.equal(normalized("二十七歲"), "27歲");
  assert.equal(normalized("三百"), "300");
  assert.equal(normalized("一萬五千"), "15000");
  assert.equal(normalized("1,000 人"), "1000人");
  // A lone 一 or 十 is as often a word as a number.
  assert.equal(normalized("一個"), "一個");
  assert.equal(normalized("Focus!"), "focus");
});

test("a graphic says only what the speaker says near it", () => {
  const speech = "我現在二十七歲，放所有心思在解決我的問題；我會更想要 focus 在現在，用中焦鏡頭";
  assert.deepEqual(unsaid("27歲", speech), []);
  assert.deepEqual(unsaid("解決 問題", speech), []);
  // A small word may join the speaker's words.
  assert.deepEqual(unsaid("不解決的問題", speech), []);
  assert.deepEqual(unsaid("Focus", speech), []);
  // Another word for what they said, a word they never said, a number they never gave.
  assert.deepEqual(unsaid("長焦", speech), ["長焦"]);
  assert.deepEqual(unsaid("tackle", speech), ["tackle"]);
  assert.deepEqual(unsaid("30歲", speech), ["30歲"]);
});

test("a graphic that spells out the sentence being said repeats the captions", () => {
  const speech = "現在這個階段要面對的難題就夠了";
  assert.equal(repeated(["現在這個階段", "要面對的難題"], speech), "現在這個階段要面對的難題");
  // A keyword or two is what a graphic is for.
  assert.equal(repeated(["難題"], speech), null);
  assert.equal(repeated(["每一個階段", "不同的難關"], "每一個階段你都有不同的難關"), null);
  // In English a word counts, not its letters.
  const english = "they poured concrete over the outdoor patio of the restaurant";
  assert.equal(repeated(["concrete"], english), null);
  assert.equal(repeated(["outdoor patio"], english), null);
  assert.equal(repeated(["the outdoor patio of"], english), "the outdoor patio of");
});

test("a logo shows only a brand the speaker names", () => {
  const html =
    '<img src="logos/github.svg"><img src="logos/notion.svg"><img src="icons/rocket.svg">';
  assert.deepEqual(unnamed(html, "我把程式碼放在 GitHub 上"), ["Notion"]);
  assert.deepEqual(unnamed(html, "github 跟 Notion 都用"), []);
});
