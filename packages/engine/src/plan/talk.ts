// A short synthetic talk for planner tests: a test pattern with a tone, and a media index whose
// transcript has a filler with pauses around it, a filler glued to the next word, a real use of
// 那個, an abandoned sentence and its retake.

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MediaIndex, MusicIndex, Word } from "@video-editor/schema";
import { ffmpeg, QUIET, run } from "../ffmpeg.ts";
import { makeSource } from "../fixtures.ts";

/** One line per sentence as said; a Han character or an English word is one word, carrying the
 * punctuation after it. */
const TALK = [
  "嗯，大家好，歡迎收看。",
  "今天要講三件事。",
  "第一件事是剪輯，不對，",
  "第一件事是自動剪輯。",
  "那個工具叫做 video editor。",
  "第二件事是字幕，嗯，字幕要用繁體中文。",
  "第三件事是長度。",
  "謝謝收看，我們下次見。",
];

const WORD = 0.22;
/** Inside a phrase, words run together; after a comma there is room to cut; a sentence ends
 * with a pause. */
const GAPS = { word: 0.02, comma: 0.16, sentence: 0.7 };
const START = 0.6;

/** The words of TALK, timed. */
export function talkWords(): Word[] {
  const words: Word[] = [];
  let t = START;
  for (const sentence of TALK) {
    const tokens = sentence.match(/[A-Za-z]+[，。]?|\p{Script=Han}[，。]?/gu) ?? [];
    for (const text of tokens) {
      const seconds = /[A-Za-z]/.test(text) ? 0.4 : WORD;
      words.push({ text, start: round(t), end: round(t + seconds) });
      t +=
        seconds +
        (text.endsWith("。") ? GAPS.sentence : text.endsWith("，") ? GAPS.comma : GAPS.word);
    }
  }
  return words;
}

const round = (seconds: number) => Math.round(seconds * 1000) / 1000;

/** Writes talk.mp4 and talk.index.json into `dir` and returns the index's path. */
export async function makeTalk(
  dir: string,
  id = "talk",
  size = { width: 160, height: 90 },
): Promise<string> {
  const words = talkWords();
  const seconds = Math.ceil((words.at(-1) as Word).end + 1);
  await makeSource(dir, {
    id,
    pattern: "testsrc2",
    ...size,
    fps: 25,
    seconds,
    sound: 440,
  });
  const path = join(dir, `${id}.index.json`);
  const index = JSON.parse(await readFile(path, "utf8")) as MediaIndex;
  index.speech = [{ start: (words[0] as Word).start, end: (words.at(-1) as Word).end }];
  index.transcript = { language: "zh", text: TALK.join("\n"), words };
  await writeFile(path, JSON.stringify(index));
  return path;
}

/** Writes song.wav, a 40 s tone, and the music index vework analyze-music would write beside it
 * (song.music.json): 120 BPM in two sections. Returns the index's path. */
export async function makeSong(
  dir: string,
  license: MusicIndex["license"] = { name: "CC BY 4.0", attribution: "Song by Someone" },
): Promise<string> {
  const wav = join(dir, "song.wav");
  await run(await ffmpeg(), [...QUIET, "-f", "lavfi", "-i", "sine=f=330:d=40", "-ac", "2", wav]);
  const beats = Array.from({ length: 76 }, (_, i) => 0.25 + i * 0.5);
  const index: MusicIndex = {
    version: 1,
    source: { name: "song.wav", duration: 40, sample_rate: 48000, channels: 2 },
    license,
    tracker: "synthetic",
    tempo: { bpm: 120, beats_per_bar: 4 },
    beats,
    downbeats: beats.filter((_, i) => i % 4 === 0),
    sections: [
      { start: 0, end: 16.25, loudness: -24 },
      { start: 16.25, end: 38.5, loudness: -15 },
    ],
    loudness: Array.from({ length: 40 }, () => -15),
    end: 38.5,
  };
  const path = join(dir, "song.music.json");
  await writeFile(path, JSON.stringify(index));
  return path;
}
