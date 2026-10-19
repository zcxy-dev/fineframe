// The page an effect renders as: its markup and styles in a document that loads the house
// stylesheet and fonts from the render's own folder and nothing else, sized to what it fills.

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
}

/** No request leaves the page but for its stylesheets and fonts, and no script runs but the
 * renderer's own. */
const POLICY =
  "default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src data:; " +
  "script-src 'self' 'unsafe-inline'";

/** The whole document for one effect. The renderer seeks its CSS animations frame by frame. */
export function page(spec: PageSpec): string {
  const { width, height, fps, frames } = spec;
  const box = spec.box ?? { x: 0, y: 0, width, height };
  const seconds = (frames * fps.den) / fps.num;
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${POLICY}">
<link rel="stylesheet" href="fonts.css"><link rel="stylesheet" href="house.css">
<style>
html, body { width: ${box.width}px; height: ${box.height}px; }
:root { --u: ${spec.u}px; }
#frame { position: absolute; left: ${-box.x}px; top: ${-box.y}px; width: ${width}px; height: ${height}px; overflow: hidden; }
${spec.css}
</style></head><body>
<div id="root" data-composition-id="effect" data-no-timeline data-start="0" data-duration="${seconds}" data-width="${box.width}" data-height="${box.height}"><div id="frame" class="ff">${spec.html}</div></div>
</body></html>
`;
}

/** Why the markup or styles Claude wrote cannot be drawn as they are, or null: scripts, event
 * handlers and anything loaded from elsewhere are not allowed. The page's policy blocks them
 * anyway; this says so before a render. */
export function markupProblem(html: string, css: string): string | null {
  if (/<\s*(script|iframe|object|embed|link|meta|base|img|video|audio|style)\b/i.test(html)) {
    return "it uses an element graphics may not use (script, iframe, img, link, style and the like)";
  }
  if (/\son\w+\s*=/i.test(html)) return "it has an event handler";
  if (/javascript:/i.test(html + css)) return "it has a javascript: address";
  if (/@import|url\(\s*['"]?(?!data:)/i.test(css) || /url\(\s*['"]?(?!data:)/i.test(html)) {
    return "it loads something by url()";
  }
  return null;
}
