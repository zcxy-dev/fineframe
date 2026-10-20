// The design tokens the templates and the captions share: colour, type scale, safe areas and
// motion. One place, so they read as one family.

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
 * on a plate and a title. */
export const TYPE = {
  title: step(5),
  name: step(2),
  chapter: step(2),
  subtitle: step(1),
  role: step(0),
  count: step(0),
  label: step(0),
} as const;

/**
 * One motion language for every template: the accent element draws first, then the content
 * enters after it, each part a short step later. Nothing animates out. Seconds, and cubic-bezier
 * control points.
 */
export const MOTION = {
  draw: 0.32,
  reveal: 0.48,
  stagger: 0.08,
  /** Arrivals: a fast start that settles, never a bounce. */
  enter: [0.16, 1, 0.3, 1],
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
