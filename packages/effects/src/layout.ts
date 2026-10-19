// The design tokens every template shares: colour, type scale, safe areas and motion. One place,
// so the templates read as one family and later presets have a single set of values to vary.

import type { Project } from "@video-editor/schema";

export type Aspect = Project["output"]["aspect"];

export const COLORS = {
  /** Plates and the wipe: a near-black with a trace of blue, so it sits with footage instead of
   * punching a hole in it. */
  ink: "#101114",
  paper: "#ffffff",
  /** The one accent: a warm amber that holds against skin, screens and sky alike, and carries
   * ink text at 12:1. */
  accent: "#ffc233",
} as const;

/** `#rrggbb` and an alpha as a CSS colour. */
export function rgba(hex: string, alpha: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Where overlays may draw, as fractions of the frame from each edge. The bottom margin keeps
 * overlays above a full caption at its resting place, since captions draw on top of everything.
 * 9:16 also clears what short-form apps lay over the video: the header at the top, the buttons
 * down the right, and the description and progress bar at the bottom.
 */
const SAFE: Record<Aspect, { left: number; right: number; top: number; bottom: number }> = {
  "16:9": { left: 0.06, right: 0.06, top: 0.08, bottom: 0.24 },
  "1:1": { left: 0.07, right: 0.07, top: 0.07, bottom: 0.3 },
  "9:16": { left: 0.07, right: 0.15, top: 0.11, bottom: 0.4 },
};

/** Type grows with the aspect's viewing distance: a 9:16 video fills a phone held in the hand,
 * where short-form type runs larger than a landscape video's. */
const TYPE_SCALE: Record<Aspect, number> = { "16:9": 1, "1:1": 1.05, "9:16": 1.15 };

/** One step of the type scale, in units of 1 % of the frame's short side: each step is 1.25
 * times the one below, so every size reads as a different level, and two texts of one level
 * are never drawn a few percent apart. */
const step = (n: number) => 3.2 * 1.25 ** n;

/** Type sizes by role, before the aspect's scale: a template's small print, its body, the heading
 * on a plate, a keyword and a title. */
export const TYPE = {
  title: step(5),
  keyword: step(4),
  name: step(2),
  chapter: step(2),
  subtitle: step(1),
  role: step(0),
  count: step(0),
  label: step(0),
} as const;

/**
 * One motion language for every template: the accent element draws first, the content reveals
 * from behind its edge, and everything leaves faster than it came. Seconds, and cubic-bezier
 * control points.
 */
export const MOTION = {
  draw: 0.32,
  reveal: 0.48,
  stagger: 0.08,
  exit: 0.28,
  /** Arrivals: a fast start that settles, never a bounce. */
  enter: [0.16, 1, 0.3, 1],
  /** Departures: they gather speed and are gone. */
  leave: [0.7, 0, 0.84, 0],
  /** Things that cross the whole frame, like the wipe. */
  sweep: [0.65, 0, 0.35, 1],
} as const;

export interface Layout {
  aspect: Aspect;
  width: number;
  height: number;
  /** 1 % of the short side, in pixels: the unit every size is given in. */
  u: number;
  /** A type size from TYPE, in pixels, scaled for the aspect. */
  type: (role: keyof typeof TYPE) => number;
  /** The safe area's margins from each edge, in pixels. */
  safe: { left: number; right: number; top: number; bottom: number };
  /** The safe area's width, in pixels. */
  safeWidth: number;
}

export function layoutFor(aspect: Aspect, width: number, height: number): Layout {
  const u = Math.min(width, height) / 100;
  const margins = SAFE[aspect];
  const safe = {
    left: margins.left * width,
    right: margins.right * width,
    top: margins.top * height,
    bottom: margins.bottom * height,
  };
  return {
    aspect,
    width,
    height,
    u,
    type: (role) => TYPE[role] * u * TYPE_SCALE[aspect],
    safe,
    safeWidth: width - safe.left - safe.right,
  };
}

/** Roughly how many ems a line of text takes in Noto Sans TC: a CJK character or full-width
 * punctuation (everything from the CJK radicals at U+2E80 up) is one em, Latin letters and
 * digits a little over half. */
export function ems(text: string): number {
  let total = 0;
  for (const char of text) {
    if ((char.codePointAt(0) ?? 0) >= 0x2e80) total += 1;
    else if (char === " ") total += 0.26;
    else if (/[A-Z0-9]/.test(char)) total += 0.64;
    else total += 0.54;
  }
  return total;
}

/**
 * The type size, at most `max`, at which `text`, broken only between `runs` (words, and CJK after
 * punctuation) the way a browser wraps it, fits `width` by `height` pixels. Each run is set in
 * heavy type a little wider than `ems` counts.
 */
export function fitRuns(
  runs: readonly string[],
  max: number,
  width: number,
  height: number,
  lineHeight: number,
): number {
  const heavy = 1.08;
  const space = ems(" ");
  const widths = runs.filter((run) => run !== "").map((run) => ems(run) * heavy);
  const lines = (size: number) => {
    let count = 1;
    let used = 0;
    for (const w of widths) {
      const next = used === 0 ? w * size : used + (space + w) * size;
      if (next > width && used > 0) {
        count += 1;
        used = w * size;
      } else used = next;
    }
    return count;
  };
  let size = Math.min(max, (width * 0.98) / Math.max(...widths, 1));
  while (size > 6 && lines(size) * lineHeight * size > height) size *= 0.95;
  return size;
}

/** A piece of a set line: plain text (`mark` -1), or the `mark`th of the phrases asked for, of
 * which it takes the `sweep` share of the highlighter's sweep: all of it, or for a phrase broken
 * across lines, its part in reading order. */
export interface Segment {
  text: string;
  mark: number;
  sweep: [number, number];
}

/** Where each phrase is marked in `text`: at its first place, unless an earlier one is there. */
function marksIn(text: string, phrases: readonly string[]) {
  const found = phrases
    .map((phrase, k) => ({
      at: text.indexOf(phrase),
      end: text.indexOf(phrase) + phrase.length,
      k,
    }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at);
  const marks: typeof found = [];
  for (const m of found) if (m.at >= (marks.at(-1)?.end ?? 0)) marks.push(m);
  return marks;
}

const CJK = (char: string) => (char.codePointAt(0) ?? 0) >= 0x2e80;

/** The advance of each printable ASCII character, from the space to the tilde, in Noto Sans TC
 * Black (2.004), in hundredths of an em rounded up. */
const BLACK_ASCII = (
  "23 40 64 61 61 99 78 36 40 40 53 61 36 39 36 39 61 61 61 61 61 61 61 61 61 61 36 36 61 61 61 " +
  "54 105 66 70 67 73 63 61 74 78 35 59 71 60 88 77 79 69 79 71 64 64 77 65 94 66 61 62 40 39 " +
  "40 61 58 64 61 66 54 66 60 40 62 66 33 33 64 34 99 66 64 66 66 47 51 45 66 61 90 60 61 54 40 " +
  "32 40 61"
)
  .split(" ")
  .map((n) => Number(n) / 100);

/** How many ems `text` takes in the cards' heavy type (weight 900): a CJK character one em, as
 * `ems` counts it, ASCII at the face's own advances, and other Latin a little wider than `ems`
 * counts. */
export function heavyEms(text: string): number {
  let total = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    total += CJK(char) ? 1 : (BLACK_ASCII[code - 32] ?? ems(char) * 1.08);
  }
  return total;
}

/** A clause ends after these, so a line may too. */
const PAUSE = /[，。、！？；：」』）》】]/;
/** Never at the start of a line. */
const CLOSING = /[，。、！？；：」』）》】,.!?;:)\]…]/;
/** Never at the end of a line. */
const OPENING = /[「『（《【([]/;

/** An unbreakable piece of a statement from `from`, with the space after it and the break that
 * follows, which with `split` falls inside a marked phrase. */
interface Atom {
  from: number;
  ems: number;
  space: number;
  after: "clause" | "space" | "word" | "end";
  split: boolean;
}

/**
 * `text` cut where a line may break: "clause" breaks after CJK punctuation and at spaces between
 * Latin words, where a reader pauses anyway, "space" breaks at a space between CJK and Latin, and
 * "word" breaks between two CJK words, as Intl.Segmenter finds them. Nothing breaks before
 * closing punctuation, after opening punctuation, or between Latin words in a marked phrase.
 */
function atoms(text: string, marks: ReturnType<typeof marksIn>): Atom[] {
  const inside = (i: number) => marks.some((m) => m.at < i && i < m.end);
  const words = new Set(
    [...new Intl.Segmenter("zh-Hant", { granularity: "word" }).segment(text)].map((s) => s.index),
  );
  const cuts: { at: number; kind: Atom["after"]; split: boolean }[] = [];
  for (let i = 1; i < text.length; i++) {
    const before = text[i - 1] as string;
    const char = text[i] as string;
    const split = inside(i);
    if (char === " " || CLOSING.test(char) || OPENING.test(before)) continue;
    if (before === " ") {
      const latin = !CJK(text[i - 2] ?? "") && !CJK(char);
      // Two Latin words in a marked phrase name one thing there.
      if (!(latin && split)) cuts.push({ at: i, kind: latin ? "clause" : "space", split });
    } else if (PAUSE.test(before)) cuts.push({ at: i, kind: "clause", split });
    else if (words.has(i) || marks.some((m) => m.at === i || m.end === i)) {
      if (CJK(before) || CJK(char)) cuts.push({ at: i, kind: "word", split });
    }
  }
  return [...cuts, { at: text.length, kind: "end" as const, split: false }].map((cut, k) => {
    const from = cuts[k - 1]?.at ?? 0;
    const piece = text.slice(from, cut.at);
    const word = piece.trimEnd();
    return {
      from,
      ems: heavyEms(word),
      space: heavyEms(piece.slice(word.length)),
      after: cut.kind,
      split: cut.split,
    };
  });
}

/**
 * The split of `list` into `count` lines, breaking only where `allowed` and at every end in
 * `keep`, whose widest line is narrowest. A line that ends between two CJK words or inside a
 * marked phrase counts as a fifth wider, so a break at punctuation or a space wins a near tie. With `least`, no line is narrower
 * than that share of the widest. Returns where each line ends, or nothing when no split fits.
 */
function balance(
  list: Atom[],
  count: number,
  allowed: (a: Atom) => boolean,
  least = 0,
  keep: readonly number[] = [],
) {
  const n = list.length;
  const width = (from: number, to: number) => {
    let w = 0;
    for (let i = from; i < to; i++)
      w += (list[i] as Atom).ems + (i < to - 1 ? (list[i] as Atom).space : 0);
    return w;
  };
  let floor = 0;
  for (let round = 0; round < 8; round++) {
    // best[j][i]: the narrowest widest line, setting the first i atoms in j lines.
    const best = Array.from({ length: count + 1 }, () => new Array<number>(n + 1).fill(Infinity));
    const from = Array.from({ length: count + 1 }, () => new Array<number>(n + 1).fill(-1));
    (best[0] as number[])[0] = 0;
    for (let j = 1; j <= count; j++) {
      for (let i = j; i <= n; i++) {
        if (i < n && !allowed(list[i - 1] as Atom)) continue;
        for (let s = j - 1; s < i; s++) {
          const prior = (best[j - 1] as number[])[s] as number;
          if (prior === Infinity) continue;
          const w = width(s, i);
          if (w < floor || keep.some((end) => s < end && end < i)) continue;
          const end = list[i - 1] as Atom;
          const weak = i < n && (end.after === "word" || end.split);
          const cost = Math.max(prior, weak ? w * 1.2 : w);
          if (cost < ((best[j] as number[])[i] as number)) {
            (best[j] as number[])[i] = cost;
            (from[j] as number[])[i] = s;
          }
        }
      }
    }
    if ((best[count] as number[])[n] === Infinity) return undefined;
    const ends: number[] = [];
    for (let j = count, i = n; j > 0; i = (from[j] as number[])[i] as number, j--) ends.unshift(i);
    const widths = ends.map((end, j) => width(ends[j - 1] ?? 0, end));
    const widest = Math.max(...widths);
    if (Math.min(...widths) >= least * widest - 1e-9) return { ends, widest };
    floor = least * widest;
  }
  return undefined;
}

/** The line height a statement is set at. */
export const STATEMENT_LEADING = 1.32;

/**
 * A card's statement set in explicit lines, with its `phrases` marked: the lines and the type
 * size, at most the card's display size, for its content box's width and `height` of it. It breaks
 * at punctuation and between Latin words first, in the fewest lines within a tenth of the largest
 * size that allows. When that size is under 80 % of the display size, as for a long clause with
 * no punctuation or two long clauses, it also breaks those lines between words, into the fewest
 * balanced lines, at most four, that reach it, none shorter than 40 % of the widest, so every
 * statement short enough fills the card with the same weight. It breaks a marked phrase only when
 * nothing else reaches that size. Widths are counted in `heavyEms`.
 */
export function setStatement(
  text: string,
  phrases: readonly string[],
  layout: CardLayout,
  height = layout.box.height,
): { size: number; lines: Segment[][] } {
  const max = layout.type("display");
  const floor = 0.8 * max;
  const width = layout.box.width * 0.96;
  const lineHeight = STATEMENT_LEADING;
  const marks = marksIn(text, phrases);
  const list = atoms(text, marks);
  const layouts = (allowed: (a: Atom) => boolean, least: number, keep: number[] = [], most = 8) =>
    Array.from({ length: Math.min(most, list.length) }, (_, k) => {
      const split = balance(list, k + 1, allowed, k === 0 ? 0 : least, keep);
      if (!split) return undefined;
      const size = Math.min(max, (width * 0.98) / split.widest, height / ((k + 1) * lineHeight));
      return { ends: split.ends, size };
    }).filter((layout) => layout !== undefined);
  const clauses = layouts((a) => a.after === "clause" && !a.split, 0);
  // The fewest lines within a tenth of the largest size: more lines must buy a larger size.
  const largest = Math.max(...clauses.map((layout) => layout.size));
  let pick = clauses.find((layout) => layout.size >= 0.9 * largest) as (typeof clauses)[number];
  if (pick.size < floor) {
    // Between words too, but only within the lines it broke into at punctuation.
    const words = layouts((a) => a.after !== "end" && !a.split, 0.4, pick.ends, 4);
    const across = layouts((a) => a.after !== "end", 0.4, pick.ends, 4);
    const reach = (layout: (typeof words)[number]) => layout.size >= floor;
    pick =
      words.find(reach) ??
      across.find(reach) ??
      words.reduce((a, b) => (b.size > a.size ? b : a), pick);
  }
  // Each line's text, without the space it broke at, in plain runs and marked phrases.
  const lines = pick.ends.map((end, j) => {
    const from = (list[pick.ends[j - 1] ?? 0] as Atom).from;
    const to = from + text.slice(from, list[end]?.from ?? text.length).trimEnd().length;
    const edges = [from, to];
    for (const m of marks)
      edges.push(Math.max(from, Math.min(to, m.at)), Math.max(from, Math.min(to, m.end)));
    const cuts = [...new Set(edges)].sort((x, y) => x - y);
    return cuts.slice(1).map((end, k): Segment => {
      const start = cuts[k] as number;
      const mark = marks.find((m) => m.at <= start && start < m.end)?.k ?? -1;
      return { text: text.slice(start, end), mark, sweep: [0, 1] };
    });
  });
  // A phrase's pieces share its sweep by their widths, in reading order.
  for (const { k } of marks) {
    const pieces = lines.flat().filter((segment) => segment.mark === k);
    const total = pieces.reduce((sum, piece) => sum + heavyEms(piece.text), 0);
    let done = 0;
    for (const piece of pieces) {
      const from = done;
      done += heavyEms(piece.text);
      piece.sweep = [from / total, pieces.at(-1) === piece ? 1 : done / total];
    }
  }
  return { size: pick.size, lines };
}

/** The type size, at most `size`, at which `text` fits on one line `available` pixels wide. */
export function fit(text: string, size: number, available: number): number {
  const width = ems(text) * size;
  return width <= available ? size : Math.floor((available / ems(text)) * 100) / 100;
}

/** Where a card fills: the whole frame, or the upper panel of a split screen with the speaker
 * below it. */
export type Placement = "full" | "panel";

/** The upper panel of a split screen, as a share of the frame's height: at 9:16 the top 880 of
 * every 1920 rows, the split short-form edits use, and the upper half otherwise. */
export function panelShare(aspect: Aspect): number {
  return aspect === "9:16" ? 880 / 1920 : 0.5;
}

/** A card's size in pixels in an output of `width` by `height`: the frame, or the panel in even
 * rows. */
export function cardSize(
  aspect: Aspect,
  placement: Placement,
  width: number,
  height: number,
): [number, number] {
  if (placement === "full") return [width, height];
  return [width, Math.round((panelShare(aspect) * height) / 2) * 2];
}

/** The colours cards add to the overlays' ink, paper and accent: one for what works or is
 * gained, one for what fails or is lost. */
export const CARD_COLORS = {
  good: "#4ade80",
  bad: "#ff5f57",
} as const;

/** Card type sizes, in units of the card layout's `u`, on a scale of 1.25 like the
 * overlays' from 4 units: small print, body text, a list item, a card's heading, a section's
 * name and a hero number, at 4, 5, 6.25, 9.8, 15.3 and 23.8 units. */
const cardStep = (n: number) => 4 * 1.25 ** n;
const CARD_TYPE = {
  hero: cardStep(8),
  display: cardStep(6),
  heading: cardStep(4),
  item: cardStep(2),
  body: cardStep(1),
  small: cardStep(0),
} as const;

export interface CardLayout {
  aspect: Aspect;
  placement: Placement;
  width: number;
  height: number;
  /** The content box, in pixels: inside the frame's safe area for a full card, and clear of the
   * app header and of the captions on the seam for a panel. */
  box: { left: number; top: number; width: number; height: number };
  /** The unit every card size is given in, in pixels: 1 % of the content box's short side, or up
   * to 1.3 % of it in a long box. */
  u: number;
  /** The content box's width over its height: cards lay out in a row above about 1.5. */
  ratio: number;
  /** A size from CARD_TYPE, in pixels. */
  type: (role: keyof typeof CARD_TYPE) => number;
}

/**
 * The content box of a card `width` by `height` pixels in an output of `aspect`. A full card keeps
 * to the overlays' safe area. A panel spans the frame's width, so at 9:16 its top clears the
 * app header, measured on the frame's height, and its bottom leaves the seam to the captions.
 */
export function cardLayout(
  aspect: Aspect,
  placement: Placement,
  width: number,
  height: number,
): CardLayout {
  let margins: { left: number; right: number; top: number; bottom: number };
  if (placement === "full") {
    const safe = SAFE[aspect];
    margins = {
      left: safe.left * width,
      right: safe.right * width,
      top: safe.top * height,
      bottom: safe.bottom * height,
    };
  } else {
    const side = 0.06 * width;
    const top = aspect === "9:16" ? SAFE["9:16"].top * ((width * 16) / 9) : 0.08 * height;
    margins = { left: side, right: side, top, bottom: 0.12 * height };
  }
  const box = {
    left: margins.left,
    top: margins.top,
    width: width - margins.left - margins.right,
    height: height - margins.top - margins.bottom,
  };
  // A long box has room for larger type than its short side alone allows: the unit grows with
  // the box's area, up to 1.3 times the short side's.
  const short = Math.min(box.width, box.height) / 100;
  const u = Math.min(short * 1.3, Math.sqrt(box.width * box.height) / 100);
  return {
    aspect,
    placement,
    width,
    height,
    box,
    u,
    ratio: box.width / box.height,
    type: (role) => CARD_TYPE[role] * u,
  };
}
