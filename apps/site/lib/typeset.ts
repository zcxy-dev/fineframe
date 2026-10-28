// Line breaking for the site's text, worked out when the pages are built. Chinese breaks only
// between phrases, never inside a word: BudouX (Apache-2.0) finds the phrases. Its Traditional
// Chinese model alone splits some words (素|材, 每小|時), so a break is kept only where the
// dictionary of the ICU word breaker built into Node also ends a word, and the rules below
// take out what neither knows.
import { loadDefaultTraditionalChineseParser } from "budoux";

const budoux = loadDefaultTraditionalChineseParser();
const icu = new Intl.Segmenter("zh-Hant", { granularity: "word" });

/** Words both split, and names, kept whole. */
const WORDS = [
  "曲庫",
  "上傳",
  "影片檔",
  "安裝檔",
  "記憶體",
  "逐字稿",
  "剪接點",
  "短影音",
  "金鑰",
  "成片",
  "頁面",
  "收件匣",
  "影音",
  "多支",
  "命令列",
  "算圖器",
  "函式庫",
  "月繳",
  "年繳",
  "測試期間",
  "極客灣Geekerwan",
  "任一",
  "大頭貼",
  "Apple 晶片",
  "CC BY 3.0",
  "Final Cut Pro",
  "DaVinci Resolve",
  "Premiere Pro",
  "Christina Koch",
  "Don Pettit",
];

const HAN = /[㐀-鿿豈-﫿]/;
/** Punctuation that closes a phrase: no line starts with it. */
const CLOSING = /^[，。、：；？！）」』〉》%]/;
/** Punctuation that opens one: no line ends with it. */
const OPENING = /[（「『〈《]$/;
const LATIN = /[A-Za-z0-9$+\-./:]/;

/** Where a list of pieces splits `text`: the offsets between the pieces. */
function cuts(pieces: string[]): Set<number> {
  const at = new Set<number>();
  let offset = 0;
  for (const piece of pieces.slice(0, -1)) {
    offset += piece.length;
    at.add(offset);
  }
  return at;
}

/** Whether a line may break at `i`, between `text[i - 1]` and `text[i]`. */
function breakable(text: string, i: number, kept: Set<number>): boolean {
  const before = text.slice(0, i);
  const after = text.slice(i);
  if (CLOSING.test(after.trimStart()) || OPENING.test(before.trimEnd())) return false;
  // Latin words and numbers stay whole.
  const left = before.trimEnd().at(-1) ?? "";
  const right = after.trimStart()[0] ?? "";
  if (LATIN.test(left) && LATIN.test(right) && !/\s/.test(text[i - 1] ?? "")) return false;
  // A number stays with its unit (59 秒, 12 GB) and a name with its number (Windows 10).
  if (/[0-9]/.test(left) && (HAN.test(right) || /[A-Za-z]/.test(right))) return false;
  if (/[A-Za-z]/.test(left) && /[0-9]/.test(right)) return false;
  if (WORDS.some((word) => inside(text, i, word))) return false;
  return kept.has(i);
}

/** Whether offset `i` falls inside an occurrence of `word`. */
function inside(text: string, i: number, word: string): boolean {
  for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) {
    if (i > at && i < at + word.length) return true;
  }
  return false;
}

const hanCount = (s: string) => [...s].filter((c) => HAN.test(c)).length;

/** A Chinese text's phrases, which a line breaks only between. */
export function phrases(text: string): string[] {
  const words = cuts([...icu.segment(text)].map((s) => s.segment));
  const kept = new Set([...cuts(budoux.parse(text))].filter((i) => words.has(i)));
  // Spaces between Chinese and Latin text are places to break, as in any text.
  for (let i = 1; i < text.length; i++) if (text[i - 1] === " ") kept.add(i);
  const out: string[] = [];
  let start = 0;
  for (let i = 1; i < text.length; i++) {
    if (breakable(text, i, kept)) {
      out.push(text.slice(start, i));
      start = i;
    }
  }
  out.push(text.slice(start));
  // A space ends the phrase before it, so a line breaks after it.
  for (let i = 1; i < out.length; i++) {
    const lead = /^ +/.exec(out[i] ?? "")?.[0] ?? "";
    out[i - 1] += lead;
    out[i] = (out[i] ?? "").slice(lead.length);
  }
  for (let i = out.length - 1; i > 0; i--) if (!out[i]) out.splice(i, 1);
  // A lone character joins the phrase after it, and the last phrase joins the one before
  // unless it holds three characters: no line is one character, or one and a mark.
  const merged: string[] = [];
  for (const piece of out) {
    const last = merged.at(-1);
    if (last !== undefined && hanCount(last) === 1 && !/[，。、：；]$/.test(last.trim())) {
      merged[merged.length - 1] = last + piece;
    } else merged.push(piece);
  }
  const end = merged.at(-1) ?? "";
  if (merged.length > 1 && hanCount(end) < 3 && !/[A-Za-z]{3}/.test(end)) {
    merged.splice(-2, 2, (merged.at(-2) ?? "") + end);
  }
  return merged;
}
