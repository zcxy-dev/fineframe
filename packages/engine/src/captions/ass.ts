// Pages as an ASS script for libass. Each row is drawn as a stack of layers that share its text,
// so the glyphs line up exactly:
//
//   0 plate   a rounded box behind the caption
//   1 shadow  a soft drop shadow, a blurred glyph border
//   2 face    the crisp text, with its stroke
//
// The plate is drawn from the measured layout instead of from a thick glyph border, which would
// follow each glyph and dip around 一.
// Every row is its own event, placed by its centre, so the rows' spacing is the preset's. A preset
// whose words pop in draws each word as its own event instead, placed where the row puts it.

import type { EmojiImage } from "./emoji.ts";
import type { Metrics } from "./fonts.ts";
import type { Page, Row } from "./layout.ts";
import { EASE_OUT, ENTER, EXIT, LEADING, POP, type Preset } from "./presets.ts";

/** Where a page's rows go, in output pixels. */
export interface Geometry {
  width: number;
  height: number;
  /** Pixels per em. */
  em: number;
  /** Ticks per output frame. */
  frameTicks: number;
  /** In a brand kit's look, the widest a row may be, in ems: a page with a row wider, such as a
   * long word in a large size, is set that much smaller, so no caption leaves the frame. */
  fit?: number;
}

/** The face a script is drawn in: the family its style selects it by, with Bold or not, and its
 * metrics, which a page's widths were measured with. A brand kit's face has the house face as
 * `fallback` for each character it lacks, drawn at the same em. */
export interface CaptionFace {
  family: string;
  bold: boolean;
  metrics: Metrics;
  fallback?: { family: string; bold: boolean; metrics: Metrics };
}

type State = "spoken" | "active" | "upcoming";

const PLATE = 0;
const SHADOW = 1;
const FACE = 2;

/** `#rrggbb` as ASS's &HBBGGRR&. */
function colour(hex: string): string {
  return `&H${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}&`.toUpperCase();
}

/** An opacity as ASS's inverted alpha. */
function alpha(opacity: number): string {
  const value = Math.round((1 - Math.min(1, Math.max(0, opacity))) * 255);
  return `&H${value.toString(16).toUpperCase().padStart(2, "0")}&`;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** The time of an output frame in ms. */
function ms(frame: number, frameTicks: number): number {
  return (frame * frameTicks) / 120;
}

/** The centisecond an event that begins on `frame` starts at; see assTime. */
function centiseconds(frame: number, frameTicks: number): number {
  return frame > 0 ? Math.floor((frame * frameTicks - 120) / 1200) : 0;
}

/** When libass starts an event that begins on `frame`, in ms. Animation times are counted on
 * this clock, so an animation that runs across several events continues without a jump. */
function clock(frame: number, frameTicks: number): number {
  return 10 * centiseconds(frame, frameTicks);
}

/**
 * An output frame's start as an ASS time. libass shows an event at frame time t when
 * start <= t < end, and ASS counts centiseconds. FFmpeg works t out in floating point and cuts it
 * to whole milliseconds, so a frame that starts on a whole millisecond can arrive one below it
 * (at 30 fps, frame 111 starts at 3700 ms and arrives as 3699). Rounding down to a centisecond
 * from a millisecond before the frame's start lands at or before it either way, and still after
 * the previous frame while frames are more than 11 ms apart: an event appears and leaves on
 * exactly the frames it was laid out on, at any frame rate up to 90 fps.
 */
export function assTime(frame: number, frameTicks: number): string {
  const cs = centiseconds(frame, frameTicks);
  const h = Math.floor(cs / 360_000);
  const m = Math.floor(cs / 6000) % 60;
  const s = Math.floor(cs / 100) % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

/** A rounded rectangle as ASS drawing commands, corners as cubic Béziers. */
function roundedRect(x0: number, y0: number, x1: number, y1: number, radius: number): string {
  const r = Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2);
  const k = r * 0.4477; // 1 - 0.5523, the circle's control point
  const p = (x: number, y: number) => `${round(x)} ${round(y)}`;
  return [
    `m ${p(x0 + r, y0)}`,
    `l ${p(x1 - r, y0)}`,
    `b ${p(x1 - k, y0)} ${p(x1, y0 + k)} ${p(x1, y0 + r)}`,
    `l ${p(x1, y1 - r)}`,
    `b ${p(x1, y1 - k)} ${p(x1 - k, y1)} ${p(x1 - r, y1)}`,
    `l ${p(x0 + r, y1)}`,
    `b ${p(x0 + k, y1)} ${p(x0, y1 - k)} ${p(x0, y1 - r)}`,
    `l ${p(x0, y0 + r)}`,
    `b ${p(x0, y0 + k)} ${p(x0 + k, y0)} ${p(x0 + r, y0)}`,
  ].join(" ");
}

/** The ASS script for laid-out pages, each with the bottom edge of its last row's em box. */
export function writeAss(
  pages: Page[],
  bottoms: number[],
  preset: Preset,
  face: CaptionFace,
  geometry: Geometry,
): string {
  const { width, height, frameTicks } = geometry;
  const { metrics, fallback } = face;
  const select = (each: { family: string; bold: boolean }, fs: number) =>
    `\\fn${each.family}\\b${each.bold ? 1 : 0}\\fs${fs}`;
  /** Widths as the page was measured: the face's, else its fallback's. */
  const measured: Pick<Metrics, "advance"> = {
    advance: (codePoint) => metrics.advance(codePoint) ?? fallback?.metrics.advance(codePoint),
  };
  const frameMs = ms(1, frameTicks);
  const events: string[] = [];
  const event = (layer: number, start: number, end: number, text: string) =>
    events.push(
      `Dialogue: ${layer},${assTime(start, frameTicks)},${assTime(end, frameTicks)},Caption,,0,0,0,,${text}`,
    );
  /** What drawing at `em` pixels to the em takes: the font size, letter spacing, stroke and
   * shadow, and text with each run of characters the face lacks in its fallback at that em. */
  const at = (em: number) => {
    const size = round(em * metrics.lineHeight);
    const drawn = (text: string): string => {
      if (!fallback) return text;
      const back = `{${select(fallback, round(em * fallback.metrics.lineHeight))}}`;
      const home = `{${select(face, size)}}`;
      let out = "";
      let away = false;
      for (const char of text) {
        const lacks = metrics.advance(char.codePointAt(0) as number) === undefined;
        if (lacks !== away) out += lacks ? back : home;
        away = lacks;
        out += char;
      }
      return away ? out + home : out;
    };
    const stroke = preset.stroke
      ? `\\bord${round(preset.stroke.width * em)}\\3c${colour(preset.stroke.color)}`
      : "\\bord0";
    /** The shadow layer's tags, for text at `opacity`. */
    const shadow = (opacity: number) => {
      if (!preset.shadow) return null;
      const { color, opacity: strength, offset, blur, spread } = preset.shadow;
      const border = round(((preset.stroke?.width ?? 0) + spread) * em);
      return `\\1a&HFF&\\3a&HFF&\\4a${alpha(strength * opacity)}\\4c${colour(color)}\\bord${border}\\xshad0\\yshad${round(offset * em)}\\blur${round(blur * em)}`;
    };
    return { size, drawn, tracking: `\\fsp${round(preset.tracking * em)}`, stroke, shadow };
  };
  const full = at(geometry.em);
  const { size } = full;

  for (const [p, page] of pages.entries()) {
    // A page whose widest row is wider than a kit's captions may be is set smaller to fit; every
    // other page at the style's own size, with no tag for it.
    const widest = Math.max(...page.rows.map((row) => row.width));
    const k = geometry.fit !== undefined && widest > geometry.fit ? geometry.fit / widest : 1;
    const em = geometry.em * k;
    const { drawn, tracking, stroke, shadow } = k === 1 ? full : at(em);
    const fs = k === 1 ? "" : `\\fs${at(em).size}`;
    const bottom = bottoms[p] as number;
    const next = pages[p + 1];
    const previous = pages[p - 1];
    // Fades bracket silence: a caption after a pause fades in and one before a pause fades out,
    // while one that replaces another at once shows at full strength, so the text never dims
    // between two phrases.
    const exits = !next || next.start > page.end;
    const enters = !previous || previous.end < page.start;
    const geometryOf = (r: number) => {
      const row = page.rows[r] as Row;
      const top = bottom - em - (page.rows.length - 1 - r) * LEADING * em;
      const lineTop = top - (metrics.ascent - metrics.emTop) * em;
      const centre = lineTop + ((metrics.ascent + metrics.descent) * em) / 2;
      return { row, top, centre, left: width / 2 - (row.width * em) / 2 };
    };

    /** Entrance and exit, for an event of this page from frame `from`. The entrance starts a
     * frame before the page, so its first frame already shows it; a pop settles every caption
     * in, a fade only one after a pause. \fade times and \t offsets
     * count from the event's own start, so they are worked out on the page's clock and later
     * events continue where earlier ones left off. */
    const motion = (from: number, scaled: boolean) => {
      const start = clock(from, frameTicks);
      const enter = clock(page.start, frameTicks) - frameMs - start;
      const leave = clock(page.end, frameTicks) - start;
      const arriving = enter + ENTER > 0;
      const fadeIn = arriving && enters;
      const tags: string[] = [];
      if (fadeIn || exits) {
        const [t1, t2] = fadeIn ? [round(enter), round(enter + ENTER)] : [0, 0];
        const [t3, t4] = exits ? [round(leave - EXIT), round(leave)] : [round(leave), round(leave)];
        tags.push(`\\fade(255,0,255,${t1},${t2},${t3},${t4})`);
      }
      if (scaled && arriving && typeof preset.entrance === "object") {
        const from = round(preset.entrance.pop * 100);
        tags.push(
          `\\fscx${from}\\fscy${from}\\t(${round(enter)},${round(enter + ENTER)},${EASE_OUT},\\fscx100\\fscy100)`,
        );
      }
      return tags.join("");
    };

    if (preset.plate) {
      const { padX, padY, radius, color, opacity } = preset.plate;
      // One drawing for every row, so where the rows' plates overlap they fill once. libass
      // centres a drawing by the box from (0, 0) to its far corner, so it starts at the origin
      // and is placed by its centre, about which the entrance scales it with the text.
      const boxes = page.rows.map((_, r) => {
        const { row, top, left } = geometryOf(r);
        return [
          left - padX * em,
          top - padY * em,
          left + (row.width - preset.tracking + padX) * em,
          top + em + padY * em,
        ] as const;
      });
      const x0 = Math.min(...boxes.map((box) => box[0]));
      const y0 = Math.min(...boxes.map((box) => box[1]));
      const x1 = Math.max(...boxes.map((box) => box[2]));
      const y1 = Math.max(...boxes.map((box) => box[3]));
      const shapes = boxes.map(([a, b, c, d]) =>
        roundedRect(a - x0, b - y0, c - x0, d - y0, radius * em),
      );
      const tags = `\\an5\\pos(${round((x0 + x1) / 2)},${round((y0 + y1) / 2)})\\bord0\\shad0\\1c${colour(color)}\\1a${alpha(opacity)}`;
      event(
        PLATE,
        page.start,
        page.end,
        `{${tags}${motion(page.start, true)}\\p1}${shapes.join(" ")}`,
      );
    }

    if (preset.wordPop) {
      // Each word from its first frame to the end of the page, shrinking to its size from
      // wordPop, at its place in the row, so the row does not move as it fills.
      const pop = round(preset.wordPop * 100);
      for (const [r] of page.rows.entries()) {
        const { centre, left } = geometryOf(r);
        for (const word of wordsOf(page, r, measured, preset.tracking)) {
          const from =
            word.word === null ? page.start : (page.words[word.word]?.start ?? page.start);
          const x = left + (word.x + word.width / 2) * em;
          const tags = `\\an5\\pos(${round(x)},${round(centre)})${fs}${tracking}${motion(from, false)}\\fscx${pop}\\fscy${pop}\\t(0,${POP},${EASE_OUT},\\fscx100\\fscy100)`;
          const below = shadow(1);
          if (below) event(SHADOW, from, page.end, `{${tags}${below}}${drawn(word.text)}`);
          event(
            FACE,
            from,
            page.end,
            `{${tags}\\1c${colour(preset.text)}${stroke}\\shad0}${drawn(word.text)}`,
          );
        }
      }
      continue;
    }

    // The frames at which the word being spoken changes.
    const changes = new Set([page.start, page.end]);
    for (const word of page.words) changes.add(word.start).add(word.end);
    const times = [...changes].sort((a, b) => a - b);
    for (let i = 0; i + 1 < times.length; i++) {
      const from = times[i] as number;
      const to = times[i + 1] as number;
      const active = page.words.findIndex((word) => word.start <= from && from < word.end);
      const states = pageStates(page, from, active);
      for (const [r, row] of page.rows.entries()) {
        const { centre } = geometryOf(r);
        const anchor = `\\an5\\pos(${round(width / 2)},${round(centre)})${fs}${tracking}`;
        const rowStates = states[r] as State[];
        const visibility = (state: State) => (state === "upcoming" ? preset.upcoming : 1);
        const layer = (index: number, tags: (s: number) => string) => {
          const text = row.segments.map((segment, s) => `{${tags(s)}}${drawn(segment.text)}`);
          event(index, from, to, `{${anchor}${motion(from, true)}}${text.join("")}`);
        };
        if (preset.shadow) {
          layer(SHADOW, (s) => shadow(visibility(rowStates[s] as State)) as string);
        }
        layer(FACE, (s) => {
          const state = rowStates[s] as State;
          const fill =
            preset.keyword && row.segments[s]?.keyword
              ? preset.keyword
              : state === "active"
                ? preset.active
                : preset.text;
          return `\\1c${colour(fill)}\\alpha${alpha(visibility(state))}${stroke}\\shad0`;
        });
      }
    }
  }

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    // Rows are broken by the layout and never again by libass.
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    // Advances as measured; with letter spacing set, libass forms no ligatures either.
    "Kerning: no",
    "YCbCr Matrix: TV.709",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${face.family},${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,${face.bold ? 1 : 0},0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
}

/** An emoji over the picture, in output pixels, from frame `start` until `end`. */
export interface EmojiEvent {
  emoji: string;
  image: EmojiImage;
  start: number;
  end: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Room between a caption's text, or its plate, and its emoji, in ems. */
const EMOJI_GAP = 0.15;

/** Where the pen that draws a line's emoji after `row` starts, right of the frame's centre, in
 * ems. */
export function emojiPen(row: Row, preset: Preset): number {
  return (row.width - preset.tracking) / 2 + (preset.plate?.padX ?? 0) + EMOJI_GAP;
}

/**
 * Where and when each line's emoji is drawn: at the end of the last row of the line's last page,
 * at the page's size, as the face would set it there, from the frame the line's last word is lit
 * until the page leaves. It never leaves the frame.
 */
export function placeEmoji(
  pages: Page[],
  bottoms: number[],
  preset: Preset,
  metrics: Metrics,
  geometry: Geometry,
  emojiOf: (line: number) => { emoji: string; image: EmojiImage } | undefined,
): EmojiEvent[] {
  const { width, height } = geometry;
  return pages.flatMap((page, p): EmojiEvent[] => {
    const chosen = pages[p + 1]?.line === page.line ? undefined : emojiOf(page.line);
    if (!chosen) return [];
    const widest = Math.max(...page.rows.map((row) => row.width));
    const k = geometry.fit !== undefined && widest > geometry.fit ? geometry.fit / widest : 1;
    const em = geometry.em * k;
    const baseline = (bottoms[p] as number) - em + metrics.emTop * em;
    const { image } = chosen;
    const scale = em / image.ppem;
    const w = Math.round(image.width * scale);
    const h = Math.round(image.height * scale);
    const pen = width / 2 + emojiPen(page.rows.at(-1) as Row, preset) * em;
    return [
      {
        ...chosen,
        start: page.words.at(-1)?.start ?? page.start,
        end: page.end,
        x: Math.max(0, Math.min(width - w, Math.round(pen + image.left * scale))),
        y: Math.max(0, Math.min(height - h, Math.round(baseline - image.top * scale))),
        width: w,
        height: h,
      },
    ];
  });
}

/**
 * The words of a page's row `r` as the pop style draws them, each with the punctuation after it
 * (or, at the start, before it), where the row puts it, in ems from the row's left edge. Spaces
 * are left out: libass drops them at either end of an event, and the place keeps their width.
 */
function wordsOf(
  page: Page,
  r: number,
  metrics: Pick<Metrics, "advance">,
  tracking: number,
): { text: string; word: number | null; x: number; width: number }[] {
  const row = page.rows[r] as Row;
  const blank = (char: string) => (metrics.advance(char.codePointAt(0) as number) ?? 0) + tracking;
  const words: { text: string; word: number | null; x: number; width: number }[] = [];
  for (const segment of row.segments) {
    let { text, x, width } = segment;
    for (; /^\s/u.test(text); text = text.slice(1)) {
      x += blank(text[0] as string);
      width -= blank(text[0] as string);
    }
    for (; /\s$/u.test(text); text = text.slice(0, -1)) width -= blank(text.at(-1) as string);
    if (!text) continue;
    const last = words.at(-1);
    const touching = last && Math.abs(last.x + last.width - x) < 1e-9;
    // Punctuation goes with the word before it, as does the rest of a word split into runs.
    if (last && touching && (segment.word === null || segment.word === last.word)) {
      last.text += text;
      last.width += width;
    } else if (last && touching && last.word === null) {
      last.text += text;
      last.width += width;
      last.word = segment.word;
    } else {
      words.push({ text, word: segment.word, x, width });
    }
  }
  return words;
}

/**
 * The state of every segment of a page from frame `from`, while word `active` is lit (-1: none).
 * A word is spoken once it has started. Spaces and punctuation between words go with the word
 * before them, or the one after at the start, and count as spoken once it is: only words take
 * the highlight. A page without timed words shows as spoken throughout.
 */
function pageStates(page: Page, from: number, active: number): State[][] {
  if (page.words.length === 0) return page.rows.map((row) => row.segments.map(() => "spoken"));
  const flat = page.rows.flatMap((row) => row.segments);
  const owners = flat.map((segment, s) => {
    if (segment.word !== null) return segment.word;
    const before = flat.slice(0, s).findLast((other) => other.word !== null);
    return (before ?? flat.slice(s).find((other) => other.word !== null))?.word ?? null;
  });
  let s = 0;
  return page.rows.map((row) =>
    row.segments.map((segment): State => {
      const owner = owners[s++] ?? null;
      if (owner === null || (page.words[owner]?.start ?? from + 1) > from) return "upcoming";
      return owner === active && segment.word !== null ? "active" : "spoken";
    }),
  );
}
