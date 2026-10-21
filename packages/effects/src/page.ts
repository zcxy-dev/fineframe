// The page an effect renders as: its markup and styles in a document that loads the house
// stylesheet, the fonts and the bundled icons and logos from the render's own folder and nothing
// else, sized to what it fills.

import type { FrameRate } from "@video-editor/schema";

/** A region of the frame, in output pixels. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PageSpec {
  /** The frame the effect is laid out in, in pixels: the output's, or a panel's. */
  width: number;
  height: number;
  /** The part of that frame the page renders, when not all of it: a label's own box. */
  box?: Box;
  /** 1 % of the output frame's short side, in pixels: the `--u` every size is given in. */
  u: number;
  fps: FrameRate;
  frames: number;
  /** The effect's markup and its own styles. */
  html: string;
  css: string;
  /** The house stylesheet in a brand kit's look, in place of house.css, and the script that
   * keeps its text readable (brand.ts). */
  house?: string;
  script?: string;
}

/** No request leaves the page but for its stylesheets, fonts and the bundled icons and logos, all
 * in its own folder, and no script runs: the renderer adds the hashes of its own scripts to this
 * policy as it serves the page (worker.ts). */
export const POLICY =
  "default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self'; " +
  "script-src 'none'";

/** The whole document for one effect. The renderer seeks its CSS animations frame by frame. */
export function page(spec: PageSpec): string {
  const { width, height, fps, frames } = spec;
  const box = spec.box ?? { x: 0, y: 0, width, height };
  const seconds = (frames * fps.den) / fps.num;
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${POLICY}">
<link rel="stylesheet" href="fonts.css">${spec.house === undefined ? '<link rel="stylesheet" href="house.css">' : `<style>${spec.house}</style>`}
<style>
html, body { width: ${box.width}px; height: ${box.height}px; }
/* Held at their start until the renderer seeks them: HyperFrames measures each animation from the
   time it has run when first seen, so one left running from load would render a frame or two late. */
*, *::before, *::after { animation-play-state: paused !important; }
:root { --u: ${spec.u}px; }
#frame { position: absolute; left: ${-box.x}px; top: ${-box.y}px; width: ${width}px; height: ${height}px; overflow: hidden; }
${spec.css}
</style></head><body>
<div id="root" data-composition-id="effect" data-no-timeline data-start="0" data-duration="${seconds}" data-width="${box.width}" data-height="${box.height}"><div id="frame" class="ff">${spec.html}</div></div>
${spec.script === undefined ? "" : `<script>${spec.script}</script>\n`}</body></html>
`;
}
