import assert from "node:assert/strict";
import { test } from "node:test";
import type { FramedShot, MediaIndex, Word } from "@video-editor/schema";
import { fillerCandidates, findWords } from "./fillers.ts";
import { formatTime, packSource, splitLines } from "./pack.ts";
import type { PlaceSource } from "./place.ts";
import { joinWords, wordLanguage } from "./text.ts";

/** Words from [text, start, end] triples. */
const words = (...list: [string, number, number][]): Word[] =>
  list.map(([text, start, end]) => ({ text, start, end }));

/** A source of `words` with no frame grid, whose cuts need CUT_GAP. */
const placed = (id: string, list: Word[], unheard: [number, number][] = []): PlaceSource => ({
  id,
  words: list,
  duration: 0,
  frameTicks: null,
  unheard,
});

const index = (transcript: Word[]): MediaIndex => ({
  version: 1,
  source: {
    name: "talk.mp4",
    duration: 30,
    video: { width: 1920, height: 1080, fps: 25, rotation: 0, codec: "h264" },
    audio: [{ index: 0, channels: 2, sample_rate: 48000, language: null }],
  },
  transitions: [{ start: 12.4, end: 12.4 }],
  speech: [{ start: 1, end: 9 }],
  transcript: { language: "zh", text: "", words: transcript },
  loudness: { momentary: [-30, -20, -12, -21], short_term: [-22, -21, -20, -21] },
  audio_events: [{ kind: "laughter", start: 2.5, end: 4.5, confidence: 0.81 }],
});

test("lines break on a half-second silence, and at a sentence end with room to cut", () => {
  const list = words(
    ["大", 1.0, 1.2],
    ["家", 1.2, 1.4],
    ["好。", 1.4, 1.6],
    // 0.2 s after a sentence end: room to cut, so a new line.
    ["今", 1.8, 2.0],
    ["天。", 2.0, 2.2],
    // 0.05 s after a sentence end: no room, the line goes on.
    ["我", 2.25, 2.4],
    ["們", 2.4, 2.6],
    // 0.6 s of silence ends a line, punctuation or not.
    ["開", 3.2, 3.4],
  );
  const lines = splitLines(placed("a", list));
  assert.deepEqual(
    lines.map((line) => [line.n, line.first, line.last]),
    [
      [1, 0, 2],
      [2, 3, 6],
      [3, 7, 7],
    ],
  );
});

test("speech the transcript missed is no silence to end a line in", () => {
  const list = words(["好。", 1.0, 1.2], ["今", 2.0, 2.2], ["天。", 2.2, 2.4], ["我", 2.6, 2.8]);
  // Speech from 1.3 to 1.9 s that no word covers leaves 0.1 s of silence on either side, and
  // speech from 2.45 to 2.55 s none a cut fits in.
  const lines = splitLines(
    placed("a", list, [
      [1.3, 1.9],
      [2.45, 2.55],
    ]),
  );
  assert.deepEqual(
    lines.map((line) => [line.first, line.last]),
    [[0, 3]],
  );
});

test("a packed file lists its facts, then numbered lines with fillers marked", () => {
  const list = words(
    ["嗯，", 1.0, 1.2],
    ["我", 1.4, 1.6],
    ["用", 1.6, 1.8],
    ["Claude", 1.8, 2.2],
    ["剪", 2.2, 2.4],
    ["片。", 2.4, 2.6],
    ["那", 3.3, 3.5],
    ["個", 3.5, 3.7],
    ["好。", 3.7, 3.9],
  );
  const lines = splitLines(placed("talk", list));
  const packed = packSource("talk", index(list), lines, fillerCandidates("talk", list));
  assert.equal(
    packed,
    [
      "## talk (30.0 s)",
      "Picture: 1920x1080, 25 fps; shot changes at 12.4 s",
      "Speech: 7 % of the file; pauses of 2 s or more at 9.0-30.0 s",
      "Loudness: median -21 LUFS short-term; peaks at 2 s (-12)",
      "Audio events: laughter 2.5-4.5 s (0.81)",
      "Lines:",
      "1 [001.00-002.60] ⟨f1 嗯，⟩我用 Claude 剪片。",
      "2 [003.30-003.90] ⟨f2 那個⟩好。",
    ].join("\n"),
  );
  assert.equal(formatTime(4.2), "004.20");
});

test("a file without speech is packed as B-roll, without lines", () => {
  const packed = packSource("cutaway", index([]), [], []);
  assert.match(packed, /^## cutaway \(30\.0 s, no speech: B-roll\)/);
  assert.doesNotMatch(packed, /Lines:/);
});

test("filler candidates: single words with their punctuation, and 那個 across two words", () => {
  const list = words(
    ["嗯，", 0, 0.1],
    ["Um,", 0.2, 0.3],
    ["那", 0.4, 0.5],
    ["個", 0.5, 0.6],
    ["那，", 0.7, 0.8],
    ["個", 0.8, 0.9],
    ["就", 1.0, 1.1],
    ["是", 1.1, 1.2],
    ["umbrella", 1.3, 1.6],
  );
  const found = fillerCandidates("a", list, 4);
  assert.deepEqual(
    found.map((c) => [c.id, c.first, c.last]),
    [
      ["f4", 0, 0],
      ["f5", 1, 1],
      ["f6", 2, 3],
      ["f7", 6, 7],
    ],
  );
  assert.deepEqual(findWords(list, 0, 8, "那個"), [2, 3]);
  assert.deepEqual(findWords(list, 0, 8, "um"), [1, 1]);
  assert.equal(findWords(list, 0, 8, "不在"), null);
});

test("words join as subtitles write them, and carry their language", () => {
  assert.equal(joinWords(["我", "用", "Claude", "Code", "剪", "片。"]), "我用 Claude Code 剪片。");
  assert.equal(joinWords(["editing，", "也", "就"]), "editing，也就");
  assert.equal(
    joinWords(["flares,", "and", "you", "know,", "lo", "and", "behold.", "It's", "8.5%", "AI"]),
    "flares, and you know, lo and behold. It's 8.5% AI",
  );
  assert.equal(wordLanguage("好，"), "zh-TW");
  assert.equal(wordLanguage("API"), "en");
  assert.equal(wordLanguage("，"), null);
});

test("a file's header says when it shows a screen recording, its shots next to each other as one", () => {
  const media = index(words(["大", 1.0, 1.2]));
  const shot = (start: number, end: number, layout: FramedShot["layout"]): FramedShot => ({
    start,
    end,
    layout,
    faces: [],
    speakers: [],
  });
  const lines = splitLines(placed("talk", media.transcript.words));
  assert.doesNotMatch(packSource("talk", media, lines, []), /Screen recording/);
  media.framing = {
    fps: 5,
    shots: [
      shot(0, 5, "talking_head"),
      shot(5, 12.4, "screen"),
      shot(12.4, 20, "screen_cam"),
      shot(20, 30, "talking_head"),
    ],
  };
  assert.match(packSource("talk", media, lines, []), /\nScreen recording: 5\.0-20\.0 s\n/);
});
