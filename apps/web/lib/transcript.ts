// How the re-edit panel sets a caption line's words, each its own button: with the spaces the
// line's text puts between them, so English reads as words and Chinese runs together.

const LATIN = /[A-Za-z0-9]/;
const HAN = /\p{Script=Han}/u;
/** What may stand between two words in the line's text: spaces and punctuation, no letters. */
const BETWEEN = /^[\s\p{P}\p{S}]*$/u;
const PUNCTUATION = /[\p{P}\p{S}]/gu;

/** Whether each word of `line` follows a space. The line's text, as the engine joined its words,
 * says so; a word it does not hold is spaced as the engine spaces words: after English or a
 * number, and before English after Chinese. */
export function spacedWords(line: { text: string; words: { text: string }[] }): boolean[] {
  let at = 0;
  return line.words.map((word, w) => {
    // As written, or without its punctuation, which a subtitle may set as a space.
    for (const text of [word.text, word.text.replace(PUNCTUATION, "")]) {
      const found = text ? line.text.indexOf(text, at) : -1;
      const between = line.text.slice(at, found);
      if (found >= 0 && BETWEEN.test(between)) {
        at = found + text.length;
        return w > 0 && /\s/.test(between);
      }
    }
    const before = line.words[w - 1]?.text.at(-1) ?? "";
    const first = word.text[0] ?? "";
    return (
      (LATIN.test(before) && (LATIN.test(first) || HAN.test(first))) ||
      (HAN.test(before) && LATIN.test(first))
    );
  });
}
