import type { Word } from "@video-editor/schema";
import { bare } from "./text.ts";

/** Words that are often hesitations. 那個 and 就是 are also real words ("那個 click 聲", that
 * click), so code only flags them and the planner decides in context. */
const FILLERS = [
  ["嗯"],
  ["呃"],
  ["額"],
  ["欸"],
  ["那", "個"],
  ["就", "是"],
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

/** A run of words that may be a filler, `first` to `last` inclusive. */
export interface FillerCandidate {
  id: string;
  source: string;
  first: number;
  last: number;
}

/**
 * Every place in `words` that reads as a filler. Punctuation inside a candidate breaks it ("那，
 * 個" is two words), punctuation after it does not ("嗯，"). Ids continue from `next`.
 */
export function fillerCandidates(
  source: string,
  words: readonly Word[],
  next = 1,
): FillerCandidate[] {
  const found: FillerCandidate[] = [];
  let id = next;
  for (let i = 0; i < words.length; i++) {
    const match = FILLERS.find((parts) =>
      parts.every((part, k) => {
        const word = words[i + k];
        if (!word || bare(word.text) !== part) return false;
        // Only the last part may carry punctuation.
        return k === parts.length - 1 || word.text.toLowerCase() === part;
      }),
    );
    if (!match) continue;
    found.push({ id: `f${id++}`, source, first: i, last: i + match.length - 1 });
    i += match.length - 1;
  }
  return found;
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
