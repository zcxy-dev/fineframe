// Whether a graphic says what the speaker says: each Chinese word on it found in the speech, or
// joined by a small word; each Latin word and number said, a number in either script; and each
// brand whose logo it shows named.

import { LOGOS, marksIn } from "@video-editor/effects";

/** Characters a graphic may use to join the speaker's words without their having said them. */
const JOINERS = new Set("的了和與及或也都就很更最不沒是在有個嗎呢啊吧把被從到對").add("vs");

const DIGITS: Record<string, number> = {
  零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
}; // biome-ignore format: one table
const UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

/** A run of Chinese numerals as a number: 二十七 → 27, 三百 → 300, 一萬五千 → 15000. */
function chineseNumber(run: string): number | null {
  let total = 0;
  let section = 0;
  let digit: number | null = null;
  for (const char of run) {
    if (char in DIGITS) digit = DIGITS[char] as number;
    else if (char in UNITS) {
      section += (digit ?? 1) * (UNITS[char] as number);
      digit = null;
    } else if (char === "萬" || char === "億") {
      total += (section + (digit ?? 0)) * (char === "萬" ? 10_000 : 100_000_000);
      section = 0;
      digit = null;
    } else return null;
  }
  return total + section + (digit ?? 0);
}

/** Text with spaces and punctuation gone, lower case, and Chinese numerals as digits. */
export function normalized(text: string): string {
  return text
    .toLowerCase()
    .replace(/[〇零一二兩三四五六七八九十百千萬億]+/g, (run) => {
      // A lone 一 or 十 is as often a word as a number (一個, 十足); longer runs are numbers.
      if (run.length === 1 && !/[二三四五六七八九兩]/.test(run)) return run;
      const value = chineseNumber(run);
      return value === null ? run : String(value);
    })
    .replace(/(\d),(?=\d{3})/g, "$1")
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

/**
 * The words on a graphic that the speech near it does not hold: each run of Chinese characters
 * must be made of pieces of two or more characters found in the speech, joined at most by single
 * small words (的, 和, 不 and the like); each Latin word and number must be said, a number in
 * digits or in Chinese numerals.
 */
export function unsaid(shown: string, speech: string): string[] {
  const said = normalized(speech);
  const missing: string[] = [];
  for (const token of shown.match(/[\p{Script=Han}]+|[\p{L}\p{N}][\p{L}\p{N}.,'%-]*/gu) ?? []) {
    if (/\p{Script=Han}/u.test(token)) {
      const run = normalized(token);
      let at = 0;
      let ok = true;
      while (at < run.length) {
        // The longest piece from here the speech holds.
        let length = 0;
        for (let n = run.length - at; n >= 2; n--) {
          if (said.includes(run.slice(at, at + n))) {
            length = n;
            break;
          }
        }
        if (length >= 2) at += length;
        else if (JOINERS.has(run[at] as string) || /\d/.test(run[at] as string)) at += 1;
        else {
          ok = false;
          break;
        }
      }
      if (!ok) missing.push(token);
    } else {
      const word = normalized(token);
      if (word && !JOINERS.has(word) && !said.includes(word)) missing.push(token);
    }
  }
  return [...new Set(missing)];
}

/** A run this long of a graphic's text, said word for word while it shows, repeats the captions:
 * eight Chinese characters, or four Latin words, each counting two. */
const REPEAT = 8;

/** Text as words: each Chinese character one, each Latin word or number one, in lower case and
 * with Chinese numerals as digits. */
function units(text: string): string[] {
  return text
    .split(/\s+/)
    .flatMap((part) => normalized(part).match(/\p{Script=Han}|[^\p{Script=Han}]+/gu) ?? []);
}

const weight = (unit: string) => (/\p{Script=Han}/u.test(unit) ? 1 : 2);

/** The longest run of the graphic's words, read across its pieces in order, that the speech said
 * while it shows holds word for word, when it is long enough to be the sentence the captions show
 * rather than a keyword; null otherwise. */
export function repeated(pieces: readonly string[], speech: string): string | null {
  const said = units(speech);
  const shown = pieces.flatMap(units);
  let best: string[] = [];
  let bestWeight = 0;
  for (let i = 0; i < shown.length; i++) {
    for (let j = 0; j < said.length; j++) {
      let n = 0;
      while (i + n < shown.length && j + n < said.length && shown[i + n] === said[j + n]) n++;
      const run = shown.slice(i, i + n);
      const total = run.reduce((sum, unit) => sum + weight(unit), 0);
      if (total > bestWeight) {
        best = run;
        bestWeight = total;
      }
    }
  }
  if (bestWeight < REPEAT) return null;
  // Latin words keep a space between them; Chinese characters none.
  return best.reduce((text, unit, i) => {
    const spaced = i > 0 && weight(unit) === 2 && weight(best[i - 1] as string) === 2;
    return text + (spaced ? " " : "") + unit;
  }, "");
}

/** The brands whose logos the graphic's markup shows that the speech does not name, by title. */
export function unnamed(html: string, speech: string): string[] {
  const said = normalized(speech);
  return marksIn(html)
    .logos.filter((name) => !said.includes(normalized(LOGOS[name].title)) && !said.includes(name))
    .map((name) => LOGOS[name].title);
}
