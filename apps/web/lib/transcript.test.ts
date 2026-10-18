import assert from "node:assert/strict";
import { test } from "node:test";
import { spacedWords } from "./transcript.ts";

const line = (text: string, words: string[]) => ({
  text,
  words: words.map((word) => ({ text: word })),
});

test("English words keep the spaces between them", () => {
  assert.deepEqual(
    spacedWords(
      line("It cuts the pauses for you.", ["It", "cuts", "the", "pauses", "for", "you."]),
    ),
    [false, true, true, true, true, true],
  );
});

test("Chinese runs together, and a space sets off English beside it, as the captions write it", () => {
  assert.deepEqual(
    spacedWords(
      line("我們今天用 Claude 剪片", ["我", "們", "今", "天", "用", "Claude", "剪", "片"]),
    ),
    [false, false, false, false, false, true, true, false],
  );
});

test("words the line's text does not hold still space English from English", () => {
  // A subtitle may set punctuation as a space; the words keep it.
  assert.deepEqual(spacedWords(line("好 we did it", ["好，", "we", "did", "it"])), [
    false,
    true,
    true,
    true,
  ]);
  assert.deepEqual(spacedWords(line("", ["We", "did", "我"])), [false, true, true]);
});
