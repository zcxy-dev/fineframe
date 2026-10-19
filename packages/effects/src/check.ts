// Checks each graphic as drawn, in the same Chrome the renderer uses: its text stays on the frame
// and off the captions and faces, nothing overlaps or is cut off, a full-frame graphic fills its
// frame, and every part enters and stays. What it says is returned for the caller to check against
// the speech.

import { readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, sep } from "node:path";
import puppeteer from "puppeteer-core";
import {
  ENTRANCE,
  type GraphicJob,
  graphicFrame,
  graphicPage,
  isOverlayLayout,
  minType,
} from "./graphics.ts";
import { layoutFor } from "./layout.ts";
import { type Box, markupProblem } from "./page.ts";
import { site } from "./render.ts";

/** One graphic to check, and what in the frame it must keep clear of over its time on screen. */
export interface GraphicCheckJob extends Omit<GraphicJob, "box"> {
  /** Where the captions are drawn while it shows, in the frame it is laid out in. */
  captions: Box[];
  /** Where faces are while it shows, in output pixels; only labels and lower thirds keep off them. */
  faces: Box[];
}

export interface GraphicCheck {
  /** What is wrong with it, each as a sentence for whoever fixes it; none when it passes. */
  problems: string[];
  /** The text it shows, as drawn. */
  text: string;
  /** Each piece of text it shows, as its markup breaks them. */
  pieces: string[];
  /** For a label or a lower third, the part of the frame it draws in, with room for its glow. */
  box: Box | null;
  /** The graphic once every part has entered, as a PNG at half size. */
  shot: Buffer | null;
}

/** What the page shows at one moment. */
interface Snapshot {
  t: number;
  texts: { text: string; rects: Box[]; size: number; clip: Box | null; owner: number }[];
  /** Every drawn element's box, for a label's extent and a full graphic's fill. */
  elements: Box[];
  /** Each framed box that holds text, by its index: whether it shows, and whether its text does. */
  frames: { shows: boolean; filled: boolean }[];
}

/** What the page reports: its animations' timings, and what shows as each ends and at the end. */
interface Drawn {
  animations: { duration: number; delay: number; end: number; infinite: boolean }[];
  snapshots: Snapshot[];
  /** When every part has entered. */
  settled: number;
}

/** Checks each graphic in one browser at `chrome`, and returns what it found in their order. */
export async function checkGraphics(
  jobs: readonly GraphicCheckJob[],
  chrome: string,
): Promise<GraphicCheck[]> {
  if (jobs.length === 0) return [];
  const dir = await site();
  const server = await serve(dir);
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox"],
  });
  const results: GraphicCheck[] = [];
  try {
    for (const [i, job] of jobs.entries()) {
      const unsafe = markupProblem(job.html, job.css);
      if (unsafe) {
        results.push({
          problems: [`It cannot be drawn: ${unsafe}.`],
          text: "",
          pieces: [],
          box: null,
          shot: null,
        });
        continue;
      }
      const name = `check-${process.pid}-${i}.html`;
      const frame = graphicFrame(job.layout, job.output);
      await writeFile(join(dir, name), graphicPage({ ...job, box: undefined }).page);
      const tab = await browser.newPage();
      try {
        await tab.setViewport(frame);
        await tab.goto(`${server.url}/${name}`, { waitUntil: "load" });
        results.push(await inspect(tab, job, frame));
      } finally {
        await tab.close();
        await rm(join(dir, name), { force: true });
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  return results;
}

async function inspect(
  tab: import("puppeteer-core").Page,
  job: GraphicCheckJob,
  frame: { width: number; height: number },
): Promise<GraphicCheck> {
  const seconds = (job.frames * job.output.fps.den) / job.output.fps.num;
  const drawn = (await tab.evaluate(async (seconds: number) => {
    await document.fonts.ready;
    const animations = document.getAnimations();
    for (const animation of animations) animation.pause();
    const timings = animations.map((animation) => {
      const timing = animation.effect?.getComputedTiming();
      return {
        duration: Number(timing?.duration ?? 0) / 1000,
        delay: Number(timing?.delay ?? 0) / 1000,
        end: Number(timing?.endTime ?? 0) / 1000,
        infinite: timing?.iterations === Number.POSITIVE_INFINITY,
      };
    });
    const root = document.getElementById("frame") as HTMLElement;
    const opacity = (element: Element | null) => {
      let total = 1;
      for (let e = element; e && e !== root.parentElement; e = e.parentElement) {
        total *= Number(getComputedStyle(e).opacity);
      }
      return total;
    };
    const rect = (r: DOMRect) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
    const owners: Element[] = [];
    // Boxes drawn with a fill or an edge that hold text: they must not show empty.
    const framed = [...root.querySelectorAll("*")].filter((e) => {
      if (e.classList.contains("ff-stage") || !(e.textContent ?? "").trim()) return false;
      const style = getComputedStyle(e);
      const fill = !/^(transparent|rgba\(.*,\s*0\))$/.test(style.backgroundColor);
      return (
        fill || style.backgroundImage !== "none" || Number.parseFloat(style.borderTopWidth) > 0
      );
    });
    const snapshot = (t: number) => {
      for (const animation of animations) animation.currentTime = t * 1000;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const texts = [];
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = (node.textContent ?? "").trim();
        const parent = node.parentElement as HTMLElement;
        if (!text || opacity(parent) <= 0.5) continue;
        if (!owners.includes(parent)) owners.push(parent);
        const range = document.createRange();
        range.selectNodeContents(node);
        // The nearest box that clips it, if any.
        let clip = null;
        for (let e: HTMLElement | null = parent; e && e !== root; e = e.parentElement) {
          const style = getComputedStyle(e);
          if (style.overflowX !== "visible" || style.overflowY !== "visible") {
            clip = rect(e.getBoundingClientRect());
            break;
          }
        }
        texts.push({
          text,
          rects: [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0).map(rect),
          size: Number.parseFloat(getComputedStyle(parent).fontSize),
          clip,
          owner: owners.indexOf(parent),
        });
      }
      const elements = [...root.querySelectorAll("*")]
        .filter((e) => !e.classList.contains("ff-stage") && opacity(e) > 0.2)
        .filter((e) => getComputedStyle(e).visibility !== "hidden")
        .map((e) => rect(e.getBoundingClientRect()))
        .filter((r) => r.width > 0 && r.height > 0);
      const frames = framed.map((e) => {
        const box = e.getBoundingClientRect();
        const shows = opacity(e) > 0.2 && box.width > 0 && box.height > 0;
        const inside = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
        let filled = false;
        for (let node = inside.nextNode(); node && !filled; node = inside.nextNode()) {
          filled = !!(node.textContent ?? "").trim() && opacity(node.parentElement) > 0.5;
        }
        return { shows, filled };
      });
      return { t, texts, elements, frames };
    };
    // As each part starts and finishes moving, and on the last frame.
    const last = Math.max(0, seconds - 1 / 30);
    const ends = timings.filter((t) => !t.infinite).map((t) => Math.min(t.end, last));
    const settled = Math.max(0, ...ends);
    const times = new Set([...ends, ...timings.map((t) => Math.min(t.delay, last)), settled]);
    times.delete(last);
    const snapshots = [...times].sort((a, b) => a - b).map(snapshot);
    snapshots.push(snapshot(last));
    // Left showing what the graphic looks like once every part has entered.
    snapshot(settled);
    return { animations: timings, snapshots, settled };
  }, seconds)) as Drawn;
  const final = drawn.snapshots.at(-1) as Snapshot;
  const settled = drawn.snapshots.find((s) => s.t === drawn.settled) ?? final;
  // Every text as it showed at any of those moments.
  const texts = drawn.snapshots.flatMap((s) => s.texts);
  const vanished = [...new Set(texts.map((t) => t.text))].filter(
    (text) => !final.texts.some((t) => t.text === text),
  );
  const problems: string[] = [];
  const u = Math.min(job.output.width, job.output.height) / 100;
  const { animations } = drawn;
  if (animations.length === 0) {
    problems.push(
      "Nothing in it moves: give each part an entrance, a CSS animation of 0.3 to 0.8 s.",
    );
  }
  for (const a of animations) {
    if (a.infinite) {
      problems.push("An animation repeats forever: entrances only, each played once.");
      break;
    }
  }
  const lengths = animations.filter((a) => !a.infinite).map((a) => a.duration);
  const off = lengths.filter((d) => d < ENTRANCE.min - 0.01 || d > ENTRANCE.max + 0.01);
  if (off.length > 0) {
    problems.push(
      `An entrance lasts ${off.map((d) => `${d.toFixed(2)} s`).join(", ")}: each part enters over ${ENTRANCE.min} to ${ENTRANCE.max} s.`,
    );
  }
  const late = animations.filter((a) => !a.infinite && a.end > seconds - 0.1);
  if (late.length > 0) {
    problems.push(`A part is still entering when the graphic ends at ${seconds.toFixed(2)} s.`);
  }
  if (vanished.length > 0) {
    problems.push(
      `${quote(vanished)} disappears before the end: entrances only, nothing animates out.`,
    );
  }
  if (final.texts.length === 0) problems.push("It shows no text once its parts have entered.");
  // The longest any box shows with none of its text yet.
  let empty = 0;
  for (const [i] of (drawn.snapshots[0]?.frames ?? []).entries()) {
    const from = drawn.snapshots.find((s) => s.frames[i]?.shows && !s.frames[i]?.filled)?.t;
    if (from === undefined) continue;
    const to = drawn.snapshots.find((s) => s.t > from && s.frames[i]?.filled)?.t ?? seconds;
    empty = Math.max(empty, to - from);
  }
  if (empty > EMPTY) {
    problems.push(
      `A box shows empty for ${empty.toFixed(1)} s before its text enters: bring the text in with its box, within ${EMPTY} s.`,
    );
  }
  const all = final.texts.flatMap((t) => t.rects);
  const outside = texts.filter((t) =>
    t.rects.some(
      (r) =>
        r.x < -1 ||
        r.y < -1 ||
        r.x + r.width > frame.width + 1 ||
        r.y + r.height > frame.height + 1,
    ),
  );
  if (outside.length > 0) {
    problems.push(
      `${quote(outside.map((t) => t.text))} runs off the ${job.layout === "panel" ? "panel" : "frame"}.`,
    );
  }
  const clipped = texts.filter(
    (t) =>
      t.clip &&
      t.rects.some(
        (r) =>
          r.x < (t.clip as Box).x - 1 ||
          r.y < (t.clip as Box).y - 1 ||
          r.x + r.width > (t.clip as Box).x + (t.clip as Box).width + 1 ||
          r.y + r.height > (t.clip as Box).y + (t.clip as Box).height + 1,
      ),
  );
  if (clipped.length > 0)
    problems.push(`${quote(clipped.map((t) => t.text))} is cut off by its box.`);
  const small = texts.filter((t) => t.size < minType(job.output.aspect) * u - 0.5);
  if (small.length > 0) {
    problems.push(
      `${quote(small.map((t) => t.text))} is set under the smallest size, ${minType(job.output.aspect)} units (${(minType(job.output.aspect) * u).toFixed(0)} px).`,
    );
  }
  const overlaps = new Set<string>();
  for (const { texts: shown } of drawn.snapshots) {
    for (let a = 0; a < shown.length; a++) {
      for (let b = a + 1; b < shown.length; b++) {
        const ta = shown[a] as Snapshot["texts"][number];
        const tb = shown[b] as Snapshot["texts"][number];
        if (ta.owner === tb.owner) continue;
        const hit = ta.rects.some((ra) => tb.rects.some((rb) => overlapShare(ra, rb) > 0.15));
        if (hit) overlaps.add(`${ta.text} / ${tb.text}`);
      }
    }
  }
  if (overlaps.size > 0) problems.push(`Texts overlap: ${[...overlaps].slice(0, 3).join("; ")}.`);
  const onCaptions = texts.filter((t) =>
    t.rects.some((r) => job.captions.some((c) => intersects(r, c))),
  );
  if (onCaptions.length > 0) {
    problems.push(
      `${quote(onCaptions.map((t) => t.text))} lies under the captions, which are drawn at ${job.captions.map((c) => `y ${Math.round(c.y)}–${Math.round(c.y + c.height)}`).join(", ")}.`,
    );
  }
  let box: Box | null = null;
  const elements = drawn.snapshots.flatMap((s) => s.elements);
  if (isOverlayLayout(job.layout) && elements.length > 0) {
    const extent = union(elements);
    // Room for the chip's shadow and glow.
    box = clampBox(pad(extent, 4 * u), job.output.width, job.output.height);
    const faces = job.faces.filter((f) => intersects(extent, f));
    if (faces.length > 0) problems.push("It covers the speaker's face.");
    const safe = layoutFor(job.output.aspect, job.output.width, job.output.height).safe;
    if (
      extent.x < safe.left - 1 ||
      extent.y < safe.top - 1 ||
      extent.x + extent.width > job.output.width - safe.right + 1 ||
      extent.y + extent.height > job.output.height - safe.bottom + 1
    ) {
      problems.push(
        `It reaches outside the safe area, x ${Math.round(safe.left)}–${Math.round(job.output.width - safe.right)}, y ${Math.round(safe.top)}–${Math.round(job.output.height - safe.bottom)}.`,
      );
    }
  }
  const largest = Math.max(0, ...settled.texts.map((t) => t.size)) / u;
  if (!isOverlayLayout(job.layout) && all.length > 0) {
    // Measured on the text alone: a box that only frames it fills nothing.
    const text = union(settled.texts.flatMap((t) => t.rects));
    const wide = text.width / frame.width;
    const tall = text.height / frame.height;
    const area = job.layout === "panel" ? "panel" : "frame";
    if (wide < 0.65 || tall < 0.35) {
      problems.push(
        `It leaves too much of the ${area} empty: its text spans ${Math.round(100 * wide)} % of the width and ${Math.round(100 * tall)} % of the height; spread it over 75 to 90 % of the width and most of the height, with larger type.`,
      );
    }
    if (largest < HERO - 0.25) {
      problems.push(
        `Its largest text is ${largest.toFixed(1)} units: a ${area} graphic's hero word or number is ${HERO} to 24 units.`,
      );
    }
  }
  if (isOverlayLayout(job.layout) && all.length > 0 && largest < GLANCE - 0.25) {
    problems.push(
      `Its largest text is ${largest.toFixed(1)} units: a ${job.layout} is read at a glance, in type of ${GLANCE} to 8 units.`,
    );
  }
  const clip = box ?? { x: 0, y: 0, ...frame };
  const shot = Buffer.from(
    await tab.screenshot({ type: "png", clip: { ...clip, scale: 0.5 }, omitBackground: true }),
  );
  return {
    problems,
    text: final.texts.map((t) => t.text).join(" "),
    pieces: final.texts.map((t) => t.text),
    box,
    shot,
  };
}

/** The smallest a full or panel graphic's largest text may be, and a label's, in units. */
const HERO = 12;
const GLANCE = 5;
/** The longest a box may show before its text, in seconds. */
const EMPTY = 0.8;

const quote = (texts: string[]) => [...new Set(texts)].map((t) => `"${t}"`).join(", ");

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function overlapShare(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.width * a.height, b.width * b.height);
}

function union(boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

const pad = (b: Box, by: number): Box => ({
  x: b.x - by,
  y: b.y - by,
  width: b.width + 2 * by,
  height: b.height + 2 * by,
});

/** Inside the frame, on even pixels, as video sizes must be. */
function clampBox(b: Box, width: number, height: number): Box {
  const even = (n: number) => Math.round(n / 2) * 2;
  const x = Math.max(0, even(Math.floor(b.x)));
  const y = Math.max(0, even(Math.floor(b.y)));
  const right = Math.min(width, even(Math.ceil(b.x + b.width)));
  const bottom = Math.min(height, even(Math.ceil(b.y + b.height)));
  return { x, y, width: right - x, height: bottom - y };
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
};

/** Serves `dir` to the checking browser on a local port, files only, nothing above it. */
async function serve(dir: string): Promise<{ url: string; close: () => void }> {
  const root = normalize(dir + sep);
  const server = createServer(async (request, response) => {
    const path = normalize(
      join(root, decodeURIComponent((request.url ?? "/").split("?")[0] as string)),
    );
    if (!path.startsWith(root) || request.method !== "GET") {
      response.writeHead(404).end();
      return;
    }
    try {
      const body = await readFile(path);
      response.writeHead(200, {
        "content-type": TYPES[extname(path)] ?? "application/octet-stream",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}
