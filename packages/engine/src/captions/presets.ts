// The caption styles project.json selects by `captions.preset`, the presets that draw them, and
// the type scale and safe areas they share. Lengths are in ems of the caption face, so a preset
// looks the same at every output size; the aspect sets the em.

import { type BrandColors, brandTones, readable } from "@video-editor/effects/colour";
import { COLORS } from "@video-editor/effects/layout";
import type { BrandCaptions, Captions, Project } from "@video-editor/schema";
import type { Weight } from "./fonts.ts";

type Aspect = Project["output"]["aspect"];

export interface TypeScale {
  /** The caption em as a fraction of the frame's shorter side. */
  em: number;
  /** The most CJK characters in a row at scale 1, which sets the longest row. */
  chars: number;
  /** The most rows a caption holds. */
  rows: number;
  /** Where the bottom of the last row's em box sits, as a fraction of the frame's height. */
  bottom: number;
  /** The band captions may move within to keep clear of a face, top and bottom, as fractions of
   * the frame's height. */
  band: [number, number];
}

/**
 * Per aspect. 9:16 keeps the rows inside 70 % of the width and above 78 % of the height, clear of
 * the like and share buttons down the right edge and the description over the bottom fifth that
 * Shorts, Reels and TikTok draw. 16:9 sits where subtitles do, inside the title-safe area and
 * above a player's controls, in one row of the 16 characters Traditional Chinese subtitling uses.
 */
export const TYPE_SCALE: Record<Aspect, TypeScale> = {
  "9:16": { em: 0.07, chars: 10, rows: 2, bottom: 0.72, band: [0.14, 0.78] },
  "1:1": { em: 0.06, chars: 12, rows: 2, bottom: 0.86, band: [0.08, 0.92] },
  "16:9": { em: 0.058, chars: 16, rows: 1, bottom: 0.9, band: [0.08, 0.92] },
};

/** From the top of one row's em box to the next one's: tighter than body text, so two rows read
 * as one caption. */
export const LEADING = 1.3;

/** Motion shared by every preset, in milliseconds. A caption after a pause arrives with an
 * ease-out over ENTER, and a caption followed by a pause leaves over EXIT, faster than it came.
 * A word of the pop style settles to its size over POP. */
export const ENTER = 160;
export const EXIT = 100;
export const POP = 140;
/** A caption stays up this long after its last word, unless the next one starts first, so the
 * end of a sentence can still be read; its last word stays lit TAIL after its sound ends. */
export const HOLD = 500;
export const TAIL = 150;
/** libass's \t acceleration: below 1 starts fast and settles, an ease-out. */
export const EASE_OUT = 0.5;

/** The effect templates' palette, so captions and overlays read as one family: two neutrals
 * and one accent. */
const { paper: WHITE, ink: INK, accent: ACCENT } = COLORS;

/** A caption style: the id `captions.preset` holds. */
export type CaptionStyle = Captions["preset"];

export interface Preset {
  weight: Weight;
  /** Size against the aspect's em; the longest row shrinks or grows to match. */
  scale: number;
  /** Letter spacing after every character. Never 0: libass turns ligatures off only when the
   * spacing is not 0, which keeps every row the width it was measured at. */
  tracking: number;
  text: string;
  /** The word being spoken. */
  active: string;
  /** Opacity of words not spoken yet. */
  upcoming: number;
  stroke?: { width: number; color: string };
  /** A soft drop shadow under the text. */
  shadow?: { color: string; opacity: number; offset: number; blur: number; spread: number };
  /** A rounded box behind the caption's one row. */
  plate?: { color: string; opacity: number; padX: number; padY: number; radius: number };
  /** The colour of numbers, and of English words in a Chinese line. */
  keyword?: string;
  /** A caption is one row of at most `chars` Chinese characters' width and `words` English
   * words, instead of the aspect's rows. */
  chunk?: { chars: number; words: number };
  /** How a caption arrives: settling from slightly smaller, or fading in. */
  entrance: { pop: number } | "fade";
  /** Each word appears as it is spoken, shrinking from this scale to its size over POP. */
  wordPop?: number;
}

/** The styles that draw on the picture; `none` draws nothing. */
export type DrawnStyle = Exclude<CaptionStyle, "none">;

const BOLD: Preset = {
  weight: 900,
  scale: 1,
  tracking: 0.02,
  text: WHITE,
  active: ACCENT,
  upcoming: 1,
  stroke: { width: 0.085, color: INK },
  shadow: { color: "#000000", opacity: 0.5, offset: 0.05, blur: 0.12, spread: 0.02 },
  entrance: { pop: 0.9 },
};

export const PRESETS: Record<DrawnStyle, Preset> = {
  /** Word by word: heavy white type with a dark stroke; the word being spoken turns amber. */
  bold: BOLD,
  /** A few words at a time, big, in a dark box; numbers and English words in a Chinese line are
   * amber. Each caption pops in from 80 %. */
  creator: {
    weight: 900,
    scale: 1.4,
    tracking: 0.02,
    text: WHITE,
    active: WHITE,
    upcoming: 1,
    plate: { color: INK, opacity: 0.88, padX: 0.28, padY: 0.16, radius: 0.16 },
    keyword: ACCENT,
    chunk: { chars: 6, words: 3 },
    entrance: { pop: 0.8 },
  },
  /** Small white type with a thin dark stroke and a soft shadow, no highlight. */
  minimal: {
    weight: 700,
    scale: 0.72,
    tracking: 0.02,
    text: WHITE,
    active: WHITE,
    upcoming: 1,
    stroke: { width: 0.06, color: INK },
    shadow: { color: "#000000", opacity: 0.6, offset: 0.04, blur: 0.12, spread: 0.02 },
    entrance: "fade",
  },
  /** As bold, without the highlight: each word pops in from 125 % as it is said. */
  pop: { ...BOLD, scale: 1.05, active: WHITE, upcoming: 0, entrance: "fade", wordPop: 1.25 },
};

/** Every style, in the order a person picks from. */
export const CAPTION_STYLES: readonly CaptionStyle[] = [
  ...(Object.keys(PRESETS) as DrawnStyle[]),
  "none",
];

/** The style an edit starts with unless another is asked for. */
export const DEFAULT_CAPTIONS: CaptionStyle = "bold";

export function isCaptionStyle(id: string): id is CaptionStyle {
  return (CAPTION_STYLES as readonly string[]).includes(id);
}

/** Custom captions' sizes against the style's own. */
export const CAPTION_SIZES: Record<BrandCaptions["size"], number> = { S: 0.8, M: 1, L: 1.25 };

/** The box custom captions draw behind the text, the one the creator style has. */
const BOX = PRESETS.creator.plate as NonNullable<Preset["plate"]>;

/**
 * A style in a brand kit's look. With custom captions, their style with its size, colours, and an
 * outline or a box; the highlight lights what the style lights, the word being spoken or the
 * keywords, and the minimal and pop styles light nothing. Without them, `style` with the kit's
 * primary in place of the amber. Text that would not read on its outline or box is white or
 * black instead.
 */
export function brandPreset(
  style: DrawnStyle,
  colors: BrandColors,
  custom: BrandCaptions | undefined,
): Preset {
  if (!custom) {
    const primary = readable(brandTones(colors).primary, INK);
    const swap = (colour: string | undefined) => (colour === ACCENT ? primary : colour);
    const preset = PRESETS[style];
    return {
      ...preset,
      active: swap(preset.active) as string,
      ...(preset.keyword ? { keyword: swap(preset.keyword) } : {}),
    };
  }
  const base = PRESETS[custom.style];
  const text = readable(custom.text, INK);
  const highlight = readable(custom.highlight, INK);
  const { stroke, shadow, plate, ...rest } = base;
  const outline = {
    stroke: { width: (stroke ?? BOLD.stroke)?.width as number, color: INK },
    shadow: (shadow ?? BOLD.shadow) as NonNullable<Preset["shadow"]>,
  };
  return {
    ...rest,
    ...(custom.frame === "box" ? { plate: BOX } : outline),
    scale: base.scale * CAPTION_SIZES[custom.size],
    text,
    active: base.active === base.text ? text : highlight,
    ...(base.keyword ? { keyword: highlight } : {}),
  } as Preset;
}
