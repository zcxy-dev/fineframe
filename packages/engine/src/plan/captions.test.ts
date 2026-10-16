import assert from "node:assert/strict";
import { test } from "node:test";
import type { Word } from "@video-editor/schema";
import { captionLines, outputWords, subtitled } from "./captions.ts";
import type { PlaceSource } from "./place.ts";

const T = 120_000;
const words: Word[] = [
  { text: "我", start: 1.0, end: 1.2 },
  { text: "用", start: 1.2, end: 1.4 },
  { text: "嗯，", start: 1.6, end: 1.8 },
  { text: "Claude", start: 2.0, end: 2.4 },
  { text: "剪。", start: 2.4, end: 2.6 },
  { text: "Hello", start: 3.0, end: 3.3 },
  { text: "world.", start: 3.3, end: 3.6 },
];
const sources = new Map<string, PlaceSource>([
  ["a", { id: "a", words, duration: 10, frameTicks: null }],
]);

test("kept words move onto the output timeline through the cuts", () => {
  // The filler (word 2) is cut out: 0.4 s of source between the clips.
  const clips = [
    { source: "a", in: 0.9 * T, out: 1.5 * T, first: 0, last: 1 },
    { source: "a", in: 1.9 * T, out: 3.7 * T, first: 3, last: 6 },
  ];
  const timed = outputWords(clips, sources);
  assert.deepEqual(
    timed.map((w) => [w.text, w.start / T, w.end / T]),
    [
      ["我", 0.1, 0.3],
      ["用", 0.3, 0.5],
      ["Claude", 0.7, 1.1],
      ["剪。", 1.1, 1.3],
      ["Hello", 1.7, 2],
      ["world.", 2, 2.3],
    ],
  );
  const lines = captionLines(timed, () => 1);
  assert.deepEqual(
    lines.map((line) => [line.text, line.language, line.start / T, line.end / T]),
    [
      ["我用 Claude 剪", "zh-TW", 0.1, 1.3],
      ["Hello world.", "en", 1.7, 2.3],
    ],
  );
  assert.deepEqual(
    lines[0]?.words?.map((w) => w.language ?? null),
    [null, null, "en", null],
  );
});

test("a caption line never runs across a jump to other material", () => {
  const clips = [
    { source: "a", in: 2.9 * T, out: 3.7 * T, first: 5, last: 6 },
    { source: "a", in: 0.9 * T, out: 1.5 * T, first: 0, last: 1 },
  ];
  const lines = captionLines(outputWords(clips, sources), () => 1);
  assert.deepEqual(
    lines.map((line) => line.text),
    ["Hello world.", "我用"],
  );
});

test("Chinese lines drop commas and full stops as Taiwanese subtitles do", () => {
  assert.deepEqual(subtitled(["大", "家", "好，", "我", "用", "AI", "剪", "片。"]), {
    text: "大家好\u3000我用 AI 剪片",
    words: ["大", "家", "好", "我", "用", "AI", "剪", "片"],
  });
  // Questions, exclamations and quotes stay; a number or an abbreviation keeps its full stop.
  assert.equal(subtitled(["真", "的", "嗎？", "「", "好」", "！"]).text, "真的嗎？「好」！");
  assert.equal(subtitled(["U.S.", "成", "長", "3.5", "倍。"]).text, "U.S.成長 3.5 倍");
  // A word that was only a comma leaves a pause and nothing to light.
  assert.deepEqual(subtitled(["好", "，", "走"]), { text: "好\u3000走", words: ["好", "", "走"] });
  // A comma the transcript put in front of the next word is the same pause.
  assert.deepEqual(subtitled(["這", "種", "，AI", "已"]), {
    text: "這種\u3000AI 已",
    words: ["這", "種", "AI", "已"],
  });
});

test("a caption line keeps only the words that have something to show", () => {
  const timed = [
    { source: "a", index: 0, text: "好", start: 0, end: T / 5 },
    { source: "a", index: 1, text: "，", start: T / 5, end: T / 5 + 1 },
    { source: "a", index: 2, text: "走。", start: T / 2, end: T },
  ];
  const [line] = captionLines(timed, () => 1);
  assert.equal(line?.text, "好\u3000走");
  assert.deepEqual(
    line?.words?.map((word) => [word.text, word.start]),
    [
      ["好", 0],
      ["走", T / 2],
    ],
  );
});

test("punctuation left on its own after a sentence makes no caption line", () => {
  const timed = [
    { source: "a", index: 0, text: "真的嗎？", start: 0, end: T / 2 },
    { source: "a", index: 1, text: "。", start: T / 2, end: T / 2 + 1 },
    { source: "a", index: 2, text: "好", start: T, end: 1.2 * T },
  ];
  assert.deepEqual(
    captionLines(timed, () => 1).map((line) => line.text),
    ["真的嗎？", "好"],
  );
});
