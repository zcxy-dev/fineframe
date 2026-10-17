// How transcript words read as text: one word per Han character or English word, each carrying
// the punctuation next to it, as the media index stores them.

const HAN = /\p{Script=Han}/u;
const LATIN = /[A-Za-z0-9]/;
/** Half-width punctuation that closes an English word, after which English text sets a space. */
const CLOSES = /[,.;:!?%)\]"'’”]/;
const PUNCTUATION = /[\p{P}\p{S}\s]/gu;
// A sentence ends at one of these, so a cut there leaves whole sentences on both sides.
const SENTENCE_END = /[。！？!?.…]["」』）)]*$/u;

/** The word without punctuation, lowercased: what it says. */
export function bare(text: string): string {
  return text.replace(PUNCTUATION, "").toLowerCase();
}

export function endsSentence(text: string): boolean {
  return SENTENCE_END.test(text);
}

export function isLatin(text: string): boolean {
  return LATIN.test(text) && !HAN.test(text);
}

/** The BCP 47 language a word is written in: Han characters are Taiwan Mandarin, as the
 * transcript is converted to Taiwan Traditional Chinese; letters and digits are English. */
export function wordLanguage(text: string): "zh-TW" | "en" | null {
  if (HAN.test(text)) return "zh-TW";
  if (/[A-Za-z]/.test(text)) return "en";
  return null;
}

/** Words joined as a subtitle writes them: Chinese characters run together, and a space sets
 * off each English word or number, except next to full-width punctuation or before punctuation. */
export function joinWords(words: readonly string[]): string {
  let text = "";
  for (const word of words) {
    const before = text.at(-1) ?? "";
    const first = word[0] ?? "";
    const spaced =
      (LATIN.test(before) && (LATIN.test(first) || HAN.test(first))) ||
      (CLOSES.test(before) && LATIN.test(first)) ||
      (HAN.test(before) && LATIN.test(first));
    text += (spaced ? " " : "") + word;
  }
  return text;
}
