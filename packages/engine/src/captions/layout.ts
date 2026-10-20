// Caption lines broken into pages of one or two rows, measured in ems of the caption face and
// timed on the output frame grid. The ASS captions and the SubRip export are both written from
// these pages, so the text and line breaks in the two always match.

import type { CaptionLine, Captions } from "@video-editor/schema";
import type { Metrics } from "./fonts.ts";

/** A run of a row's text drawn one way: one timed word, or text between words. */
interface Segment {
  text: string;
  /** The page's word this text belongs to, or null for spaces and punctuation between words. */
  word: number | null;
  /** From the row's left edge, in ems. */
  x: number;
  width: number;
}

export interface Row {
  segments: Segment[];
  /** In ems, letter spacing included. */
  width: number;
}

/** One caption on screen: up to two rows, shown from frame `start` until `end`. */
export interface Page {
  /** Position in `captions.lines`. */
  line: number;
  start: number;
  end: number;
  rows: Row[];
  /** The frames each of the page's words is the one being spoken: from its first frame until the
   * next word's. The line's last word stays lit until its sound ends and `tail` more, and a
   * page's last word otherwise until the page ends. Before the first, none is. `said` is the
   * frame its sound ends, where a karaoke sweep through the page's last word finishes. */
  words: { start: number; end: number; said: number }[];
}

export interface LayoutOptions {
  /** The longest row, in ems: the most CJK characters a row may hold. */
  maxWidth: number;
  /** The most rows on a page: one or two. */
  maxRows: number;
  /** Letter spacing after every character, in ems, as libass adds it. */
  tracking: number;
  /** Ticks per output frame. */
  frameTicks: number;
  /** Ticks a caption stays up after its line's last word, unless the next line starts first. */
  hold: number;
  /** Ticks the line's last word stays lit after its sound ends. */
  tail: number;
  /** The edit's length in frames; nothing shows past it. */
  frames: number;
}

/**
 * A pause inside a caption line: the full-width space Taiwanese subtitles set where the sentence
 * has a comma or a full stop. A row may break there, like at a space, and the break drops it.
 */
export const GAP = "　";

// Kinsoku: characters that never start a row, and characters that never end one.
const CLOSING = new Set(
  "、。，．：；？！）」』》〉】〕｝〗〙〛〞…‥‧・ー々〻ゝゞぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ％,.!?:;)]}%’”",
);
const OPENING = new Set("（「『《〈【〔｛〖〘〚〝([{‘“");
/** A row or page break right after these falls at a pause in the sentence. */
const PAUSES = new Set("，、。；：！？…—,.;:!?");
/** Doubled into one mark (……, ——), which never splits. */
const DOUBLED = new Set("—…‥");
/** One-character words that lead into the next (adverbs, prepositions, auxiliaries) and
 * particles that close the one before: a row would rather not end on the first or start with
 * the second, as in 最 | 尖端 or 尖端 | 的. Nor end on a negation, even inside a word such as
 * 都不. It does only when no other break balances. */
const LEADS = new Set("很太更最都也就還才再又把被將給在從對跟和與向往讓用有是會");
const NEGATIONS = new Set("不沒別");
const TRAILS = new Set("的了嗎呢吧啊呀嘛著過地得");

/** Chinese has no spaces between words, so a row breaks where ICU's dictionary ends a word:
 * between 一下 and 怎麼, never inside 剪片. */
const WORDS = new Intl.Segmenter("zh-Hant-TW", { granularity: "word" });

const HAN = /^\p{Script=Han}$/u;

/** Where ICU's words around the end of `before` meet `after`: whether one word spans the join,
 * and whether the characters on either side are words of their own. Only between two Chinese
 * characters; a join next to anything else is between words. */
function join(before: string, after: string) {
  const last = before.at(-1) ?? "";
  const first = after[0] ?? "";
  if (!HAN.test(last) || !HAN.test(first)) return null;
  const segments = [...WORDS.segment(before + after)];
  const at = before.length;
  const spans = segments.find((s) => s.index < at && s.index + s.segment.length > at);
  const ending = segments.find((s) => s.index + s.segment.length === at);
  const starting = segments.find((s) => s.index === at);
  return {
    inside: spans !== undefined,
    lastAlone: ending?.segment.length === 1,
    firstAlone: starting?.segment.length === 1,
    last,
    first,
  };
}

/** Whether text `before` and text `after`, run together, put one word of Chinese across the
 * join (打 | 開). */
export function insideWord(before: string, after: string): boolean {
  return join(before, after)?.inside ?? false;
}

/** Whether a caption should not break between `before` and `after`: inside a word, after a
 * word that leads into the next (會 | 太冷) or a negation, or before a particle that closes the
 * word before it (尖端 | 的). */
export function holdsTogether(before: string, after: string): boolean {
  const found = join(before, after);
  if (!found) return false;
  const { inside, lastAlone, firstAlone, last, first } = found;
  return (
    inside ||
    NEGATIONS.has(last) ||
    (LEADS.has(last) && lastAlone) ||
    (TRAILS.has(first) && firstAlone)
  );
}

/** Ideographs, kana, hangul and full-width forms, between which a row may break, and the
 * punctuation Chinese sets at full width. Latin text breaks only at spaces. */
function wide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd) ||
    code === 0x00b7 ||
    (code >= 0x2014 && code <= 0x201d) ||
    (code >= 0x2026 && code <= 0x2027)
  );
}

interface Char {
  text: string;
  width: number;
  /** The line's word this character belongs to. */
  word: number | null;
  /** A space or a gap, which a break there drops. */
  blank: boolean;
  /** ICU ends a word just before this character. */
  wordStart: boolean;
}

/** Where a row may end (`end`, exclusive) and the next begin (`next`): the same character
 * index, or the two sides of a space, which the break drops. */
interface Cut {
  end: number;
  next: number;
  pause: boolean;
  /** Inside a word, between two of its characters. */
  inWord: boolean;
  /** After a word that leads into the next, or before a closing particle. */
  weak: boolean;
}

/** Runs of whitespace, newlines included, as one space, or one gap if the run holds one; none at
 * either end. Rows are this module's to break. */
function normalise(text: string): string {
  return text.replace(/\s+/g, (run) => (run.includes(GAP) ? GAP : " ")).trim();
}

/** The characters of a line, each with its width and the word it belongs to. */
function characters(line: CaptionLine, path: string, measure: Metrics, tracking: number): Char[] {
  const text = normalise(line.text);
  const owner: (number | null)[] = Array.from({ length: text.length }, () => null);
  let cursor = 0;
  for (const [i, word] of (line.words ?? []).entries()) {
    const spoken = normalise(word.text);
    const at = spoken ? text.indexOf(spoken, cursor) : -1;
    if (at < 0) {
      throw new Error(
        `${path}/words/${i}: ${JSON.stringify(word.text)} is not in the line's text after the ` +
          "words before it",
      );
    }
    owner.fill(i, at, at + spoken.length);
    cursor = at + spoken.length;
  }
  const starts = new Set([...WORDS.segment(text)].map((segment) => segment.index));
  const chars: Char[] = [];
  let unit = 0;
  for (const char of text) {
    const code = char.codePointAt(0) as number;
    if ("{}\\".includes(char)) {
      // ASS reads these as override tags; the SubRip export shows the same text.
      throw new Error(`${path}/text: ${char} cannot be drawn in a caption`);
    }
    const advance = measure.advance(code);
    if (advance === undefined) {
      const hex = code.toString(16).toUpperCase().padStart(4, "0");
      throw new Error(`${path}/text: ${char} (U+${hex}) is not in the caption font`);
    }
    chars.push({
      text: char,
      width: advance + tracking,
      word: owner[unit] ?? null,
      blank: char === " " || char === GAP,
      wordStart: starts.has(unit),
    });
    unit += char.length;
  }
  return chars;
}

function cuts(chars: Char[]): Cut[] {
  const found: Cut[] = [];
  const same = (a: Char, b: Char) => a.word !== null && a.word === b.word;
  /** ICU makes the character at i a word of its own. */
  const alone = (i: number) => {
    const next = chars[i + 1];
    return (chars[i] as Char).wordStart && (!next || next.wordStart);
  };
  /** A break between the characters at i (the last of a row) and j (the first of the next). */
  const weak = (i: number, j: number) => {
    const last = (chars[i] as Char).text;
    const first = (chars[j] as Char).text;
    return NEGATIONS.has(last) || (LEADS.has(last) && alone(i)) || (TRAILS.has(first) && alone(j));
  };
  for (let i = 1; i < chars.length; i++) {
    const before = chars[i - 1] as Char;
    const here = chars[i] as Char;
    const after = chars[i + 1];
    if (here.blank) {
      if (after && !OPENING.has(before.text) && !CLOSING.has(after.text) && !same(before, after)) {
        const pause = here.text === GAP || PAUSES.has(before.text);
        found.push({ end: i, next: i + 1, pause, inWord: false, weak: weak(i - 1, i + 1) });
      }
      continue;
    }
    if (before.blank) continue;
    const a = before.text.codePointAt(0) as number;
    const b = here.text.codePointAt(0) as number;
    if (
      (wide(a) || wide(b)) &&
      !CLOSING.has(here.text) &&
      !OPENING.has(before.text) &&
      !same(before, here) &&
      !(DOUBLED.has(before.text) && DOUBLED.has(here.text))
    ) {
      found.push({
        end: i,
        next: i,
        pause: PAUSES.has(before.text),
        inWord: !here.wordStart,
        weak: weak(i - 1, i),
      });
    }
  }
  return found;
}

/** The cuts a row may end at: between words, and inside a word only where the stretch between
 * the word breaks around it is wider than a row, so a long name still fits. */
function usable(found: Cut[], chars: Char[], maxWidth: number): Cut[] {
  const prefix = [0];
  for (const char of chars) prefix.push((prefix.at(-1) as number) + char.width);
  const between = found.filter((cut) => !cut.inWord);
  return found.filter((cut) => {
    if (!cut.inWord) return true;
    const from = between.findLast((other) => other.end < cut.end)?.next ?? 0;
    const to = between.find((other) => other.end > cut.end)?.end ?? chars.length;
    return (prefix[to] as number) - (prefix[from] as number) > maxWidth + 1e-9;
  });
}

/**
 * Breaks one line into pages of at most `maxRows` rows. The line is first cut at its pauses into
 * phrases, and a page holds as many whole phrases as fit, each row whole phrases, so neither a
 * page nor a row ends inside a phrase that could have started one. A phrase longer than a page
 * is split into the fewest pages, of lengths as even as its word breaks allow, and a phrase
 * longer than a row into the two most even rows.
 */
function breakLine(
  chars: Char[],
  maxWidth: number,
  maxRows: number,
): { rows: [number, number][] }[] {
  const found = usable(cuts(chars), chars, maxWidth);
  const m = found.length;
  // Boundary 0 is the start of the text, m + 1 its end, and 1..m the cuts.
  const startOf = (b: number) => (b === 0 ? 0 : (found[b - 1] as Cut).next);
  const endOf = (b: number) => (b === m + 1 ? chars.length : (found[b - 1] as Cut).end);
  const prefix = [0];
  for (const char of chars) prefix.push((prefix.at(-1) as number) + char.width);
  const width = (a: number, b: number) =>
    (prefix[endOf(b)] as number) - (prefix[startOf(a)] as number);
  const pause = (b: number) => b <= m && (found[b - 1] as Cut).pause;
  const weak = (b: number) => b >= 1 && b <= m && (found[b - 1] as Cut).weak;
  // What ending a row at a weak break costs, against rows that much wider than each other.
  const penalty = maxWidth / 2;
  // A row with no break inside it must stand, however long: an English word is never split.
  const fits = (a: number, b: number) => b === a + 1 || width(a, b) <= maxWidth + 1e-9;

  const memo = new Map<number, number[] | null>();
  /** The boundaries of the rows from a to b: one row, the best two, or null if two cannot. */
  const rows = (a: number, b: number): number[] | null => {
    const key = a * (m + 2) + b;
    if (memo.has(key)) return memo.get(key) as number[] | null;
    let best: number[] | null = fits(a, b) ? [a, b] : null;
    if (!best && maxRows > 1) {
      let lowest = Number.POSITIVE_INFINITY;
      for (let c = a + 1; c < b; c++) {
        if (!fits(a, c) || !fits(c, b)) continue;
        const cost =
          Math.abs(width(a, c) - width(c, b)) -
          (pause(c) ? maxWidth / 2 : 0) +
          (weak(c) ? penalty : 0);
        if (cost < lowest) {
          lowest = cost;
          best = [a, c, b];
        }
      }
    }
    memo.set(key, best);
    return best;
  };

  /** The page ends that split boundaries a..b, which hold no pause, into the fewest pages of
   * even length. */
  const split = (a: number, b: number): number[] => {
    let pages = 0;
    for (let at = a; at < b; pages++) {
      let end = at + 1;
      while (end < b && rows(at, end + 1)) end++;
      at = end;
    }
    const target = width(a, b) / pages;
    let best = new Map<number, { cost: number; ends: number[] }>([[a, { cost: 0, ends: [] }]]);
    for (let page = 0; page < pages; page++) {
      const next = new Map<number, { cost: number; ends: number[] }>();
      for (const [from, reached] of best) {
        for (let to = from + 1; to <= b; to++) {
          if (!rows(from, to)) break;
          const cost =
            reached.cost + (width(from, to) - target) ** 2 + (weak(to) ? penalty ** 2 : 0);
          if (cost < (next.get(to)?.cost ?? Number.POSITIVE_INFINITY)) {
            next.set(to, { cost, ends: [...reached.ends, to] });
          }
        }
      }
      best = next;
    }
    return best.get(b)?.ends ?? [b];
  };

  // Units are the phrases between pauses, and the pages a phrase too long for one page is split
  // into. A page holds one unit, rows as `rows` splits it, or several whole units to a row.
  const pauses = [0];
  for (let b = 1; b <= m; b++) if (pause(b)) pauses.push(b);
  pauses.push(m + 1);
  const units: [number, number][] = [];
  for (let i = 0; i + 1 < pauses.length; i++) {
    const [a, b] = [pauses[i] as number, pauses[i + 1] as number];
    let from = a;
    for (const end of rows(a, b) ? [b] : split(a, b)) {
      units.push([from, end]);
      from = end;
    }
  }
  const page = (i: number, j: number): number[] | null => {
    const a = (units[i] as [number, number])[0];
    const b = (units[j] as [number, number])[1];
    if (i === j) return rows(a, b);
    if (fits(a, b)) return [a, b];
    if (maxRows < 2) return null;
    let best: number[] | null = null;
    let lowest = Number.POSITIVE_INFINITY;
    for (let k = i; k < j; k++) {
      const c = (units[k] as [number, number])[1];
      const cost = Math.abs(width(a, c) - width(c, b));
      if (fits(a, c) && fits(c, b) && cost < lowest) {
        lowest = cost;
        best = [a, c, b];
      }
    }
    return best;
  };
  const pages: number[][] = [];
  for (let i = 0; i < units.length; ) {
    let j = i;
    while (j + 1 < units.length && page(i, j + 1)) j++;
    pages.push(page(i, j) as number[]);
    i = j + 1;
  }
  return pages.map((bounds) => ({
    rows: bounds
      .slice(1)
      .map((end, r): [number, number] => [startOf(bounds[r] as number), endOf(end)]),
  }));
}

/**
 * Lays every caption line out as pages, timed in output frames. A line stays up `hold` after it
 * ends, unless the next line starts sooner, so one caption shows at a time. Something on screen
 * from tick `s` to `e` is in frame n when s <= n × frameTicks < e, so it shows from frame
 * ceil(s / frameTicks) up to ceil(e / frameTicks); a page or word that spans no frame start is
 * never seen.
 */
export function layoutCaptions(
  captions: Captions,
  measure: Metrics,
  { maxWidth, maxRows, tracking, frameTicks, hold, tail, frames }: LayoutOptions,
): Page[] {
  const frame = (ticks: number) => Math.min(Math.ceil(ticks / frameTicks), frames);
  const pages: Page[] = [];
  for (const [index, line] of captions.lines.entries()) {
    const path = `/captions/lines/${index}`;
    const chars = characters(line, path, measure, tracking);
    if (chars.length === 0) continue;
    const next = captions.lines[index + 1];
    const lineEnd = Math.min(line.end + hold, next ? next.start : Number.POSITIVE_INFINITY);
    const words = line.words ?? [];
    const laid = breakLine(chars, maxWidth, maxRows);
    const total = chars.reduce((sum, char) => sum + char.width, 0);
    let before = 0;
    const starts = laid.map(({ rows }, i) => {
      const first = rows[0]?.[0] ?? 0;
      const spoken = chars.slice(first, rows.at(-1)?.[1]).find((char) => char.word !== null);
      // A page starts with its first word; one without words, at its share of the line's text.
      const start =
        i === 0
          ? line.start
          : spoken
            ? (words[spoken.word as number] as { start: number }).start
            : line.start + ((lineEnd - line.start) * before) / total;
      for (const [s, e] of rows) before += chars.slice(s, e).reduce((sum, c) => sum + c.width, 0);
      return start;
    });
    for (const [i, { rows }] of laid.entries()) {
      const start = frame(starts[i] as number);
      const end = frame(i + 1 < laid.length ? (starts[i + 1] as number) : lineEnd);
      if (end <= start) continue;
      const local = new Map<number, number>();
      const laidRows = rows.map(([s, e]): Row => {
        const segments: Segment[] = [];
        let x = 0;
        for (const char of chars.slice(s, e)) {
          let word: number | null = null;
          if (char.word !== null) {
            if (!local.has(char.word)) local.set(char.word, local.size);
            word = local.get(char.word) as number;
          }
          const last = segments.at(-1);
          if (last && last.word === word) {
            last.text += char.text;
            last.width += char.width;
          } else {
            segments.push({ text: char.text, word, x, width: char.width });
          }
          x += char.width;
        }
        return { segments, width: x };
      });
      const within = (ticks: number) => Math.min(Math.max(frame(ticks), start), end);
      const indices = [...local.keys()];
      pages.push({
        line: index,
        start,
        end,
        rows: laidRows,
        words: indices.map((w, k) => {
          const word = words[w] as { start: number; end: number };
          const following = words[indices[k + 1] ?? w + 1];
          const until = following ? following.start : word.end + tail;
          return { start: within(word.start), end: within(until), said: within(word.end) };
        }),
      });
    }
  }
  return pages;
}

/** A row's text as shown and as the SubRip export writes it. */
export function rowText(row: Row): string {
  return row.segments.map((segment) => segment.text).join("");
}
