// Pages as an ASS script for libass. Each row is drawn as a stack of layers that share its text,
// so the glyphs line up exactly:
//
//   0 plate   a rounded box behind the rows
//   1 shadow  a soft drop shadow
//   2 glow    a blurred halo around the text
//   3 pill    a rounded box behind the word being spoken
//   4 face    the crisp text, with its stroke
//
// Shadow and glow are blurred glyph borders. The plate and the pill are drawn from the measured
// layout instead of from thick glyph borders: a border follows each glyph, so a plate would dip
// around 一 and a pill would change shape from word to word.
// Every row is its own event, placed by its centre, so the rows' spacing is the preset's.

import { family, type Metrics } from "./fonts.ts";
import type { Page, Row } from "./layout.ts";
import { EASE_OUT, ENTER, EXIT, LEADING, type Preset, WORD } from "./presets.ts";

/** Where a page's rows go, in output pixels. */
export interface Geometry {
  width: number;
  height: number;
  /** Pixels per em. */
  em: number;
  /** Ticks per output frame. */
  frameTicks: number;
}

type State = "spoken" | "active" | "upcoming";

const PLATE = 0;
const SHADOW = 1;
const GLOW = 2;
const PILL = 3;
const FACE = 4;

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
  metrics: Metrics,
  geometry: Geometry,
): string {
  const { width, height, em, frameTicks } = geometry;
  const size = round(em * metrics.lineHeight);
  const frameMs = ms(1, frameTicks);
  const events: string[] = [];
  const event = (layer: number, start: number, end: number, text: string) =>
    events.push(
      `Dialogue: ${layer},${assTime(start, frameTicks)},${assTime(end, frameTicks)},Caption,,0,0,0,,${text}`,
    );

  for (const [p, page] of pages.entries()) {
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
      return { row, top, left: width / 2 - (row.width * em) / 2 };
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
      // One drawing for every row, so where the rows' plates overlap they fill once.
      const shapes = page.rows.map((_, r) => {
        const { row, top, left } = geometryOf(r);
        return roundedRect(
          left - padX * em,
          top - padY * em,
          left + (row.width - preset.tracking + padX) * em,
          top + em + padY * em,
          radius * em,
        );
      });
      const tags = `\\an7\\pos(0,0)\\bord0\\shad0\\1c${colour(color)}\\1a${alpha(opacity)}`;
      event(
        PLATE,
        page.start,
        page.end,
        `{${tags}${motion(page.start, false)}\\p1}${shapes.join(" ")}`,
      );
    }

    // The frames at which the word being spoken changes; karaoke sweeps on its own instead.
    const changes = new Set([page.start, page.end]);
    if (!preset.sweep) for (const word of page.words) changes.add(word.start).add(word.end);
    const times = [...changes].sort((a, b) => a - b);
    for (let i = 0; i + 1 < times.length; i++) {
      const from = times[i] as number;
      const to = times[i + 1] as number;
      const lit = page.words.findIndex((word) => word.start <= from && from < word.end);
      const active = preset.sweep ? -1 : lit;
      const states = pageStates(page, from, active);
      for (const [r, row] of page.rows.entries()) {
        const { top, left } = geometryOf(r);
        const lineTop = top - (metrics.ascent - metrics.emTop) * em;
        const centre = lineTop + ((metrics.ascent + metrics.descent) * em) / 2;
        const anchor = `\\an5\\pos(${round(width / 2)},${round(centre)})\\fsp${round(preset.tracking * em)}`;
        const rowStates = states[r] as State[];
        const visibility = (state: State) => (state === "upcoming" ? preset.upcoming : 1);
        const onPill = (state: State) => preset.pill !== undefined && state === "active";
        const layer = (index: number, tags: (state: State) => string) => {
          const text = row.segments.map(
            (segment, s) => `{${tags(rowStates[s] as State)}}${segment.text}`,
          );
          event(index, from, to, `{${anchor}${motion(from, true)}}${text.join("")}`);
        };
        if (preset.shadow) {
          const { color, opacity, offset, blur, spread } = preset.shadow;
          const border = round(((preset.stroke?.width ?? 0) + spread) * em);
          layer(SHADOW, (state) => {
            const seen = onPill(state) ? 0 : opacity * visibility(state);
            return `\\1a&HFF&\\3a&HFF&\\4a${alpha(seen)}\\4c${colour(color)}\\bord${border}\\xshad0\\yshad${round(offset * em)}\\blur${round(blur * em)}`;
          });
        }
        if (preset.glow) {
          const { color, opacity, width: spread, blur } = preset.glow;
          layer(GLOW, (state) => {
            const seen = onPill(state) ? 0 : opacity * visibility(state);
            return `\\1a&HFF&\\3a${alpha(seen)}\\3c${colour(color)}\\bord${round(spread * em)}\\shad0\\blur${round(blur * em)}`;
          });
        }
        const stroke = (state: State) =>
          preset.stroke && !onPill(state)
            ? `\\bord${round(preset.stroke.width * em)}\\3c${colour(preset.stroke.color)}`
            : "\\bord0";
        if (preset.sweep) {
          const face = karaoke(page, row, preset, frameTicks);
          event(
            FACE,
            from,
            to,
            `{${anchor}${motion(from, true)}${stroke("spoken")}\\shad0}${face}`,
          );
        } else {
          layer(FACE, (state) => {
            const fill = state === "active" ? preset.active : preset.text;
            return `\\1c${colour(fill)}\\alpha${alpha(visibility(state))}${stroke(state)}\\shad0`;
          });
        }
        const word = row.segments.find((segment) => active >= 0 && segment.word === active);
        if (preset.pill && word) {
          const { padX, padY, radius, color } = preset.pill;
          const w = (word.width - preset.tracking + 2 * padX) * em;
          const h = (1 + 2 * padY) * em;
          const x = left + (word.x - padX) * em + w / 2;
          const y = top + em / 2;
          // The pill lands on the word and swells to size, starting a frame early so the word's
          // first frame already shows it almost whole. libass centres a drawing by the box from
          // (0, 0) to its far corner, so the shape starts at the origin.
          const swell = `\\fscx85\\fscy85\\t(${round(-frameMs)},${round(WORD - frameMs)},${EASE_OUT},\\fscx100\\fscy100)`;
          const tags = `\\an5\\pos(${round(x)},${round(y)})${swell}\\bord0\\shad0\\1c${colour(color)}${motion(from, false)}`;
          const shape = roundedRect(0, 0, w, h, radius * em);
          event(PILL, from, to, `{${tags}\\p1}${shape}`);
        }
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
    `Style: Caption,${family(preset.weight)},${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,5,0,0,0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events,
    "",
  ].join("\n");
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

/**
 * A row's text for karaoke: each word's colour sweeps from the text colour to the active one
 * (\kf) while it is said, from its start until its sound ends, and holds through the pause
 * before the next. Times count in centiseconds from the page's first event. Text before a row's
 * first word sweeps with that word; text after a word, with it. A row with no timed words stays
 * in the text colour.
 */
function karaoke(page: Page, row: Row, preset: Preset, frameTicks: number): string {
  const all = row.segments.map((segment) => segment.text).join("");
  if (row.segments.every((segment) => segment.word === null)) {
    return `{\\1c${colour(preset.text)}}${all}`;
  }
  const cs = (frame: number) =>
    Math.round((ms(frame, frameTicks) - clock(page.start, frameTicks)) / 10);
  let text = `{\\1c${colour(preset.active)}\\2c${colour(preset.text)}}`;
  let at = 0;
  let pending = "";
  let started = false;
  for (const segment of row.segments) {
    if (segment.word === null) {
      if (started) text += segment.text;
      else pending += segment.text;
      continue;
    }
    const word = page.words[segment.word] as Page["words"][number];
    const start = cs(word.start);
    if (start > at) text += `{\\k${start - at}}`;
    at = Math.max(at, start);
    const sweep = Math.max(1, cs(word.said) - at);
    text += `{\\kf${sweep}}${pending}${segment.text}`;
    pending = "";
    started = true;
    at += sweep;
  }
  return text;
}
