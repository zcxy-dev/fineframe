import {
  type CaptionLine,
  type CaptionWord,
  secondsToTicks,
  type Word,
} from "@video-editor/schema";
import { GAP, holdsTogether, insideWord } from "../captions/layout.ts";
import type { PlacedClip, PlaceSource } from "./place.ts";
import { bare, endsSentence, halfWidth, joinWords, wordLanguage } from "./text.ts";

/** A kept word on the output timeline. */
export interface TimedWord {
  source: string;
  /** Index in its source's transcript. */
  index: number;
  text: string;
  /** Output ticks. */
  start: number;
  end: number;
}

/** Every word the clips play, in play order, at its time on the output timeline. */
export function outputWords(
  clips: readonly PlacedClip[],
  sources: ReadonlyMap<string, PlaceSource>,
): TimedWord[] {
  const timed: TimedWord[] = [];
  let position = 0;
  for (const clip of clips) {
    const words = (sources.get(clip.source) as PlaceSource).words;
    const length = clip.out - clip.in;
    for (let index = clip.first; index <= clip.last; index++) {
      const word = words[index] as Word;
      const at = (seconds: number) =>
        position + Math.min(length, Math.max(0, secondsToTicks(seconds) - clip.in));
      const start = at(word.start);
      // A word the aligner gave no duration still needs a tick to show.
      const end = Math.max(at(word.end), start + 1);
      timed.push({ source: clip.source, index, text: word.text, start, end });
    }
    position += length;
  }
  return timed;
}

/** A comma, a full stop or the like at the end of a word. A full stop after a word with another
 * one inside it (U.S.) is part of the word. */
const PAUSE_MARK = /(?:[，、。；：,;:]|(?<!\..*)\.)+$/u;
/** The same marks at the start of a word, where a transcript sometimes puts the pause before it. */
const LEADING_MARK = /^[，、。；：,;:]+/u;

/** The words' bare texts run together: the `count` before `at`, and from `at` on. */
function around(texts: readonly string[], at: number, count = 4): [string, string] {
  const run = (from: number, to: number) => texts.slice(from, to).map(bare).join("");
  return [run(Math.max(0, at - count), at), run(at, at + count)];
}

/** A full-width mark right after an English word or a number, set half-width as English sets it
 * (Really？ -> Really?). */
function englishMarks(text: string): string {
  return text.replace(/(?<=[A-Za-z0-9])[，。！？：；、]/gu, halfWidth);
}

/**
 * A Chinese caption line as Taiwanese subtitles set it: no commas or full stops, a full-width
 * space where one fell inside the line and nothing where one ended it. Question and exclamation
 * marks, quotes and ellipses stay, half-width after an English word. A mark the transcript put
 * inside a word (打。開) makes no pause. Each word's text loses its mark too; a word that was
 * only punctuation has nothing left to show, so it gets an empty text.
 */
export function subtitled(words: readonly string[]): { text: string; words: string[] } {
  const shown: string[] = [];
  let text = "";
  let pause = false;
  for (const [i, word] of words.entries()) {
    const bareWord = word.replace(LEADING_MARK, "");
    const kept = englishMarks(bareWord.replace(PAUSE_MARK, ""));
    shown.push(kept);
    if (bareWord !== word) pause = true;
    if (kept) {
      if (pause && insideWord(...around(words, i))) pause = false;
      if (pause && text) text += GAP;
      text = pause ? text + kept : joinWords([text, kept].filter(Boolean));
      pause = false;
    }
    if (PAUSE_MARK.test(bareWord)) pause = true;
  }
  return { text, words: shown };
}

/**
 * Caption lines for the kept speech, one per transcript line or sentence, whichever is shorter,
 * on the output timeline. Splitting them to fit the screen is the caption renderer's job. A line
 * is tagged with the language most of its words are in, and a word in the other language with
 * its own. A Chinese line drops its commas and full stops as Taiwanese subtitles do; an English
 * line keeps its punctuation, half-width.
 */
export function captionLines(
  words: readonly TimedWord[],
  lineOf: (source: string, index: number) => number,
): CaptionLine[] {
  const groups: TimedWord[][] = [];
  for (const [i, word] of words.entries()) {
    const previous = words[i - 1];
    const group = groups.at(-1);
    const continues =
      group &&
      previous &&
      previous.source === word.source &&
      word.index > previous.index &&
      ((lineOf(previous.source, previous.index) === lineOf(word.source, word.index) &&
        !endsSentence(previous.text)) ||
        // A line never ends inside a word or on one that leads into the next, wherever the
        // transcript put a pause or a full stop.
        (word.index === previous.index + 1 &&
          holdsTogether(
            ...around(
              [...group.map((w) => w.text), ...words.slice(i).map((w) => w.text)],
              group.length,
            ),
          )));
    if (continues) group.push(word);
    else groups.push([word]);
  }
  return groups.flatMap((group): CaptionLine[] => {
    const counts = { "zh-TW": 0, en: 0 };
    for (const word of group) {
      const language = wordLanguage(word.text);
      if (language) counts[language]++;
    }
    const language = counts.en > counts["zh-TW"] ? "en" : "zh-TW";
    const texts = group.map((word) => word.text);
    const english = texts.map((text) => text.replace(/[，。！？：；、]/gu, halfWidth));
    const shown =
      language === "zh-TW" ? subtitled(texts) : { text: joinWords(english), words: english };
    const captionWords = group.flatMap((word, i): CaptionWord[] => {
      const own = wordLanguage(word.text);
      const text = shown.words[i] as string;
      if (!text) return [];
      return [
        {
          text,
          start: word.start,
          end: word.end,
          ...(own && own !== language ? { language: own } : {}),
        },
      ];
    });
    // Punctuation left on its own, such as a full stop after a question, has nothing to show.
    if (!shown.text) return [];
    const first = group[0] as TimedWord;
    const last = group.at(-1) as TimedWord;
    return [
      {
        start: first.start,
        end: last.end,
        language,
        text: shown.text,
        words: captionWords,
      },
    ];
  });
}
