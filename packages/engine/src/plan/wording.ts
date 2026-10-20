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

const NUMERALS = "〇零一二兩三四五六七八九十百千萬億";

/** The numbers written in digits in a text, each whole: 1,000 as 1000, 4.5 as itself. */
function numbersIn(text: string): string[] {
  return text.replace(/(\d),(?=\d{3})/g, "$1").match(/\d+(?:\.\d+)?/g) ?? [];
}

/** The Latin words in a text, in lower case: runs of letters that are not Chinese. */
function latinWords(text: string): string[] {
  return text.toLowerCase().match(/(?:(?!\p{Script=Han})\p{L})+/gu) ?? [];
}

/**
 * The words on a graphic that the speech near it does not hold: each run of Chinese characters
 * must be made of pieces of two or more characters found in the speech, joined at most by single
 * small words (的, 和, 不 and the like) or by a unit the speaker says right after a number (歲 in
 * 二十七歲); each Latin word and number must be said, a number in digits or in Chinese numerals,
 * a lone 十 among them.
 */
export function unsaid(shown: string, speech: string): string[] {
  const said = normalized(speech);
  const plain = speech.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
  // Each number said whole, in digits (1,000 and 4.5 among them) or in Chinese numerals.
  const numbers = new Set<string>(numbersIn(speech));
  for (const run of plain.match(new RegExp(`[${NUMERALS}]+`, "g")) ?? []) {
    const value = chineseNumber(run);
    if (value !== null) numbers.add(String(value));
  }
  const afterNumber = (char: string) => {
    for (let i = plain.indexOf(char); i > 0; i = plain.indexOf(char, i + 1)) {
      if (/\d/.test(plain[i - 1] as string) || NUMERALS.includes(plain[i - 1] as string))
        return true;
    }
    return false;
  };
  const words = new Set(latinWords(speech));
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
        // A number on it must be one the speaker says.
        const digits = run.slice(at).match(/^\d+(?:\.\d+)?/)?.[0];
        if (length >= 2) at += length;
        else if (digits && numbers.has(digits)) at += digits.length;
        else if (!digits && (JOINERS.has(run[at] as string) || afterNumber(run[at] as string))) {
          at += 1;
        } else {
          ok = false;
          break;
        }
      }
      if (!ok) missing.push(token);
    } else {
      // Each number and word in it said whole: 20 is not in 2024, nor art in start.
      const parts = numbersIn(token).concat(latinWords(token));
      const heard = (part: string) =>
        /^\d/.test(part) ? numbers.has(part) : words.has(part) || JOINERS.has(part);
      if (parts.length > 0 && !parts.every(heard)) missing.push(token);
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

/** How much of a phrase a graphic may show, by its words' weight (repeated's units). A graphic
 * restates a phrase said while it shows when the words both hold in order weigh at least `least`,
 * make up `ofGraphic` of the graphic, and make up `ofPhrase` of the phrase or leave out at most
 * `leftOut` of its words that are not small words: 害怕 becoming thirty for 會害怕 becoming thirty
 * 嗎. A keyword, a number or one side of a comparison is a small part of one or the other, and two
 * keywords that leave a phrase's subject out (十幾歲, 二十幾歲 for 十幾歲或二十幾歲的朋友) do not
 * restate it. */
const RESTATED = { least: 5, ofGraphic: 0.8, ofPhrase: 0.7, leftOut: 1 };

/** The heaviest run of units both lists hold in the same order, gaps allowed, by `weigh`. */
function common(a: readonly string[], b: readonly string[], weigh: (unit: string) => number) {
  let previous = new Array<number>(b.length + 1).fill(0);
  for (const unit of a) {
    const row = [0];
    for (const [k, other] of b.entries()) {
      const along = unit === other ? (previous[k] as number) + weigh(unit) : 0;
      row.push(Math.max(along, previous[k + 1] as number, row[k] as number));
    }
    previous = row;
  }
  return previous[b.length] as number;
}

/** The phrase said while the graphic shows that its words restate, or null (RESTATED). */
export function restates(pieces: readonly string[], phrases: readonly string[]): string | null {
  const shown = pieces.flatMap(units);
  const total = (list: readonly string[], weigh: (unit: string) => number) =>
    list.reduce((sum, unit) => sum + weigh(unit), 0);
  // Words that carry meaning: small words such as 的, 或 and 嗎 weigh nothing.
  const content = (unit: string) => (JOINERS.has(unit) ? 0 : weight(unit));
  const graphic = total(shown, weight);
  for (const phrase of phrases) {
    const said = units(phrase);
    const both = common(shown, said, weight);
    const leftOut = total(said, content) - common(shown, said, content);
    if (
      both >= RESTATED.least &&
      both >= RESTATED.ofGraphic * graphic &&
      (both >= RESTATED.ofPhrase * total(said, weight) || leftOut <= RESTATED.leftOut)
    ) {
      return phrase;
    }
  }
  return null;
}

/** Whether the speech names `name` whole: a Chinese name as said (星巴克), a Latin one as the
 * run of words it is (Google Drive, Node.js), never inside a longer word (X is not in next, nor
 * Meta in metadata). */
export function saysName(name: string, speech: string): boolean {
  if (/\p{Script=Han}/u.test(name)) return normalized(speech).includes(normalized(name));
  const words = (text: string) =>
    text.toLowerCase().match(/(?:(?!\p{Script=Han})[\p{L}\p{N}])+/gu) ?? [];
  const said = words(speech);
  const parts = words(name);
  if (parts.length === 0) return false;
  const joined = parts.join("");
  return said.some((word, i) => word === joined || parts.every((part, k) => said[i + k] === part));
}

/** The brands whose logos the graphic's markup shows that the speech does not name, by title. */
export function unnamed(html: string, speech: string): string[] {
  return marksIn(html)
    .logos.filter((name) => !saysName(LOGOS[name].title, speech))
    .map((name) => LOGOS[name].title);
}
