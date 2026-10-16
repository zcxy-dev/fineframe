// The caption presets project.json selects by `captions.preset`, and the type scale and safe
// areas they share. Lengths are in ems of the caption face, so a preset looks the same at every
// output size; the aspect sets the em.

import { COLORS } from "@video-editor/effects";
import type { Project } from "@video-editor/schema";
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
 * ease-out over ENTER, a highlight moves to the next word over WORD, and a caption followed by a
 * pause leaves over EXIT, faster than it came. */
export const ENTER = 160;
export const WORD = 80;
export const EXIT = 100;
/** A caption stays up this long after its last word, unless the next one starts first, so the
 * end of a sentence can still be read; its last word stays lit TAIL after its sound ends. */
export const HOLD = 500;
export const TAIL = 150;
/** libass's \t acceleration: below 1 starts fast and settles, an ease-out. */
export const EASE_OUT = 0.5;

/** The effect templates' palette, so captions and overlays read as one family: two neutrals
 * and one accent. */
const { paper: WHITE, ink: INK, accent: ACCENT } = COLORS;

export interface Preset {
  description: string;
  weight: Weight;
  /** Size against the aspect's em; the longest row shrinks or grows to match. */
  scale: number;
  /** Letter spacing after every character. Never 0: libass turns ligatures off only when the
   * spacing is not 0, which keeps every row the width it was measured at. */
  tracking: number;
  text: string;
  /** The word being spoken; with `sweep`, every word already spoken. */
  active: string;
  /** Opacity of words not spoken yet. */
  upcoming: number;
  stroke?: { width: number; color: string };
  /** A soft drop shadow under the text. */
  shadow?: { color: string; opacity: number; offset: number; blur: number; spread: number };
  /** A blurred halo around the text, without offset. */
  glow?: { color: string; opacity: number; width: number; blur: number };
  /** A rounded plate behind each row. */
  plate?: { color: string; opacity: number; padX: number; padY: number; radius: number };
  /** A rounded pill behind the word being spoken, which is drawn in `active` without a stroke. */
  pill?: { color: string; padX: number; padY: number; radius: number };
  /** The colour sweeps through each word as it is spoken (karaoke), instead of jumping. */
  sweep?: boolean;
  /** How a caption arrives: settling from slightly smaller, or fading in. */
  entrance: { pop: number } | "fade";
}

export const PRESETS: Record<string, Preset> = {
  bold: {
    description: "Heavy white type with a dark stroke; the word being spoken turns amber",
    weight: 900,
    scale: 1,
    tracking: 0.02,
    text: WHITE,
    active: ACCENT,
    upcoming: 1,
    stroke: { width: 0.085, color: INK },
    shadow: { color: "#000000", opacity: 0.5, offset: 0.05, blur: 0.12, spread: 0.02 },
    entrance: { pop: 0.9 },
  },
  spotlight: {
    description: "White type on a soft dark halo; the word being spoken sits on an amber pill",
    weight: 900,
    scale: 0.96,
    tracking: 0.06,
    text: WHITE,
    active: INK,
    upcoming: 1,
    glow: { color: INK, opacity: 0.55, width: 0.06, blur: 0.18 },
    pill: { color: ACCENT, padX: 0.12, padY: 0.1, radius: 0.2 },
    entrance: "fade",
  },
  sweep: {
    description: "Karaoke: amber sweeps through each word as it is spoken",
    weight: 900,
    scale: 1,
    tracking: 0.02,
    text: WHITE,
    active: ACCENT,
    upcoming: 1,
    stroke: { width: 0.085, color: INK },
    shadow: { color: "#000000", opacity: 0.5, offset: 0.05, blur: 0.12, spread: 0.02 },
    sweep: true,
    entrance: "fade",
  },
  boxed: {
    description: "Bold type on a dark rounded plate; words brighten as they are spoken",
    weight: 700,
    scale: 0.9,
    tracking: 0.04,
    text: WHITE,
    active: WHITE,
    upcoming: 0.5,
    plate: { color: INK, opacity: 0.7, padX: 0.32, padY: 0.16, radius: 0.22 },
    entrance: "fade",
  },
};

export function preset(id: string): Preset {
  const found = PRESETS[id];
  if (!found) {
    throw new Error(
      `/captions/preset: no caption preset ${JSON.stringify(id)}; the presets are ` +
        Object.keys(PRESETS).join(", "),
    );
  }
  return found;
}
