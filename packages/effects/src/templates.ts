// The effect templates as pages: each template's params laid out in the house look, with CSS
// animations for its entrance. Nothing animates out; an effect is cut away at its end, except the
// wipe, whose bands cross the frame over its whole length.

import type {
  CalloutParams,
  ChapterParams,
  KeywordParams,
  LowerThirdParams,
  TemplateId,
  TemplateParams,
  TitleParams,
  WipeParams,
} from "./catalog.ts";
import { type Aspect, type Layout, layoutFor, MOTION } from "./layout.ts";
import { PALETTE } from "./style.ts";

/** An effect's markup and its own styles, for `page()`. */
export interface Markup {
  html: string;
  css: string;
}

/** Text as HTML. */
function escaped(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const curve = (points: readonly number[]) => `cubic-bezier(${points.join(", ")})`;
const ENTER = curve(MOTION.enter);
/** An entrance of `name` over `seconds`, `delay` seconds in. */
const enter = (name: string, seconds: number, delay: number) =>
  `animation: ${name} ${seconds}s ${ENTER} ${delay}s both;`;

/** The template's page markup for an output of `aspect`, `width` by `height`, whose last frame
 * comes `seconds` in. */
export function templateMarkup<Id extends TemplateId>(
  template: Id,
  params: TemplateParams[Id],
  aspect: Aspect,
  width: number,
  height: number,
  seconds: number,
): Markup {
  const layout = layoutFor(aspect, width, height);
  switch (template) {
    case "title":
      return title(params as TitleParams, layout);
    case "lower-third":
      return lowerThird(params as LowerThirdParams, layout);
    case "keyword":
      return keyword(params as KeywordParams, layout);
    case "chapter":
      return chapter(params as ChapterParams, layout);
    case "callout":
      return callout(params as CalloutParams, layout);
    case "wipe":
      return wipe(params as WipeParams, layout, seconds);
  }
  throw new Error(`No template ${template}`);
}

/** A rule draws across, the title rises behind it, and a soft pool of shade gathers behind the
 * type so it reads over any footage. */
function title(params: TitleParams, layout: Layout): Markup {
  const { u, safe, type } = layout;
  const accent = params.accent ?? PALETTE.accent;
  // A landscape frame keeps the title to a comfortable measure instead of the full width.
  const measure = layout.aspect === "16:9" ? layout.width * 0.62 : layout.safeWidth;
  const html = `<div class="shade"></div><div class="block">
<div class="rule"></div>
<div class="head ff-hero">${escaped(params.text)}</div>
${params.subtitle ? `<div class="sub">${escaped(params.subtitle)}</div>` : ""}</div>`;
  const css = `
.shade { position: absolute; inset: 0; background: radial-gradient(ellipse 80% 48% at 50% 44%, rgba(11, 12, 15, 0.66), rgba(11, 12, 15, 0)); ${enter("ff-fade", MOTION.reveal, MOTION.stagger)} }
.block { position: absolute; inset: ${safe.top}px ${safe.right}px ${safe.bottom}px ${safe.left}px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding-bottom: ${6 * u}px; }
.rule { width: ${16 * u}px; height: ${u}px; margin-bottom: ${3 * u}px; border-radius: 99px; background: ${accent}; box-shadow: 0 0 ${2 * u}px ${accent}; transform-origin: center; ${enter("ff-draw", MOTION.draw, 0)} }
.head { max-width: ${measure}px; font-size: ${type("title")}px; font-weight: 900; line-height: 1.16; text-wrap: balance; ${enter("ff-rise", MOTION.reveal, MOTION.stagger)} }
.sub { max-width: ${measure}px; margin-top: ${2.2 * u}px; font-size: ${type("subtitle")}px; font-weight: 700; line-height: 1.4; color: rgba(245, 246, 248, 0.88); text-wrap: balance; ${enter("ff-rise", MOTION.reveal, MOTION.stagger * 2)} }`;
  return { html, css };
}

/** An accent bar grows, the plate opens out of it, and the name and role rise in turn. At 9:16
 * it sits at the top of the frame: the band above the captions is a talking head's chin. */
function lowerThird(params: LowerThirdParams, layout: Layout): Markup {
  const { u, safe, type } = layout;
  const accent = params.accent ?? PALETTE.accent;
  const place = layout.aspect === "9:16" ? `top: ${safe.top}px;` : `bottom: ${safe.bottom}px;`;
  const room = layout.safeWidth - 8 * u;
  const html = `<div class="third"><div class="bar"></div><div class="plate">
<div class="name">${escaped(params.name)}</div>
${params.role ? `<div class="role ff-muted">${escaped(params.role)}</div>` : ""}</div></div>`;
  const css = `
.third { position: absolute; left: ${safe.left}px; ${place} display: flex; align-items: stretch; gap: ${1.6 * u}px; padding: ${1.6 * u}px ${3 * u}px ${1.6 * u}px ${1.6 * u}px; border-radius: ${2.4 * u}px; background: rgba(13, 14, 17, 0.84); border: 1px solid rgba(255, 255, 255, 0.16); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 0 ${4 * u}px rgba(255, 181, 71, 0.16); max-width: ${layout.safeWidth}px; ${enter("ff-from-left", MOTION.reveal, MOTION.stagger)} }
.bar { width: ${1.1 * u}px; border-radius: 99px; background: ${accent}; box-shadow: 0 0 ${1.6 * u}px ${accent}; transform-origin: bottom; ${enter("ff-grow", MOTION.draw, 0)} }
@keyframes ff-grow { from { transform: scaleY(0); } }
.name { font-size: ${type("name")}px; line-height: 1.25; white-space: nowrap; max-width: ${room}px; overflow: hidden; text-overflow: clip; ${enter("ff-rise", MOTION.reveal, MOTION.stagger * 2)} }
.role { margin-top: ${0.5 * u}px; font-size: ${type("role")}px; line-height: 1.35; white-space: nowrap; max-width: ${room}px; overflow: hidden; ${enter("ff-rise", MOTION.reveal, MOTION.stagger * 3)} }`;
  return { html, css };
}

/** A highlighter swipe: the accent block sweeps in from the left and the word appears in its
 * wake, settling from a touch larger. */
function keyword(params: KeywordParams, layout: Layout): Markup {
  const { u, safe, type } = layout;
  const accent = params.accent ?? PALETTE.accent;
  const upper = (params.position ?? "upper") === "upper";
  const html = `<div class="row"><div class="word"><div class="swipe"></div><span>${escaped(params.text)}</span></div></div>`;
  const css = `
.row { position: absolute; left: ${safe.left}px; right: ${safe.right}px; ${upper ? `top: ${safe.top + 2 * u}px;` : `bottom: ${safe.bottom + 2 * u}px;`} display: flex; justify-content: center; }
.word { position: relative; ${enter("ff-settle", MOTION.reveal, 0)} }
@keyframes ff-settle { from { transform: scale(1.06); } }
.swipe { position: absolute; inset: 0; border-radius: ${0.8 * u}px; background: ${accent}; box-shadow: 0 0 ${3 * u}px rgba(255, 181, 71, 0.45); transform-origin: left; ${enter("ff-draw", MOTION.draw, 0)} }
.word span { position: relative; display: block; padding: ${0.3 * u}px ${1.8 * u}px ${0.5 * u}px; color: ${PALETTE.ink}; font-size: ${type("keyword")}px; font-weight: 900; line-height: 1.2; white-space: nowrap; max-width: ${layout.safeWidth}px; overflow: hidden; ${enter("ff-wake", MOTION.draw, MOTION.stagger / 2)} }
@keyframes ff-wake { from { clip-path: inset(0 100% 0 0); } to { clip-path: inset(0 0 0 0); } }`;
  return { html, css };
}

/** One segment per chapter draws in along the top, the current one fills with the accent, and
 * the chapter's number and name rise: the row says how far through the video this is. */
function chapter(params: ChapterParams, layout: Layout): Markup {
  const { u, safe, type } = layout;
  const accent = params.accent ?? PALETTE.accent;
  const { index, total } = params;
  const gap = 0.6 * u;
  const segment = Math.min(7 * u, (layout.safeWidth * 0.6 - gap * (total - 1)) / total);
  // The row draws in no longer than one stagger step per segment, and 0.24 s in all.
  const step = Math.min(0.04, 0.24 / total);
  const segments = Array.from({ length: total }, (_, k) => {
    const kind = k < index - 1 ? "done" : k === index - 1 ? "now" : "todo";
    return `<div class="seg ${kind}" style="animation-delay: ${(k * step).toFixed(3)}s"></div>`;
  }).join("");
  const html = `<div class="chapter"><div class="row">${segments}</div>
<div class="count ff-num">${index} / ${total}</div>
<div class="title">${escaped(params.title)}</div></div>`;
  const css = `
.chapter { position: absolute; left: ${safe.left}px; top: ${safe.top}px; padding: ${1.8 * u}px ${2.4 * u}px ${2 * u}px; border-radius: ${2.4 * u}px; background: rgba(13, 14, 17, 0.84); border: 1px solid rgba(255, 255, 255, 0.16); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16), 0 0 ${4 * u}px rgba(255, 181, 71, 0.16); max-width: ${layout.safeWidth}px; ${enter("ff-rise", MOTION.reveal, MOTION.stagger)} }
.row { display: flex; gap: ${gap}px; }
.seg { width: ${segment}px; height: ${0.7 * u}px; border-radius: ${0.35 * u}px; transform-origin: left; ${enter("ff-draw", MOTION.draw, 0)} }
.seg.done { background: rgba(245, 246, 248, 0.92); }
.seg.todo { background: rgba(245, 246, 248, 0.28); }
.seg.now { background: ${accent}; box-shadow: 0 0 ${1.4 * u}px ${accent}; }
.count { margin-top: ${1.6 * u}px; font-size: ${type("count")}px; letter-spacing: 0.08em; color: ${accent}; ${enter("ff-rise", MOTION.reveal, MOTION.stagger * 2)} }
.title { margin-top: ${0.3 * u}px; font-size: ${type("chapter")}px; line-height: 1.25; white-space: nowrap; ${enter("ff-rise", MOTION.reveal, MOTION.stagger * 3)} }`;
  return { html, css };
}

/** The frame dims around the region while an accent outline draws around it, and the label
 * slides out from the outline's corner. */
function callout(params: CalloutParams, layout: Layout): Markup {
  const { u, safe, type, width, height } = layout;
  const accent = params.accent ?? PALETTE.accent;
  // The outline stands a little off the region, so it never covers what it points at.
  const gap = 0.8 * u;
  const box = {
    x: params.rect.x * width - gap,
    y: params.rect.y * height - gap,
    w: params.rect.w * width + 2 * gap,
    h: params.rect.h * height + 2 * gap,
  };
  const radius = 1.2 * u;
  const size = type("label");
  const labelHeight = size * 1.3 + 1.1 * u;
  // Above the outline when there is room inside the safe area, below it otherwise.
  const above = box.y - gap - labelHeight >= safe.top;
  const top = above ? box.y - gap - labelHeight : box.y + box.h + gap;
  const left = Math.max(safe.left, box.x);
  const dim =
    (params.dim ?? true)
      ? `<path class="dim" fill-rule="evenodd" d="M0 0H${width}V${height}H0Z M${box.x + radius} ${box.y}h${box.w - 2 * radius}a${radius} ${radius} 0 0 1 ${radius} ${radius}v${box.h - 2 * radius}a${radius} ${radius} 0 0 1 -${radius} ${radius}h-${box.w - 2 * radius}a${radius} ${radius} 0 0 1 -${radius} -${radius}v-${box.h - 2 * radius}a${radius} ${radius} 0 0 1 ${radius} -${radius}Z"/>`
      : "";
  const html = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">${dim}
<rect class="outline" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${radius}" pathLength="1"/></svg>
${params.label ? `<div class="tag">${escaped(params.label)}</div>` : ""}`;
  const css = `
svg { position: absolute; inset: 0; }
.dim { fill: rgba(11, 12, 15, 0.5); ${enter("ff-fade", MOTION.reveal, 0)} }
.outline { fill: none; stroke: ${accent}; stroke-width: ${0.45 * u}px; stroke-dasharray: 1; ${enter("ff-stroke", MOTION.reveal, MOTION.stagger)} filter: drop-shadow(0 0 ${u}px ${accent}); }
@keyframes ff-stroke { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
.tag { position: absolute; left: ${left}px; top: ${top}px; max-width: ${width - safe.right - left}px; padding: ${0.5 * u}px ${1.2 * u}px ${0.6 * u}px; border-radius: ${0.8 * u}px; background: ${accent}; color: ${PALETTE.ink}; font-size: ${size}px; line-height: 1.3; white-space: nowrap; overflow: hidden; ${enter("ff-from-left", MOTION.reveal, MOTION.stagger + MOTION.reveal / 2)} }`;
  return { html, css };
}

// Fractions of the wipe over which each edge of each band crosses the frame. The accent band
// leads in and trails out around the ink band, which covers the whole frame from 0.44 to 0.56:
// the cut goes in the middle.
const ACCENT = { leading: [0, 0.36], trailing: [0.64, 1] } as const;
const INK = { leading: [0.08, 0.44], trailing: [0.56, 0.92] } as const;

/** The value at `t` of a cubic-bezier easing with control points `p1` and `p2`. */
function bezier([x1, y1, x2, y2]: readonly number[], t: number): number {
  const at = (a: number, b: number, s: number) =>
    3 * a * s * (1 - s) ** 2 + 3 * b * s ** 2 * (1 - s) + s ** 3;
  // Finds the curve's parameter whose x is t, then its y.
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (at(x1 as number, x2 as number, mid) < t) lo = mid;
    else hi = mid;
  }
  return at(y1 as number, y2 as number, (lo + hi) / 2);
}

/** Two bands, accent then ink, sweep across the frame with a slanted edge and cover the cut.
 * Their edges move on the sweep curve, drawn as clip paths sampled through the wipe. */
function wipe(params: WipeParams, layout: Layout, seconds: number): Markup {
  const { width, height } = layout;
  const direction = params.direction ?? "right";
  const horizontal = direction === "left" || direction === "right";
  const along = horizontal ? width : height;
  const across = horizontal ? height : width;
  const slant = across * 0.18;
  const edge = ([from, to]: readonly number[], t: number) => {
    const p = bezier(
      MOTION.sweep,
      Math.min(1, Math.max(0, (t - (from as number)) / ((to as number) - (from as number)))),
    );
    return -slant / 2 + p * (along + slant);
  };
  const band = (bounds: typeof ACCENT | typeof INK, t: number) => {
    const back = edge(bounds.trailing, t);
    const front = edge(bounds.leading, t);
    const corners: [number, number][] = [
      [back + slant / 2, 0],
      [front + slant / 2, 0],
      [front - slant / 2, across],
      [back - slant / 2, across],
    ];
    const screen = corners.map(([a, b]) => {
      if (direction === "right") return [a, b];
      if (direction === "left") return [width - a, b];
      if (direction === "down") return [b, a];
      return [b, height - a];
    });
    return `polygon(${screen.map(([x, y]) => `${(x as number).toFixed(1)}px ${(y as number).toFixed(1)}px`).join(", ")})`;
  };
  const STEPS = 40;
  const frames = (bounds: typeof ACCENT | typeof INK) =>
    Array.from(
      { length: STEPS + 1 },
      (_, k) => `${((k / STEPS) * 100).toFixed(2)}% { clip-path: ${band(bounds, k / STEPS)}; }`,
    ).join("\n");
  const html = `<div class="band accent"></div><div class="band ink"></div>`;
  const css = `
.band { position: absolute; inset: 0; }
.accent { background: ${params.accent ?? PALETTE.accent}; animation: ff-wipe-accent ${seconds}s linear both; }
.ink { background: ${params.color ?? PALETTE.ink}; animation: ff-wipe-ink ${seconds}s linear both; }
@keyframes ff-wipe-accent { ${frames(ACCENT)} }
@keyframes ff-wipe-ink { ${frames(INK)} }`;
  return { html, css };
}
