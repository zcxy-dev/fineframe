// B-roll for each point the speaker makes, as a rich edit shows it: the planner names a stock
// search, a page to capture or a motion-graphics card for a line, and code sources it, checks it,
// times it on the speech, picks its layout and adds a sound only on a visible action.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { cardProblems, cards, isCardId, panelShare } from "@video-editor/effects";
import {
  type BrollClip,
  type CardClip,
  type MediaIndex,
  type Project,
  type Credit as ProjectCredit,
  type Rect,
  type SoundEffect,
  secondsToTicks,
} from "@video-editor/schema";
import { type Capture, capturePage, checkedUrl, openCaptureBrowser } from "../broll/capture.ts";
import type { Credit } from "../broll/credits.ts";
import { pickSfx, SFX_LICENSE, type SfxKind } from "../broll/sfx.ts";
import { findStock, stockProviders } from "../broll/stock.ts";
import { cacheDir } from "../download.ts";
import { cropPath } from "../framing.ts";
import { fingerprintOf } from "../sources.ts";
import type { TimedWord } from "./captions.ts";
import { CHECK_MODEL, type Claude, type Usage } from "./claude.ts";
import { findWords } from "./fillers.ts";
import type { Line } from "./pack.ts";

/** How rich an edit is with B-roll: `rich` shows a visual on its points, `minimal` none. */
export type Visuals = "rich" | "minimal";
export const VISUALS: readonly Visuals[] = ["rich", "minimal"];

/** The sounds a visual may ask for: the kinds of sound effects there are. */
export const SFX_WISHES = ["click", "tap", "paper", "tone", "stop", "whoosh"] as const;

/** One visual as the planner proposes it, on a line and the words it lands on. */
/**
 * The plan's visuals, which it gives as one JSON array in a string: an array of objects in the
 * plan's schema, with every other extra on, makes a grammar too large for structured outputs to
 * compile. Each entry is kept only when every field has its type; the rest are reported and left
 * out, and stock footage only when it can be searched.
 */
export function parseVisuals(
  text: string,
  stock: boolean,
  onProblem: (problem: string) => void = () => {},
): VisualWish[] {
  if (text.trim() === "") return [];
  let entries: unknown;
  try {
    entries = JSON.parse(text);
  } catch {
    onProblem("The plan's visuals are not JSON; the edit has none");
    return [];
  }
  if (!Array.isArray(entries)) {
    onProblem("The plan's visuals are not a list; the edit has none");
    return [];
  }
  const kinds: readonly string[] = stock ? ["stock", "web", "card"] : ["web", "card"];
  const sounds: readonly string[] = ["none", ...SFX_WISHES];
  const wishes: VisualWish[] = [];
  for (const entry of entries) {
    const e = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
    const text = (key: string) => (e[key] === undefined ? "" : e[key]);
    const fields = {
      source: e.source,
      line: e.line,
      text: e.text,
      kind: e.kind,
      query: text("query"),
      url: text("url"),
      focus: text("focus"),
      card: text("card"),
      params: text("params"),
      sfx: e.sfx === undefined ? "none" : e.sfx,
      reason: text("reason"),
    };
    const strings = [
      "source",
      "text",
      "query",
      "url",
      "focus",
      "card",
      "params",
      "reason",
    ] as const;
    const ok =
      strings.every((key) => typeof fields[key] === "string") &&
      Number.isInteger(fields.line) &&
      kinds.includes(fields.kind as string) &&
      sounds.includes(fields.sfx as string);
    if (ok) wishes.push(fields as VisualWish);
    else onProblem(`Left out a visual the plan gave in another shape: ${JSON.stringify(entry)}`);
  }
  return wishes;
}

export interface VisualWish {
  source: string;
  line: number;
  text: string;
  kind: "stock" | "web" | "card";
  /** stock: what to search for, in English. */
  query: string;
  /** web: the page. */
  url: string;
  /** web: the words on the page to zoom into, or empty for its first screen. */
  focus: string;
  /** card: which, and its params as JSON. */
  card: string;
  params: string;
  sfx: "none" | (typeof SFX_WISHES)[number];
  reason: string;
}

/** A visual sourced and checked, ready to place. */
export type Asset =
  | { kind: "card"; card: string; params: Record<string, unknown> }
  | {
      kind: "image";
      path: string;
      width: number;
      height: number;
      /** What to zoom into, in the image's pixels. */
      focus: Capture["focus"];
      credit: Credit;
    }
  | { kind: "video"; path: string; seconds: number; id: string; credit: Credit };

/** Where visuals go: the whole frame, or the upper panel of a split screen with the speaker
 * below. */
type Layout = "full" | "panel";

/** The longest the speaker leaves the screen, as short-form editors keep it, and the longest a
 * split screen holds. */
export const FULL_MAX = 3.5;
export const PANEL_MAX = 6;
/** The shortest a capture or footage shows, and the shortest stretch of the speaker alone
 * between two visuals. */
const VISUAL_MIN = 1.5;
const SPEAKER_GAP = 1;
/** At most one visual this many seconds of the edit, and one sound effect. */
const VISUAL_EVERY = 5;
const SFX_EVERY = 6;
/** How long a capture shows unless its line ends first. */
const CAPTURE_SECONDS = 4;
/** A visual stays up this long after its line's last word. */
const LINE_TAIL = 0.4;
/** How far a still zooms in over its time on screen. */
const KEN_BURNS = 1.08;
/** A capture is zoomed so the words it was asked for take at most this share of its width. */
const FOCUS_SHARE = 0.75;
/** Sound effects sit well under the voice: the files peak near 0 dBFS. */
const SFX_GAIN: Record<SfxKind, number> = {
  click: -16,
  tap: -16,
  stop: -16,
  paper: -12,
  tone: -14,
  whoosh: -14,
};

/** A wish's key: a visual is sourced once per plan, however often the edit is fitted again. */
export const visualKey = (wish: VisualWish) =>
  JSON.stringify([wish.kind, wish.query, wish.url, wish.focus, wish.card, wish.params]);

/** Why a wish cannot be shown, or null when it can be sourced: a card whose params break its
 * schema, an address a capture may not open, or a stock search with no key to make it. */
const REPAIR_SYSTEM = `You fix the params of animated motion-graphics cards so they pass each \
card's JSON Schema. Keep the meaning, the speaker's language and every number; shorten text to \
its limit with fewer words, never by cutting a word; never invent a figure. Give each card's \
fixed params as a JSON object written as a string, in the order given.`;

/**
 * The wishes with each card whose params break its card's schema rewritten once by
 * CHECK_MODEL, from the schema and the problems found. A fix that still breaks it, and every
 * card when the request fails, stays as it was, to be left out with its reason.
 */
export async function repairCards(
  wishes: readonly VisualWish[],
  claude: Claude,
  usage: Usage[],
): Promise<VisualWish[]> {
  const broken = wishes.flatMap((wish, at) => {
    if (wish.kind !== "card" || !isCardId(wish.card)) return [];
    const problem = wishProblem(wish, false);
    return problem && !/not JSON|not an object/.test(problem) ? [{ at, wish, problem }] : [];
  });
  if (broken.length === 0) return [...wishes];
  const asked = broken
    .map(
      ({ wish, problem }, i) =>
        `${i + 1}. Card ${wish.card}, its schema ${JSON.stringify(cards[wish.card as keyof typeof cards].params)}\nParams: ${wish.params}\nProblems: ${problem}`,
    )
    .join("\n\n");
  let fixed: unknown[];
  try {
    const reply = await claude({
      purpose: "repair",
      model: CHECK_MODEL,
      system: REPAIR_SYSTEM,
      content: [{ type: "text", text: asked }],
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["fixed"],
        properties: { fixed: { type: "array", items: { type: "string" } } },
      },
      effort: "low",
      maxTokens: 8000,
    });
    usage.push(reply.usage);
    fixed = (reply.json as { fixed?: unknown[] }).fixed ?? [];
  } catch {
    return [...wishes];
  }
  const repaired = [...wishes];
  broken.forEach(({ at, wish }, i) => {
    const params = fixed[i];
    if (typeof params !== "string") return;
    const candidate = { ...wish, params };
    if (wishProblem(candidate, false) === null) repaired[at] = candidate;
  });
  return repaired;
}

export function wishProblem(wish: VisualWish, stock: boolean): string | null {
  if (wish.kind === "card") {
    if (!isCardId(wish.card)) return `no card ${wish.card}`;
    let params: unknown;
    try {
      params = JSON.parse(wish.params);
    } catch {
      return `its params are not JSON: ${wish.params}`;
    }
    if (typeof params !== "object" || params === null || Array.isArray(params)) {
      return "its params are not an object";
    }
    const problems = cardProblems([{ card: wish.card, params }], "/card");
    return problems.length > 0 ? problems.join("; ") : null;
  }
  if (wish.kind === "web") {
    try {
      const url = checkedUrl(wish.url);
      if (
        /(^|\.)(google|bing|duckduckgo|yahoo)\./.test(url.hostname) &&
        url.pathname.startsWith("/search")
      ) {
        return "a search page shows no product";
      }
    } catch (error) {
      return (error as Error).message;
    }
    return null;
  }
  if (wish.kind === "stock") {
    if (!stock) return "no stock footage key";
    return wish.query.trim() ? null : "no search";
  }
  return `no kind ${wish.kind}`;
}

/** Whether stock footage can be searched: a Pexels or Pixabay key is set. */
export function stockAvailable(): boolean {
  return stockProviders().length > 0;
}

/** The layout a visual of `kind` takes when shown for `seconds`: at 9:16, captures and anything
 * longer than the speaker may be away split the screen, and the rest fill it; other aspects have
 * no split. */
function layoutOf(
  aspect: Project["output"]["aspect"],
  kind: Asset["kind"],
  seconds: number,
): Layout {
  if (aspect !== "9:16") return "full";
  if (kind === "image") return "panel";
  return seconds > FULL_MAX ? "panel" : "full";
}

/** The size of a panel or the frame, in output pixels. */
function boxOf(layout: Layout, output: Pick<Project["output"], "aspect" | "width" | "height">) {
  if (layout === "full") return { width: output.width, height: output.height };
  return {
    width: output.width,
    height: Math.round((panelShare(output.aspect) * output.height) / 2) * 2,
  };
}

/**
 * Sources each wish not sourced yet, at most `limit` of them: a card is checked, a page captured
 * in a viewport of the shape it will fill, footage searched. A wish that cannot be shown, or whose
 * source fails, gets null, and its line keeps the speaker; `onProblem` hears why.
 */
export async function sourceVisuals(
  wishes: readonly VisualWish[],
  assets: Map<string, Asset | null>,
  options: {
    output: Pick<Project["output"], "aspect" | "width" | "height">;
    stock: boolean;
    onProblem: (message: string) => void;
    /** Where captures are kept: `<cache>/broll/captures` unless given. */
    dir?: string;
    capture?: typeof capturePage;
    findStock?: typeof findStock;
  },
): Promise<void> {
  const dir = options.dir ?? join(cacheDir(), "broll", "captures");
  const fresh = wishes.filter((wish) => !assets.has(visualKey(wish)));
  const used: string[] = [];
  let browser: Awaited<ReturnType<typeof openCaptureBrowser>> | undefined;
  try {
    for (const wish of fresh) {
      const key = visualKey(wish);
      if (assets.has(key)) continue;
      const problem = wishProblem(wish, options.stock);
      if (problem) {
        options.onProblem(`Left out a visual on ${wish.source} line ${wish.line}: ${problem}`);
        assets.set(key, null);
        continue;
      }
      try {
        if (wish.kind === "card") {
          assets.set(key, { kind: "card", card: wish.card, params: JSON.parse(wish.params) });
        } else if (wish.kind === "web") {
          const box = boxOf(
            layoutOf(options.output.aspect, "image", CAPTURE_SECONDS),
            options.output,
          );
          const capture = options.capture ?? capturePage;
          if (!options.capture) browser ??= await openCaptureBrowser();
          assets.set(key, await captured(wish, box, dir, capture, browser));
        } else {
          const portrait = options.output.aspect === "9:16";
          const clip = await (options.findStock ?? findStock)({
            query: wish.query,
            orientation: portrait ? "portrait" : "landscape",
            minSeconds: FULL_MAX,
            size: Math.min(options.output.width, options.output.height),
            exclude: used,
            onProblem: options.onProblem,
          });
          if (!clip) throw new Error(`no stock footage of "${wish.query}"`);
          used.push(`${clip.provider}:${clip.id}`);
          assets.set(key, {
            kind: "video",
            path: clip.path,
            seconds: clip.seconds,
            id: `${clip.provider}:${clip.id}`,
            credit: clip.credit,
          });
        }
      } catch (error) {
        options.onProblem(
          `Left out a visual on ${wish.source} line ${wish.line}: ${(error as Error).message}`,
        );
        assets.set(key, null);
      }
    }
  } finally {
    await browser?.close();
  }
}

/** A page captured once into the cache, at twice the pixels of the box it fills, in a viewport
 * of the box's shape; a capture made before is read back. */
async function captured(
  wish: VisualWish,
  box: { width: number; height: number },
  dir: string,
  capture: typeof capturePage,
  browser: Awaited<ReturnType<typeof openCaptureBrowser>> | undefined,
): Promise<Asset> {
  // CSS pixels: half the box at 2x, at least a laptop's width so pages lay out as on a desktop.
  const width = Math.max(1100, Math.round(box.width / 2));
  const viewport = { width, height: Math.round((width * box.height) / box.width) };
  const name = createHash("sha256")
    .update(JSON.stringify([wish.url, wish.focus, viewport]))
    .digest("hex")
    .slice(0, 32);
  const out = join(dir, `${name}.png`);
  const facts = join(dir, `${name}.json`);
  if (existsSync(out) && existsSync(facts)) {
    return {
      kind: "image",
      path: out,
      ...(JSON.parse(await readFile(facts, "utf8")) as Omit<Capture, "path" | "kind">),
    };
  }
  await mkdir(dir, { recursive: true });
  const focus = wish.focus.trim();
  // A padding wider than the viewport keeps the whole screen around the words, to zoom into.
  const shot = await capture({
    url: wish.url,
    out,
    viewport,
    ...(focus ? { text: focus, padding: 4 * viewport.width } : {}),
    ...(browser ? { browser } : {}),
  }).catch(async (error) => {
    // Words not on the page still leave the page worth showing.
    if (!focus) throw error;
    return capture({ url: wish.url, out, viewport, ...(browser ? { browser } : {}) });
  });
  const { width: w, height: h, focus: box2, credit } = shot;
  await writeFile(facts, `${JSON.stringify({ width: w, height: h, focus: box2, credit })}\n`);
  return { kind: "image", path: out, width: w, height: h, focus: box2, credit };
}

/** A visual placed on the output timeline, in ticks, with its layout. */
export interface PlacedVisual {
  wish: VisualWish;
  asset: Asset;
  start: number;
  end: number;
  layout: Layout;
}

/**
 * Places the sourced visuals on the speech: each from the first of its words as said, or after a
 * title, chapter marker or name in `blocked` it would start under while its line is still said,
 * for its card's typical length, a capture's CAPTURE_SECONDS or its footage's, running on over
 * the words after it, up to FULL_MAX full frame or PANEL_MAX split, on the frame grid. One that
 * would come within SPEAKER_GAP of the one before, run shorter than it may or come more often
 * than one every VISUAL_EVERY seconds is left out, earliest first, with its reason.
 */
export function placeVisuals(
  wishes: readonly VisualWish[],
  assets: ReadonlyMap<string, Asset | null>,
  context: {
    words: readonly TimedWord[];
    lines: (source: string, n: number) => Line | undefined;
    sourceWords: (source: string) => readonly { text: string; start: number; end: number }[];
    edit: number;
    frame: number;
    aspect: Project["output"]["aspect"];
    blocked?: readonly { start: number; end: number }[];
    /** Told why each visual left out was. */
    onLeftOut?: (wish: VisualWish, reason: string) => void;
  },
): PlacedVisual[] {
  const { words, frame, edit } = context;
  const leftOut = (wish: VisualWish, reason: string) => context.onLeftOut?.(wish, reason);
  const onFrame = (ticks: number) => Math.round(ticks / frame) * frame;
  const s = secondsToTicks;
  const wanted = wishes.flatMap((wish) => {
    const asset = assets.get(visualKey(wish));
    const line = context.lines(wish.source, wish.line);
    if (!asset) return [];
    if (!line) {
      leftOut(wish, "its line does not play");
      return [];
    }
    const inLine = words.filter(
      (w) => w.source === wish.source && w.index >= line.first && w.index <= line.last,
    );
    if (inLine.length === 0) {
      leftOut(wish, "its line's words were cut");
      return [];
    }
    const found = findWords(
      context.sourceWords(wish.source) as never,
      line.first,
      line.last,
      wish.text,
    );
    const first = (found && inLine.find((w) => w.index >= found[0])) ?? inLine[0];
    if (!first) return [];
    const lineEnd = Math.max(...inLine.map((w) => w.end)) + s(LINE_TAIL);
    return [{ wish, asset, start: onFrame(first.start), lineEnd }];
  });
  wanted.sort((a, b) => a.start - b.start);
  const most = Math.max(1, Math.floor(edit / s(VISUAL_EVERY)));
  const placed: PlacedVisual[] = [];
  for (const item of wanted) {
    if (placed.length >= most) {
      leftOut(item.wish, `more than one every ${VISUAL_EVERY} s`);
      continue;
    }
    const { asset } = item;
    const before = placed.at(-1);
    // Under a title, chapter or name, a visual waits for it to end while its line is said.
    const under = (context.blocked ?? []).find(
      (b) => item.start < b.end && b.start < item.start + s(VISUAL_MIN),
    );
    const start = under ? onFrame(Math.ceil(under.end / frame) * frame) : item.start;
    if (under && start > item.lineEnd - s(LINE_TAIL)) {
      leftOut(item.wish, "it would start under a title, chapter or name");
      continue;
    }
    if (before && start < before.end + s(SPEAKER_GAP)) {
      leftOut(item.wish, "too close to the visual before");
      continue;
    }
    const [least, wantedSeconds] =
      asset.kind === "card"
        ? [
            cards[asset.card as keyof typeof cards].seconds.min,
            cards[asset.card as keyof typeof cards].seconds.typical,
          ]
        : asset.kind === "image"
          ? [VISUAL_MIN, CAPTURE_SECONDS]
          : [VISUAL_MIN, Math.min(asset.seconds, FULL_MAX)];
    const layout = layoutOf(context.aspect, asset.kind, wantedSeconds);
    const cap = layout === "full" ? FULL_MAX : PANEL_MAX;
    const blockedAfter = (context.blocked ?? [])
      .filter((b) => b.start >= start)
      .map((b) => b.start);
    let end = Math.min(start + s(Math.min(wantedSeconds, cap)), edit, ...blockedAfter);
    end = Math.floor(end / frame) * frame;
    if (end - start < s(least) - frame / 2) {
      leftOut(item.wish, "too little time before its line ends or something it may not cover");
      continue;
    }
    placed.push({ wish: item.wish, asset, start, end, layout });
  }
  return placed;
}

/**
 * A visual's path in a project written to `folder`: relative to it, or, when no relative path
 * reaches it (another drive on Windows, where relative() gives back an absolute path), the path
 * of a copy kept beside the project in `visuals/`.
 */
export async function visualPath(
  folder: string,
  file: string,
  relativeTo: (from: string, to: string) => string = relative,
): Promise<string> {
  const path = relativeTo(folder, file);
  if (!isAbsolute(path)) return path.split(sep).join("/");
  const name = `${createHash("sha256").update(file).digest("hex").slice(0, 8)}-${basename(file)}`;
  const copy = join(folder, "visuals", name);
  if (!existsSync(copy)) {
    await mkdir(join(folder, "visuals"), { recursive: true });
    await copyFile(file, copy);
  }
  return `visuals/${name}`;
}

/** What the placed visuals add to the project: B-roll and the sources it shows, cards and sound
 * effects, each source with its credit. Ids start with `visual-`. */
export async function visualParts(
  placed: readonly PlacedVisual[],
  output: Pick<Project["output"], "aspect" | "width" | "height">,
  folderPath: (file: string) => string | Promise<string>,
): Promise<{
  sources: Project["sources"][number][];
  broll: BrollClip[];
  cards: CardClip[];
  sfx: SoundEffect[];
}> {
  const sources: Project["sources"][number][] = [];
  const broll: BrollClip[] = [];
  const cardClips: CardClip[] = [];
  const sfx: SoundEffect[] = [];
  const ids = new Map<string, string>();
  const sourceFor = async (path: string, kind: "video" | "image" | "audio", credit: Credit) => {
    const known = ids.get(path);
    if (known) return known;
    const id = `visual-${ids.size + 1}`;
    ids.set(path, id);
    sources.push({
      id,
      kind,
      path: await folderPath(path),
      fingerprint: await fingerprintOf(path),
      credit: projectCredit(credit),
    });
    return id;
  };
  let lastSound = -Infinity;
  let sounds = 0;
  for (const visual of placed) {
    const { asset, start, end, layout } = visual;
    const duration = end - start;
    const rect =
      layout === "panel" ? { x: 0, y: 0, w: 1, h: panelShare(output.aspect) } : undefined;
    if (asset.kind === "card") {
      cardClips.push({
        card: asset.card,
        params: asset.params,
        start,
        duration,
        placement: layout,
      });
    } else if (asset.kind === "image") {
      const source = await sourceFor(asset.path, "image", asset.credit);
      const box = boxOf(layout, output);
      broll.push({
        source,
        in: 0,
        out: duration,
        start,
        ...(rect ? { rect } : {}),
        framing: stillFraming(asset, box, duration),
      });
    } else {
      const source = await sourceFor(asset.path, "video", asset.credit);
      broll.push({
        source,
        in: 0,
        out: Math.min(duration, secondsToTicks(asset.seconds)),
        start,
        ...(rect ? { rect } : {}),
      });
    }
    const wish = visual.wish.sfx;
    if (wish !== "none" && start - lastSound >= secondsToTicks(SFX_EVERY)) {
      const sound = pickSfx(wish, sounds++);
      const source = await sourceFor(sound.path, "audio", sfxCredit(sound.path, sound.source));
      sfx.push({ source, start, gainDb: SFX_GAIN[wish] });
      lastSound = start;
    }
  }
  return { sources, broll, cards: cardClips, sfx };
}

/** A still's framing: the box's shape around the words it was captured for, zoomed so they take
 * at most FOCUS_SHARE of its width but never past the still's own pixels, then a slow push in on
 * them; the whole still, pushed in about its middle, without. */
export function stillFraming(
  still: { width: number; height: number; focus: Capture["focus"] },
  box: { width: number; height: number },
  duration: number,
): NonNullable<BrollClip["framing"]> {
  const shape = box.width / box.height;
  // The largest crop of the box's shape, in the still's pixels.
  const fullW = Math.min(still.width, still.height * shape);
  let w = fullW;
  const focus = still.focus;
  if (focus) w = Math.min(fullW, Math.max(box.width, focus.width / FOCUS_SHARE));
  const h = w / shape;
  const cx = focus ? focus.x + focus.width / 2 : still.width / 2;
  const cy = focus ? focus.y + focus.height / 2 : still.height / 2;
  const x = Math.min(Math.max(cx - w / 2, 0), still.width - w);
  const y = Math.min(Math.max(cy - h / 2, 0), still.height - h);
  const rect: Rect = {
    x: x / still.width,
    y: y / still.height,
    w: w / still.width,
    h: h / still.height,
  };
  const anchor = { x: round(clamp01((cx - x) / w)), y: round(clamp01((cy - y) / h)) };
  return {
    crop: { type: "static", rect: tidy(rect) },
    scale: {
      type: "path",
      keyframes: [
        { t: 0, scale: 1 },
        { t: duration, scale: KEN_BURNS },
      ],
    },
    anchor,
  };
}

/**
 * The speaker beside each split screen: the main track's own picture in the lower part of the
 * frame, in step with it, as B-roll framed on the faces for that shape. A split that spans a cut
 * is one clip for each main clip under it.
 */
export function speakerClips(
  placed: readonly PlacedVisual[],
  main: readonly { source: string; in: number; out: number }[],
  indexes: (source: string) => MediaIndex | null,
  output: Pick<Project["output"], "aspect" | "width" | "height">,
): BrollClip[] {
  const share = panelShare(output.aspect);
  const rect = { x: 0, y: share, w: 1, h: 1 - share };
  const box = { width: output.width, height: output.height - boxOf("panel", output).height };
  const clips: BrollClip[] = [];
  for (const visual of placed.filter((v) => v.layout === "panel")) {
    let at = 0;
    for (const clip of main) {
      const from = Math.max(visual.start, at);
      const to = Math.min(visual.end, at + clip.out - clip.in);
      if (to > from) {
        const clipIn = clip.in + from - at;
        const range = { in: clipIn, out: clipIn + to - from };
        const index = indexes(clip.source);
        const crop = index && cropPath(index, range, box);
        clips.push({
          source: clip.source,
          ...range,
          start: from,
          rect,
          ...(crop ? { framing: { crop } } : {}),
        });
      }
      at += clip.out - clip.in;
    }
  }
  return clips;
}

/** A sound effect's credit: CC0, from the pack its source names. */
function sfxCredit(path: string, source: string): Credit {
  const url = source.match(/\((https?:\/\/[^)]+)\)/)?.[1];
  const name = path.split(/[\\/]/).at(-1) ?? path;
  return {
    what: `Sound effect ${name}, from ${source.replace(/\s*\(.*\)$/, "")}`,
    source:
      url ?? "https://github.com/zcxy-dev/video-editor/blob/main/packages/engine/scripts/sfx.ts",
    license: SFX_LICENSE,
    by: null,
  };
}

/** A credit as project.json keeps it, without its empty parts. */
function projectCredit(credit: Credit): ProjectCredit {
  return {
    what: credit.what,
    source: credit.source,
    ...(credit.license ? { license: credit.license } : {}),
    ...(credit.by
      ? { by: { name: credit.by.name, ...(credit.by.url ? { url: credit.by.url } : {}) } }
      : {}),
    ...(credit.note ? { note: credit.note } : {}),
  };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const round = (value: number) => Math.round(value * 1e6) / 1e6;

/** A rect rounded to a millionth, kept inside the picture. */
function tidy(rect: Rect): Rect {
  const w = Math.min(1, round(rect.w));
  const h = Math.min(1, round(rect.h));
  return { x: Math.min(round(rect.x), 1 - w), y: Math.min(round(rect.y), 1 - h), w, h };
}
