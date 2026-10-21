import type { Word } from "@video-editor/schema";
import { bare, endsSentence } from "./text.ts";

/** How much of what is said `--fillers` cuts: clear hesitations and stutters (natural), words
 * that are often verbal tics too (aggressive), or nothing (off). */
export const FILLER_MODES = ["natural", "aggressive", "off"] as const;
export type FillerMode = (typeof FILLER_MODES)[number];
export const DEFAULT_FILLERS: FillerMode = "natural";

/** Hesitations: sounds that are almost never words. */
const HESITATIONS = [
  ["嗯"],
  ["呃"],
  ["額"],
  ["um"],
  ["umm"],
  ["uh"],
  ["uhm"],
  ["er"],
  ["erm"],
  ["hmm"],
  ["mm"],
  ["ah"],
  ["eh"],
];

/** Words that are often verbal tics and as often real words ("那個 click 聲", that click; "I
 * like it"), flagged only in aggressive mode for the planner to decide in context. */
const TICS = [
  ["啊"],
  ["喔"],
  ["欸"],
  ["那", "個"],
  ["這", "個"],
  ["就", "是"],
  ["然", "後"],
  ["對"],
  ["like"],
  ["you", "know"],
  ["i", "mean"],
  ["basically"],
  ["so"],
];
/** Tics that are one only where a sentence starts. */
const OPENING = new Set(["so"]);
/** A word starts a sentence after one that ends in punctuation, or after this long a pause. */
const OPENING_PAUSE = 0.3;
/** The longest run of words a stutter repeats: "this one, this one". */
const REPEAT_MAX = 3;
const HAN = /\p{Script=Han}/u;

/** A run of words that may be a filler, `first` to `last` inclusive. */
export interface FillerCandidate {
  id: string;
  source: string;
  first: number;
  last: number;
}

/**
 * Every place in `words` that reads as a filler in `mode`: a hesitation, the earlier copies of
 * words said again at once (我我媽, the the), and in aggressive mode a word that is often a tic.
 * Punctuation inside a candidate breaks it ("那，個" is two words), punctuation after it does not
 * ("嗯，"). Ids continue from `next`.
 */
export function fillerCandidates(
  source: string,
  words: readonly Word[],
  mode: FillerMode,
  next = 1,
): FillerCandidate[] {
  if (mode === "off") return [];
  const listed = mode === "aggressive" ? [...HESITATIONS, ...TICS] : HESITATIONS;
  const found: FillerCandidate[] = [];
  let id = next;
  for (let i = 0; i < words.length; i++) {
    const length = repeated(words, i) || listedAt(words, i, listed);
    if (!length) continue;
    found.push({ id: `f${id++}`, source, first: i, last: i + length - 1 });
    i += length - 1;
  }
  return found;
}

/** Whether `parts` are said from word `i` on: only the last part may carry punctuation. */
function says(words: readonly Word[], i: number, parts: readonly string[]): boolean {
  return parts.every((part, k) => {
    const word = words[i + k];
    if (!word || bare(word.text) !== part) return false;
    return k === parts.length - 1 || word.text.toLowerCase() === part;
  });
}

/** How many words of `listed` are said from word `i`, 0 for none. */
function listedAt(words: readonly Word[], i: number, listed: readonly string[][]): number {
  const match = listed.find(
    (parts) => says(words, i, parts) && (!OPENING.has(parts.join(" ")) || opens(words, i)),
  );
  return match?.length ?? 0;
}

function opens(words: readonly Word[], i: number): boolean {
  const before = words[i - 1];
  const word = words[i] as Word;
  return !before || /\p{P}$/u.test(before.text) || word.start - before.end >= OPENING_PAUSE;
}

/** How many words from word `i` are said again, and again, until their last copy: the copies
 * before it, 0 when none. The shortest repeated run counts, so 我我我 is two copies of 我. Words
 * said again after the end of a sentence (like that. That was), or a Chinese character said again
 * after any punctuation (差不多，多一點), start the next sentence or phrase: no repeat. */
function repeated(words: readonly Word[], i: number): number {
  for (let n = 1; n <= REPEAT_MAX; n++) {
    const run = words.slice(i, i + n).map((w) => bare(w.text));
    if (run.length < n || run.some((text) => !text)) return 0;
    const next = (copies: number) => {
      const end = (words[i + copies * n - 1] as Word).text;
      const apart = endsSentence(end) || (n === 1 && HAN.test(end) && /\p{P}$/u.test(end));
      return !apart && says(words, i + copies * n, run);
    };
    let copies = 1;
    while (next(copies)) copies++;
    if (copies > 1) return (copies - 1) * n;
  }
  return 0;
}

/** The first run of words in [first, last] that reads `text`, ignoring punctuation and case;
 * how a filler the planner names in its own words is found in the transcript. */
export function findWords(
  words: readonly Word[],
  first: number,
  last: number,
  text: string,
): [number, number] | null {
  const wanted = bare(text);
  if (!wanted) return null;
  for (let i = first; i <= last; i++) {
    let said = "";
    for (let j = i; j <= last; j++) {
      said += bare((words[j] as Word).text);
      if (said === wanted) return [i, j];
      if (!wanted.startsWith(said)) break;
    }
  }
  return null;
}
