// Where on a screen recording the thing a speaker names is, for a callout: Claude reads the one
// frame on screen as it is named and boxes the thing. Its answers are kept on disk, so planning
// the same footage again costs nothing; code then checks that the box shows whole and holds
// still for as long as the callout plays in the edit.

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Framing, type Rect, TICKS_PER_SECOND } from "@video-editor/schema";
import { cacheDir } from "../download.ts";
import { ffmpeg, QUIET, run } from "../ffmpeg.ts";
import { displayAspect, visible } from "../framing.ts";
import { decimal } from "../graph/inputs.ts";
import { CHECK_MODEL, type Claude, ClaudeError, type Usage } from "./claude.ts";
import { findWords } from "./fillers.ts";
import type { PlanSource } from "./plan.ts";
import { joinWords } from "./text.ts";

/** Boxing one thing on one frame is a small vision task: the bulk model does it as well as the
 * planning one on the synthetic screen recording (packages/engine/README.md#planning). */
export const LOCATE_MODEL = CHECK_MODEL;
/** Frames are sent at most this wide, as the screen-recording measurements were made. */
const FRAME_WIDTH = 1280;
/** The callout starts this long before the thing is named (catalog). */
export const CALLOUT_LEAD = 0.3;
/** A box under this share of the frame is too small to read as a region; over the larger, the
 * callout would dim next to nothing. */
const SMALLEST = 0.0005;
const LARGEST = 0.25;
/** Over the callout, the region holds still when its pixels change by less than this on average
 * from the frame it was found on, or when it still correlates this well with it: a pointer
 * passing over it leaves it readable, scrolling does not. */
const STILL_LEVEL = 4;
const STILL_CORRELATION = 0.8;
/** The stillness check's frames, this many pixels wide. */
const STILL_WIDTH = 320;
/** Bumped when the request changes, so cached answers to the old one are not reused. */
const VERSION = 1;

const SYSTEM = `\
You find things on screen in frames of screen recordings. You get one frame and what the \
speaker says as it shows. Box the one thing on screen they refer to, tight around it: a button, \
a field, a line of code, a number. Answer found false when it is not on screen, is hidden, or is \
not one thing you can box.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["found", "left", "top", "right", "bottom"],
  properties: {
    found: { type: "boolean" },
    left: { type: "integer", description: "Pixels from the frame's left edge." },
    top: { type: "integer" },
    right: { type: "integer" },
    bottom: { type: "integer" },
  },
} as const;

/** What the planner asked to point at: the words that name it in a line of a file. */
export interface CalloutWish {
  source: string;
  line: number;
  /** The words that name it, as in the line. */
  text: string;
  /** What to look for on screen, in a few words. */
  target: string;
  label: string;
  reason: string;
}

/** A thing found on a screen recording: where it is, as fractions of the source's picture, and
 * when it is named, by the first of the words that name it. */
export interface Located {
  source: string;
  /** The index of the first word naming it. */
  word: number;
  rect: Rect;
}

/** A reply as it is cached: the box in fractions of the frame, or none. */
interface Answer {
  rect: Rect | null;
}

/** The key under which a wish's answer is kept for a plan: a wish names the same thing however
 * often the plan is written. */
export const wishKey = (wish: CalloutWish) =>
  JSON.stringify([wish.source, wish.line, wish.text, wish.target]);

/**
 * Finds each wish's thing on screen. A wish counts only when its words are in the line, the
 * moment the first is said falls in a shot of a screen recording (the index's framing), and
 * Claude finds the thing on the frame on screen then. Answers are cached in `cache` (default
 * under cacheDir()); every request made is added to `usage`. A request Claude declines or that
 * fails leaves its callout out.
 */
export async function locate(
  wishes: readonly CalloutWish[],
  sources: ReadonlyMap<string, PlanSource>,
  claude: Claude,
  usage: Usage[],
  cache = join(cacheDir(), "regions"),
): Promise<Map<string, Located>> {
  const found = new Map<string, Located>();
  const work = await mkdtemp(join(tmpdir(), "locate-"));
  try {
    for (const wish of wishes) {
      const source = sources.get(wish.source);
      const line = source?.lines.find((l) => l.n === wish.line);
      const words = source && line && findWords(source.words, line.first, line.last, wish.text);
      if (!source?.index || !line || !words || found.has(wishKey(wish))) continue;
      const said = source.words[words[0]]?.start ?? 0;
      if (!onScreen(source, said, said)) continue;
      const text = joinWords(source.words.slice(line.first, line.last + 1).map((w) => w.text));
      const key = createHash("sha256")
        .update(
          JSON.stringify([
            VERSION,
            LOCATE_MODEL,
            source.fingerprint.sha256,
            said,
            wish.target,
            text,
          ]),
        )
        .digest("hex");
      const file = join(cache, `${key.slice(0, 32)}.json`);
      let answer: Answer;
      try {
        answer = JSON.parse(await readFile(file, "utf8")) as Answer;
      } catch {
        try {
          answer = await ask(
            claude,
            usage,
            await frame(source.path, said, work),
            wish.target,
            text,
          );
        } catch (error) {
          // A request declined or failed leaves that callout out, not the edit; asked again
          // next time.
          if (error instanceof ClaudeError) continue;
          throw error;
        }
        await mkdir(cache, { recursive: true });
        await writeFile(file, `${JSON.stringify(answer)}\n`);
      }
      if (answer.rect) {
        found.set(wishKey(wish), { source: source.id, word: words[0], rect: answer.rect });
      }
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  return found;
}

/** Whether one shot of a screen recording, with or without a webcam in a corner, runs from
 * `from` to `to` seconds of the source. */
function onScreen(source: PlanSource, from: number, to: number): boolean {
  return (source.index?.framing?.shots ?? []).some(
    (s) => (s.layout === "screen" || s.layout === "screen_cam") && s.start <= from && s.end >= to,
  );
}

/** A main-track clip as the plan writes it, framed. */
export interface Played {
  source: string;
  in: number;
  out: number;
  framing?: Framing;
}

/**
 * Where a found thing shows in the output frame, as fractions of it, for a callout from output
 * tick `start` for `duration`, or undefined when it does not show whole and still all that
 * time. The clips under the callout must all play its source within shots of a screen
 * recording, one cut to the next being a jump cut, under one still framing with the whole region
 * inside it; and the region must look as it did on the frame it was found on, at the first and
 * last frame each clip plays of it; `output.frame` is the output's frame in ticks. `stills` keeps those comparisons, by source, region and time.
 */
export async function calloutRect(
  source: PlanSource,
  main: readonly Played[],
  located: Located,
  start: number,
  duration: number,
  output: { width: number; height: number; frame: number },
  stills: Map<string, boolean>,
): Promise<Rect | undefined> {
  const video = source.index?.source.video;
  if (!video) return undefined;
  const aspect = displayAspect(video.width, video.height, video.sample_aspect);
  const end = start + duration;
  const times: number[] = [];
  let shown: Rect | undefined;
  let at = 0;
  for (const clip of main) {
    const length = clip.out - clip.in;
    const from = Math.max(start, at);
    const to = Math.min(end, at + length);
    at += length;
    if (to <= from) continue;
    if (clip.source !== located.source) return undefined;
    const a = clip.in + from - at + length;
    // The last frame the clip shows of it, one output frame before its end.
    const b = Math.max(a, clip.in + to - at + length - output.frame);
    if (!onScreen(source, a / TICKS_PER_SECOND, b / TICKS_PER_SECOND)) return undefined;
    for (const t of [a, b]) {
      const rect = visible(clip.framing, t, aspect, output);
      shown ??= rect;
      const moved = (["x", "y", "w", "h"] as const).some(
        (k) => Math.abs(rect[k] - (shown as Rect)[k]) > 1e-4,
      );
      if (moved) return undefined;
      times.push(t / TICKS_PER_SECOND);
    }
  }
  if (!shown) return undefined;
  const { x, y, w, h } = located.rect;
  const inside =
    x >= shown.x - 1e-3 &&
    y >= shown.y - 1e-3 &&
    x + w <= shown.x + shown.w + 1e-3 &&
    y + h <= shown.y + shown.h + 1e-3;
  if (!inside) return undefined;
  const said = source.words[located.word]?.start ?? 0;
  for (const t of times) {
    const key = JSON.stringify([source.path, located.rect, said, t]);
    if (!stills.has(key)) stills.set(key, await still(source.path, located.rect, said, t));
    if (!stills.get(key)) return undefined;
  }
  const round = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 1e4) / 1e4;
  return {
    x: round((x - shown.x) / shown.w),
    y: round((y - shown.y) / shown.h),
    w: round(w / shown.w),
    h: round(h / shown.h),
  };
}

/** The frame on screen at `seconds`, upright, with square pixels, at most FRAME_WIDTH wide. */
async function frame(path: string, seconds: number, dir: string) {
  const out = join(dir, `frame-${seconds.toFixed(3)}.png`);
  await run(await ffmpeg(), [
    ...QUIET,
    "-y",
    "-ss",
    decimal(seconds),
    "-i",
    path,
    "-frames:v",
    "1",
    "-vf",
    `scale='min(${FRAME_WIDTH},iw*sar)':-2,setsar=1`,
    "-f",
    "image2",
    "-vcodec",
    "png",
    out,
  ]);
  const png = await readFile(out);
  // A PNG's IHDR chunk holds its width and height.
  return { png, width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

async function ask(
  claude: Claude,
  usage: Usage[],
  image: { png: Buffer; width: number; height: number },
  target: string,
  line: string,
): Promise<Answer> {
  const { width, height } = image;
  const reply = await claude({
    purpose: "locate",
    model: LOCATE_MODEL,
    system: SYSTEM,
    content: [
      { type: "image", png: image.png },
      {
        type: "text",
        text: `This frame is ${width} x ${height} pixels. As it shows, the speaker says: "${line}" Find ${target}, and give its box in pixels of this frame.`,
      },
    ],
    schema: SCHEMA,
    effort: "low",
    maxTokens: 2000,
  });
  usage.push(reply.usage);
  const box = reply.json as {
    found: boolean;
    left: number;
    top: number;
    right: number;
    bottom: number;
  };
  const x0 = Math.max(0, box.left) / width;
  const y0 = Math.max(0, box.top) / height;
  const x1 = Math.min(width, box.right) / width;
  const y1 = Math.min(height, box.bottom) / height;
  const area = (x1 - x0) * (y1 - y0);
  if (!box.found || x1 <= x0 || y1 <= y0 || area < SMALLEST || area > LARGEST) {
    return { rect: null };
  }
  const round = (v: number) => Math.round(v * 1e4) / 1e4;
  return { rect: { x: round(x0), y: round(y0), w: round(x1 - x0), h: round(y1 - y0) } };
}

/** Whether the region looks the same at `to` seconds of the source as at `from`. */
async function still(path: string, rect: Rect, from: number, to: number): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), "still-"));
  let a: Grey;
  let b: Grey;
  try {
    [a, b] = await Promise.all([grey(path, from, dir), grey(path, to, dir)]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  const x0 = Math.floor(rect.x * a.width);
  const y0 = Math.floor(rect.y * a.height);
  const x1 = Math.max(x0 + 1, Math.ceil((rect.x + rect.w) * a.width));
  const y1 = Math.max(y0 + 1, Math.ceil((rect.y + rect.h) * a.height));
  const p: number[] = [];
  const q: number[] = [];
  for (let y = y0; y < Math.min(y1, a.height); y++) {
    for (let x = x0; x < Math.min(x1, a.width); x++) {
      p.push(a.pixels[y * a.width + x] ?? 0);
      q.push(b.pixels[y * b.width + x] ?? 0);
    }
  }
  const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const change = mean(p.map((v, i) => Math.abs(v - (q[i] ?? 0))));
  if (change < STILL_LEVEL) return true;
  const [mp, mq] = [mean(p), mean(q)];
  let cov = 0;
  let vp = 0;
  let vq = 0;
  for (const [i, v] of p.entries()) {
    const w = q[i] ?? 0;
    cov += (v - mp) * (w - mq);
    vp += (v - mp) ** 2;
    vq += (w - mq) ** 2;
  }
  return vp > 0 && vq > 0 && cov / Math.sqrt(vp * vq) >= STILL_CORRELATION;
}

export interface Grey {
  pixels: Uint8Array;
  width: number;
  height: number;
}

/** The frame on screen at `seconds` in grey, STILL_WIDTH wide: a region's fractions of the
 * picture are the same whatever shape its pixels are. */
export async function grey(path: string, seconds: number, dir: string): Promise<Grey> {
  const out = join(dir, `grey-${seconds.toFixed(3)}.raw`);
  await run(await ffmpeg(), [
    ...QUIET,
    "-y",
    "-ss",
    decimal(seconds),
    "-i",
    path,
    "-frames:v",
    "1",
    "-vf",
    `scale=${STILL_WIDTH}:-2:flags=area,format=gray`,
    "-f",
    "rawvideo",
    out,
  ]);
  const pixels = new Uint8Array(await readFile(out));
  return { pixels, width: STILL_WIDTH, height: pixels.length / STILL_WIDTH };
}
