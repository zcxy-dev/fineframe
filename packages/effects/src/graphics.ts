// Motion graphics Claude writes for each edit: their layouts, how long each may stay, how they
// move, and the page each renders as.

import type { Project } from "@video-editor/schema";
import { iconNames, LOGOS, logoNames } from "./icons.ts";
import { type Aspect, layoutFor } from "./layout.ts";
import { type Box, page } from "./page.ts";
import { HOUSE_CSS } from "./style.ts";

/** Where a graphic draws: a corner label or a lower third over the speaker, who stays in shot;
 * the upper panel of a 9:16 split screen with the speaker below; or the whole frame. */
export type GraphicLayout = "label" | "lower-third" | "panel" | "full";
export const GRAPHIC_LAYOUTS: readonly GraphicLayout[] = ["label", "lower-third", "panel", "full"];

/** How long each layout stays, in seconds. A full-frame graphic holds 4 to 12 s, as long as a
 * point needs to be read; the speaker's own layouts come and go faster. */
export const GRAPHIC_SECONDS: Record<GraphicLayout, { min: number; max: number }> = {
  label: { min: 1.5, max: 6 },
  "lower-third": { min: 2, max: 6 },
  panel: { min: 3, max: 8 },
  full: { min: 4, max: 12 },
};

/** Each part of a graphic enters over 0.3 to 0.8 s and never animates out. */
export const ENTRANCE = { min: 0.3, max: 0.8 } as const;
/** A graphic starts this long before the word it lands on is said: 0.2 to 0.6 s. */
export const LEAD = 0.4;
/** A full-frame or panel graphic slides in over this long, pushed in from the side. */
export const SLIDE = 0.35;
/** Full-frame graphics take at most this share of an edit. */
export const FULL_SHARE = 0.25;

/** Whether a layout is laid over the picture, with its alpha, rather than filling its area. */
export const isOverlayLayout = (layout: GraphicLayout) =>
  layout === "label" || layout === "lower-third";

/** The upper panel of a 9:16 split screen, as a share of the frame's height: the top 880 of
 * every 1920 rows, the split short-form edits use. */
export function panelShare(aspect: Aspect): number {
  return aspect === "9:16" ? 880 / 1920 : 0.5;
}

/** The size in pixels a graphic of `layout` is laid out in: the frame, or the panel in even
 * rows. */
export function graphicFrame(
  layout: GraphicLayout,
  output: Pick<Project["output"], "aspect" | "width" | "height">,
): { width: number; height: number } {
  if (layout !== "panel") return { width: output.width, height: output.height };
  return {
    width: output.width,
    height: Math.round((panelShare(output.aspect) * output.height) / 2) * 2,
  };
}

/** The smallest type a graphic may use, in units of 1 % of the frame's short side: larger at
 * 9:16, for a phone held in the hand. */
export const minType = (aspect: Aspect) => (aspect === "9:16" ? 3.2 : 2.6);

/** One graphic to render: its markup, its layout, its region of the frame when it is laid over
 * the picture, and its length in output frames. */
export interface GraphicJob {
  layout: GraphicLayout;
  html: string;
  css: string;
  /** For a label or a lower third, the part of the frame it draws in, in output pixels. */
  box?: Box;
  output: Pick<Project["output"], "aspect" | "width" | "height" | "fps">;
  frames: number;
}

/** A graphic's page and the size it renders at. */
export function graphicPage(job: GraphicJob): {
  page: string;
  width: number;
  height: number;
  transparent: boolean;
} {
  const frame = graphicFrame(job.layout, job.output);
  const u = Math.min(job.output.width, job.output.height) / 100;
  const box = isOverlayLayout(job.layout) ? job.box : undefined;
  return {
    page: page({
      ...frame,
      ...(box ? { box } : {}),
      u,
      fps: job.output.fps,
      frames: job.frames,
      html: job.html,
      css: job.css,
    }),
    width: box?.width ?? frame.width,
    height: box?.height ?? frame.height,
    transparent: isOverlayLayout(job.layout),
  };
}

/** How graphics are written, for the request that asks Claude for them. */
export function graphicsGuide(aspect: Aspect, width: number, height: number): string {
  const layout = layoutFor(aspect, width, height);
  const safe = layout.safe;
  const panel = graphicFrame("panel", { aspect, width, height });
  const layouts = [
    "- label: a chip in a corner over the speaker, 1 to 6 words with a dot or a bar of the accent. The face stays in shot.",
    "- lower-third: a pill low on one side over the speaker, a keyword and a short qualifier. The face stays in shot.",
    ...(aspect === "9:16"
      ? [
          `- panel: the upper panel of a split screen, ${panel.width}×${panel.height} px, with the speaker shown below it, for a comparison, a short list or a number while they keep talking. Keep its text above y ${panel.height - 140}: the captions sit on the seam.`,
        ]
      : []),
    "- full: the whole frame, the speaker hidden, only for a thesis, a list, a number or a comparison with enough in it to read on its own, held 4 to 12 s.",
  ];
  const u = Math.min(width, height) / 100;
  return `## How graphics look

Dark near-black stages lit by a soft amber bloom, frosted glass panels with a thin light edge, white bold type, one amber accent. Big, confident type that fills its box: no small UI floating in empty space, no emoji or pictures.

Layouts:
${layouts.join("\n")}

A full or panel graphic is one composition centred in its box: its content spans 75 to 90 % of the box's width, its hero word or number is its largest thing, and no quarter of the box is left empty. Two items side by side or stacked are equal in size. A label or a lower third reads at a glance: type of 6 to 8 units, at most two lines.

The page loads this stylesheet; use its classes, and write your own CSS for layout and motion:
\`\`\`css
${HOUSE_CSS.trim()}
\`\`\`
- \`--u\` is 1 % of the frame's short side (${u} px here). Size everything in \`calc(var(--u) * n)\`. Type sizes in units: small print 2.6 to 3.2, body 4 to 5, a heading 6 to 8, a hero word or number 12 to 24; never under ${minType(aspect)}.
- A full or panel graphic starts with \`<div class="ff-stage"></div>\` and puts its content over it. A label or a lower third draws nothing but its chip or pill: the rest stays transparent over the footage.
- Icons and logos are the only images: \`<img src="icons/NAME.svg">\` draws a line icon in white and \`<img src="icons/accent/NAME.svg">\` in the accent, \`<img src="logos/NAME.svg">\` a brand's logo in its colour; size each with width and height in \`--u\`, beside the words it marks, never alone. A logo shows only a brand the speaker names near it. Icons: ${iconNames.join(", ")}. Logos: ${logoNames.map((name) => `${name} (${LOGOS[name].title})`).join(", ")}.
- Your HTML goes inside a box the size of the frame (or of the panel), positioned at its top-left corner; place things with \`position: absolute\`, flex or grid inside it.
- The safe area for labels and lower thirds is x ${Math.round(safe.left)} to ${Math.round(width - safe.right)} and y ${Math.round(safe.top)} to ${Math.round(height - safe.bottom)}${aspect === "9:16" ? " (the app's header is above it and its buttons to the right)" : ""}.

Motion: every part enters with a CSS animation of 0.3 to 0.8 s, \`animation-fill-mode: both\`, at a delay in seconds from the graphic's start; the stylesheet's keyframes ff-rise, ff-fade, ff-from-left, ff-from-right, ff-pop and ff-draw and the timing \`var(--enter)\` are there to use, or write your own @keyframes. Entrances only: nothing animates out, loops or keeps moving; the graphic is cut away at its end. A full or panel graphic is slid in by the renderer over its first ${SLIDE} s, so start its parts at 0.25 s or later and build them in order, each on the word that names it; a box enters with its text, never empty. A number may count up with an @property integer and a counter. No scripts, no url(), and no images but those icons and logos: only HTML and CSS.`;
}
