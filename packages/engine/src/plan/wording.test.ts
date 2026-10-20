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

test("a unit after a said number counts as said, and a number as the speaker says it", () => {
  const age = "我放所有心思在解決我二十七歲的問題";
  const height = "他比我高十公分";
  // The number and its unit set apart, as a graphic draws a big number and a small unit.
  assert.deepEqual(unsaid("27 歲", age), []);
  assert.deepEqual(unsaid("27歲", age), []);
  // 十 alone is a number when the speaker says it before a unit.
  assert.deepEqual(unsaid("10 公分", height), []);
  // Neither lets through what was not said: another number, or a unit not said after one.
  assert.deepEqual(unsaid("30 歲", age), ["30"]);
  assert.deepEqual(unsaid("歲", "我不知道幾歲"), ["歲"]);
  assert.deepEqual(unsaid("10 倍", height), ["倍"]);
});

test("numbers and Latin words match whole, not inside a longer one", () => {
  assert.deepEqual(unsaid("20", "我在 2024 年開始"), ["20"]);
  assert.deepEqual(unsaid("4%", "成長了 40%"), ["4%"]);
  assert.deepEqual(unsaid("art", "let's start"), ["art"]);
  // Still found when said whole, in either script, and in parts.
  assert.deepEqual(unsaid("2024", "我在 2024 年開始"), []);
  assert.deepEqual(unsaid("40%", "成長了百分之四十"), []);
  assert.deepEqual(unsaid("Start", "let's start"), []);
  assert.deepEqual(unsaid("Pocket 4P", "Pocket 四 P 終於來了"), []);
  assert.deepEqual(unsaid("1,000", "賣了一千台"), []);
});

test("a brand is named only by its whole name", () => {
  const logo = (name: string) => `<img src="logos/${name}.svg">`;
  assert.deepEqual(unnamed(logo("x"), "the next step"), ["X"]);
  assert.deepEqual(unnamed(logo("meta"), "read the metadata"), ["Meta"]);
  assert.deepEqual(unnamed(logo("react"), "what a reaction"), ["React"]);
  assert.deepEqual(unnamed(logo("linux"), "Linux 上也能跑"), []);
  assert.deepEqual(unnamed(logo("googledrive"), "存到 Google Drive"), []);
  assert.deepEqual(unnamed(logo("nodedotjs"), "用 Node.js 寫"), []);
});
