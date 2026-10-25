// Where Chinese may wrap. The page sets `word-break: keep-all`, so Chinese wraps only at
// punctuation, at spaces and at the zero-width spaces this puts between two of its words: a line
// never breaks inside a word. A word of one character stays with its neighbours, as the
// dictionary splits a word it does not know (講者, 圖卡) into single characters.

const BREAK = "​";
const SEGMENTER = new Intl.Segmenter("zh-Hant", { granularity: "word" });
const HAN = /\p{Script=Han}/u;

/** `text` with a zero-width space between each two Chinese words of two characters or more that
 * touch. */
export function phrased(text: string): string {
  if (!HAN.test(text)) return text;
  let out = "";
  let after = false;
  for (const { segment, isWordLike } of SEGMENTER.segment(text.replaceAll(BREAK, ""))) {
    const word = Boolean(isWordLike) && [...segment].length > 1 && HAN.test(segment);
    if (after && word && HAN.test(segment[0] ?? "")) out += BREAK;
    out += segment;
    after = word && HAN.test(segment.at(-1) ?? "");
  }
  return out;
}
