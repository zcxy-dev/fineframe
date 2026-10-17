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
export const CARD_TYPE = {
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
