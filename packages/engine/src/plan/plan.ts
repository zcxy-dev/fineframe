import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import {
  type Brand,
  type BrollClip,
  type Dropped,
  type Emphasis,
  type FrameRate,
  type Grade,
  loadJson,
  type MediaIndex,
  type MusicTrack,
  type Project,
  type Rect,
  secondsToTicks,
  TICKS_PER_SECOND,
  ticksPerFrame,
  validateMediaIndex,
  validateProject,
  type Word,
} from "@video-editor/schema";
import { type CaptionStyle, DEFAULT_CAPTIONS } from "../captions/presets.ts";
import { LENGTH_RANGE } from "../edit/length.ts";
import { CAMERA, cropPath } from "../framing.ts";
import { type AutoGrade, autoGrade } from "../grade.ts";
import { DEFAULT_LOOK } from "../looks.ts";
import { type ColourSample, matchColour } from "../match.ts";
import { punchIns, type ShotFacts } from "../punch.ts";
import { fingerprintOf, gridTicks } from "../sources.ts";
import { loudnessFor, planVoice } from "../voice.ts";
import { captionLines, EMOJI, outputWords, type TimedWord } from "./captions.ts";
import {
  anthropicClaude,
  type Claude,
  PLAN_MODELS,
  type Quality,
  totalUsage,
  type Usage,
} from "./claude.ts";
import { calloutSpan, plannedOverlays } from "./effects.ts";
import {
  DEFAULT_FILLERS,
  type FillerCandidate,
  type FillerMode,
  fillerCandidates,
  findWords,
} from "./fillers.ts";
import { BREATH_RANGE, fitLength, type Span } from "./fit.ts";
import { type GraphicWish, withGraphics, writeGraphics } from "./graphics.ts";
import { calloutRect, LOCATE_MODEL, type Located, locate, wishKey } from "./locate.ts";
import {
  describeMusic,
  fitMusic,
  lastBeat,
  loadMusic,
  type MusicInput,
  type MusicSource,
  outputBeats,
  snapToBeat,
  speechLoudness,
} from "./music.ts";
import {
  type Line,
  packSource,
  packStill,
  screenSpans,
  speechSeconds,
  splitLines,
} from "./pack.ts";
import {
  cuttableAfter,
  joinAt,
  lengthOf,
  type PlacedClip,
  type PlaceSource,
  placeClips,
  type Stretch,
} from "./place.ts";
import {
  type Decisions,
  moreRequest,
  type PlanExtras,
  planRequest,
  planSchema,
  planSystem,
} from "./prompt.ts";
import { stemMarks } from "./stem.ts";
import { bare, joinWords } from "./text.ts";
import {
  type Asset,
  type PlacedVisual,
  parseVisuals,
  placeVisuals,
  sourceVisuals,
  speakerClips,
  stockAvailable,
  type Visuals,
  visualKey,
  visualParts,
  visualPath,
} from "./visuals.ts";
import { callWindows } from "./windows.ts";

export type Aspect = Project["output"]["aspect"];

export { LENGTH_RANGE };

export const TOLERANCE = 0.05;
/** Planning requests per edit: the plan, and one more if code's fit comes out short. */
export const MAX_PLAN_CALLS = 2;
/** A target below this share of the footage's speech is a short edit of its strongest moments;
 * above it, the whole story is kept. */
const SHORT_SHARE = 0.5;
/** The shortest edit that opens on a title, which keeps the whole story: a title would cover a
 * short edit's hook, and take too large a share of an edit under a minute. */
const TITLE_SECONDS = 60;
/** The shortest edit divided into chapters (the chapter template's whenToUse). */
const CHAPTER_SECONDS = 120;
/** The most B-roll shown at once, in seconds, and its fade in and out. */
const BROLL_MAX = 8;
const BROLL_FADE = 0.25;

/**
 * What to plan from: a media index file, whose source file is the one it names next to it, or a
 * folder whose `*.index.json` and `index.json` files are read; an index with the file it
 * describes, wherever each is kept; or a still image, which the planner can show as B-roll.
 */
export type PlanInput = string | { index: string; source: string } | { image: string };

export interface PlanOptions {
  inputs: PlanInput[];
  /** Target length in seconds, LENGTH_RANGE inclusive. */
  length: number;
  aspect: Aspect;
  /** Where project.json is written; the paths in it are relative to its folder. */
  out: string;
  /** Music the edit may play: music indexes (`vework analyze-music`), or folders whose
   * `*.music.json` files are read, each next to its track, or indexes with their tracks wherever
   * each is kept. Claude picks the track that fits the content, or none. */
  music?: MusicInput[];
  /** The look over the whole edit (../looks.ts): DEFAULT_LOOK unless given, none with null. */
  look?: Look | null;
  /** Names of people said in the footage; a lower third shows only a name from these. */
  names?: string[];
  /** The caption style (../captions/presets.ts): DEFAULT_CAPTIONS unless given. */
  captions?: CaptionStyle;
  /** Shows the emoji Claude picks at the end of their captions; they are picked either way. */
  emoji?: boolean;
  /** The brand kit the edit renders in, its paths relative to `out`'s folder; it changes nothing
   * the plan asks Claude. */
  brand?: Brand;
  /** What the user asks of this edit, in their words, passed on in every planning request. */
  instructions?: string;
  /** Plans only from this stretch of the one video given, in seconds: the lines said wholly
   * inside it. */
  within?: { start: number; end: number };
  /** Plans a short edit of the strongest moments whatever the footage's length, as a short of
   * `pnpm edit --shorts` is. */
  short?: boolean;
  /** What the edit is about, in a sentence or two, said to the planner: a short's title and
   * description. */
  about?: string;
  /** The shortest the edit may be, in seconds, when the planner's choice reaches less than
   * `length` after every request: it is then fitted to the length it reaches, as a short is
   * within its range. Without it, such an edit fails. */
  least?: number;
  /** The model that plans, and judges the cut checks a review doubts: best unless given. */
  quality?: Quality;
  /** Which fillers are cut (./fillers.ts): DEFAULT_FILLERS unless given. */
  fillers?: FillerMode;
  /** `rich` (the default) adds Claude's motion graphics and shows B-roll on the edit's points,
   * sourced from free web captures and, with a Pexels or Pixabay key, stock footage; `minimal`
   * none. */
  visuals?: Visuals;
  /** Defaults to the Anthropic API. */
  claude?: Claude;
  onProgress?: (message: string) => void;
}

type Look = NonNullable<Grade["look"]>;

/** The length a short is fitted to when its plan reaches `seconds`, less than asked: those
 * seconds, whole, when they are at least `least`, the range's shortest; null under it. */
export function fittedLength(seconds: number, least: number): number | null {
  return seconds >= least ? Math.round(seconds) : null;
}

/** Fails when the footage cannot make the edit asked for; the message says why. */
export class PlanError extends Error {
  override name = "PlanError";
}

/** One source as the planner holds it. */
export interface PlanSource extends PlaceSource {
  /** The file's name without its extension, or its folder's name when file names repeat; the id
   * is this with only the characters an id allows. */
  name: string;
  kind: "video" | "image";
  /** Absolute paths; a still image has no media index. */
  path: string;
  indexPath: string | null;
  index: MediaIndex | null;
  lines: Line[];
  /** Words a review found clipped at a cut. */
  roomy: Set<number>;
  fingerprint: Project["sources"][number]["fingerprint"];
}

/** A segment the planner chose, resolved to its lines. */
interface Segment {
  source: string;
  lines: Line[];
  priority: number;
  reason: string;
}

/** Everything a plan was made from, so a review can change it and fit it again. */
export interface PlanState {
  length: number;
  aspect: Aspect;
  out: string;
  claude: Claude;
  /** The model that plans and judges doubtful cut checks. */
  planModel: string;
  sources: Map<string, PlanSource>;
  /** The music offered, by id, and how the request lists it; empty without music. */
  music: Map<string, MusicSource>;
  musicListing: string;
  /** Names a lower third may show. */
  names: string[];
  /** What the user asks of this edit, in their words; empty when nothing. */
  instructions: string;
  /** The shortest the edit may be fitted to when the plan reaches less than `length`. */
  least?: number;
  /** What the plan was asked for besides the edit. */
  extras: PlanExtras;
  fps: FrameRate;
  short: boolean;
  /** The packed transcripts, as the planner read them. */
  packed: string;
  candidates: FillerCandidate[];
  decisions: Decisions;
  segments: Segment[];
  /** Words cut inside the lines that play, by `source:word` key: confirmed fillers and false
   * starts. */
  cuts: Map<string, "filler" | "false_start">;
  /** Words a review took out, with why. */
  excluded: Map<string, string>;
  /** Cut words a review put back, because cutting them clipped the words beside them. */
  restored: Set<string>;
  /** grade.auto of each clip measured so far, by `source:in:out`. */
  grades: Map<string, AutoGrade>;
  /** Each clip's colour as measured for matching, by what it depends on (matchColour). */
  colours: Map<string, ColourSample>;
  /** What each callout points at on its screen recording, by wishKey; a callout whose thing was
   * not found has none. */
  regions: Map<string, Located>;
  /** Whether a found region looks at a time as it did when found, by calloutRect's key. */
  stills: Map<string, boolean>;
  /** Each visual the planner proposed, sourced, by visualKey; null for one that could not be. */
  assets: Map<string, Asset | null>;
  /** The graphics Claude wrote for the edit, once its cut was known; placed again on each fit. */
  graphics?: GraphicWish[];
  /** Whether the graphics were checked and fixed once: later fits leave out what fails. */
  graphicsFixed?: boolean;
  look: Look | null;
  /** The caption style. */
  captions: CaptionStyle;
  /** Whether the captions show their emoji. */
  emoji: boolean;
  brand?: Brand;
  /** The model that answered the last planning request. */
  model: string;
  planCalls: number;
  reviews: number;
  usage: Usage[];
  progress: (message: string) => void;
}

/** A planned edit: the project written to `path`, and what it was built from. */
export interface PlannedEdit {
  path: string;
  project: Project;
  assembly: Assembly;
  state: PlanState;
}

/**
 * Plans an edit of `inputs` to `length` seconds at `aspect`, writes it to `out` as a project.json
 * that validates and renders, and returns it with the state a review needs. Claude decides what
 * to use and in what order; code places every cut, fits the length and maps the captions.
 */
export async function plan(options: PlanOptions): Promise<PlannedEdit> {
  const [shortest, longest] = LENGTH_RANGE;
  if (!(options.length >= shortest && options.length <= longest)) {
    throw new PlanError(`The length must be ${shortest} to ${longest} s, not ${options.length}`);
  }
  const progress = options.onProgress ?? (() => {});
  const out = resolve(options.out);
  const sources = await loadSources(options.inputs);
  if (options.within) keepWithin(sources, options.within);
  let music = new Map<string, MusicSource>();
  try {
    if (options.music?.length) music = await loadMusic(options.music, new Set(sources.keys()));
  } catch (error) {
    throw new PlanError((error as Error).message, { cause: error });
  }
  const fillers = options.fillers ?? DEFAULT_FILLERS;
  const candidates: FillerCandidate[] = [];
  for (const source of sources.values()) {
    candidates.push(...fillerCandidates(source.id, source.words, fillers, candidates.length + 1));
  }
  const speech = [...sources.values()].reduce((sum, s) => sum + speechSeconds(s.words, s.lines), 0);
  if (speech === 0) throw new PlanError("None of the files has speech to edit");
  const fps = outputRate(sources);
  // Every word played, each pause cut to the longest breath: no edit of this footage runs
  // longer, so a target past it fails here instead of after two paid requests.
  const whole = lengthOf(placeAll(sources, ticksPerFrame(fps))) / TICKS_PER_SECOND;
  if (whole < Math.min(options.length, options.least ?? options.length) * (1 - TOLERANCE)) {
    throw new PlanError(
      `The footage holds too little speech for ${options.length} s: all of it, with every ` +
        `pause cut to a breath, lasts ${whole.toFixed(1)} s, and less once retakes and fillers ` +
        `are left out. ${shorterAsk(whole)}`,
    );
  }
  const packed = [...sources.values()]
    .map((s) =>
      s.index
        ? packSource(
            s.id,
            s.index,
            s.lines,
            candidates.filter((c) => c.source === s.id),
            s.name,
          )
        : packStill(s.id, s.name, BROLL_MAX),
    )
    .join("\n\n");

  const short = options.short ?? options.length < SHORT_SHARE * speech;
  const names = (options.names ?? []).map((name) => name.trim()).filter(Boolean);
  const instructions = options.instructions?.trim() ?? "";
  const state: PlanState = {
    length: options.length,
    aspect: options.aspect,
    out,
    claude: options.claude ?? anthropicClaude(),
    planModel: PLAN_MODELS[options.quality ?? "best"],
    sources,
    music,
    musicListing: music.size > 0 ? describeMusic(music.values()) : "",
    names,
    instructions,
    ...(options.least === undefined ? {} : { least: options.least }),
    extras: {
      music: music.size > 0,
      title: !short && options.length >= TITLE_SECONDS,
      chapters: options.length >= CHAPTER_SECONDS,
      people: names.length > 0,
      callouts: [...sources.values()].some((s) => s.index && screenSpans(s.index).length > 0),
      visuals: (options.visuals ?? "rich") === "rich",
      stock: (options.visuals ?? "rich") === "rich" && stockAvailable(),
      fillers,
    },
    fps,
    short,
    packed,
    candidates,
    decisions: emptyDecisions(),
    segments: [],
    cuts: new Map(),
    excluded: new Map(),
    restored: new Set(),
    grades: new Map(),
    colours: new Map(),
    regions: new Map(),
    stills: new Map(),
    assets: new Map(),
    look: options.look === undefined ? DEFAULT_LOOK : options.look,
    captions: options.captions ?? DEFAULT_CAPTIONS,
    emoji: options.emoji ?? false,
    ...(options.brand ? { brand: options.brand } : {}),
    model: PLAN_MODELS[options.quality ?? "best"],
    planCalls: 0,
    reviews: 0,
    usage: [],
    progress,
  };
  const request = planRequest({
    target: options.length,
    aspect: options.aspect,
    short: state.short,
    speech,
    music: state.musicListing,
    title: state.extras.title,
    chapters: state.extras.chapters,
    names,
    instructions,
    ...(options.about ? { about: options.about } : {}),
  });
  progress(`Planning ${state.short ? "a short" : "a long"} edit with ${state.planModel}`);
  await decide(state, request);
  return write(state, await assemble(state));
}

/** Asks the planner and takes its answer into the state. */
async function decide(state: PlanState, request: string): Promise<void> {
  if (state.planCalls >= MAX_PLAN_CALLS) {
    throw new Error(`At most ${MAX_PLAN_CALLS} planning requests per edit`);
  }
  state.planCalls++;
  const reply = await state.claude({
    purpose: "plan",
    model: state.planModel,
    system: planSystem(state.extras),
    content: [
      { type: "text", text: state.packed, cache: true },
      { type: "text", text: request },
    ],
    schema: planSchema(state.extras),
    effort: "high",
    maxTokens: 64_000,
  });
  state.usage.push(reply.usage);
  state.model = reply.usage.model;
  state.progress(`${reply.usage.model} planned the edit (${dollars(reply.usage.dollars)})`);
  const { visuals, ...rest } = reply.json as Omit<Decisions, "visuals"> & { visuals?: string };
  state.decisions = {
    ...rest,
    ...(visuals === undefined
      ? {}
      : { visuals: parseVisuals(visuals, state.extras.stock ?? false, state.progress) }),
  };
  takeDecisions(state);
  await locateCallouts(state);
  await sourceWishes(state);
}

/** Sources each visual on a line that plays, once per plan: a failed one is left out, and its
 * line keeps the speaker. */
async function sourceWishes(state: PlanState): Promise<void> {
  const playing = new Set(
    state.segments.flatMap((s) => s.lines.map((line) => `${s.source}:${line.n}`)),
  );
  const wishes = (state.decisions.visuals ?? []).filter((wish) =>
    playing.has(`${wish.source}:${wish.line}`),
  );
  if (wishes.length === 0) return;
  const [width, height] = outputSize(state.aspect, state.sources);
  await sourceVisuals(wishes, state.assets, {
    output: { aspect: state.aspect, width, height },
    stock: state.extras.stock ?? false,
    onProblem: state.progress,
    said: (source, n) => {
      const file = state.sources.get(source);
      const line = file?.lines.find((l) => l.n === n);
      return file && line
        ? file.words
            .slice(line.first, line.last + 1)
            .map((w) => w.text)
            .join(" ")
        : "";
    },
  });
  const ready = wishes.filter((wish) => state.assets.get(visualKey(wish))).length;
  state.progress(`Sourced ${ready} of ${wishes.length} visuals`);
}

/** Finds on screen what each callout on a line that plays points at, once per plan. */
async function locateCallouts(state: PlanState): Promise<void> {
  const playing = new Set(
    state.segments.flatMap((s) => s.lines.map((line) => `${s.source}:${line.n}`)),
  );
  const wishes = (state.decisions.callouts ?? []).filter(
    (wish) => playing.has(`${wish.source}:${wish.line}`) && !state.regions.has(wishKey(wish)),
  );
  if (wishes.length === 0) return;
  const before = state.usage.length;
  const found = await locate(wishes, state.sources, state.claude, state.usage);
  for (const [key, located] of found) state.regions.set(key, located);
  const asked = state.usage.length - before;
  const spent = totalUsage(state.usage.slice(before)).dollars;
  const cost = asked > 0 ? `${asked} requests, ${dollars(spent)}` : "all cached";
  state.progress(
    `Found ${found.size} of ${wishes.length} things to point at with ${LOCATE_MODEL} (${cost})`,
  );
}

/** Resolves the planner's line numbers and ids against the transcripts, dropping what does not
 * resolve and every line already used, so code never trusts a number it has not checked. */
function takeDecisions(state: PlanState): void {
  const { decisions, sources } = state;
  // A line plays once, and a line also listed as removed does not play: a retake kept by
  // mistake is worse than a line missed.
  const used = new Set<string>();
  for (const removed of decisions.removed) {
    for (const line of sources.get(removed.source)?.lines ?? []) {
      if (line.n >= removed.first && line.n <= removed.last)
        used.add(`${removed.source}:${line.n}`);
    }
  }
  state.segments = [];
  for (const segment of decisions.segments) {
    const source = sources.get(segment.source);
    if (!source) continue;
    const priority = Math.min(5, Math.max(1, Math.round(segment.priority)));
    let run: Line[] = [];
    const flush = () => {
      if (run.length > 0) {
        state.segments.push({ source: source.id, lines: run, priority, reason: segment.reason });
      }
      run = [];
    };
    for (const line of source.lines) {
      if (line.n < segment.first || line.n > segment.last) continue;
      const key = `${source.id}:${line.n}`;
      if (used.has(key)) {
        flush();
        continue;
      }
      used.add(key);
      run.push(line);
    }
    flush();
  }
  // A track that is not one offered, or an empty one, is no music.
  if (decisions.music && !state.music.has(decisions.music.track)) delete decisions.music;
  state.cuts = new Map();
  const confirmed = new Set(decisions.fillers);
  for (const candidate of state.candidates) {
    if (!confirmed.has(candidate.id)) continue;
    for (let i = candidate.first; i <= candidate.last; i++) {
      state.cuts.set(`${candidate.source}:${i}`, "filler");
    }
  }
  // With fillers off every word plays, whatever the answer holds.
  const cutWords = state.extras.fillers === "off" ? [] : decisions.cut_words;
  for (const cut of cutWords) {
    const source = sources.get(cut.source);
    const line = source?.lines.find((l) => l.n === cut.line);
    if (!source || !line) continue;
    const found = findWords(source.words, line.first, line.last, cut.text);
    if (!found) continue;
    for (let i = found[0]; i <= found[1]; i++) state.cuts.set(`${source.id}:${i}`, cut.kind);
  }
}

/** The edit as code builds it from the decisions: kept words, fitted length, clips. */
export interface Assembly {
  spans: Span[];
  breath: number;
  passes: number;
  clips: PlacedClip[];
  /** Kept word indices per segment and line. */
  kept: number[][][];
}

/**
 * Fits the chosen segments to the target. When they come out short even with the longest
 * breath, the planner is asked once more for material; when that is not enough, the edit is
 * fitted to the length it reaches if that is at least `least`, and otherwise the footage cannot
 * make this edit.
 */
async function assemble(state: PlanState): Promise<Assembly> {
  let target = secondsToTicks(state.length);
  let refitted = false;
  const frame = ticksPerFrame(state.fps);
  let extra = 0;
  for (;;) {
    const kept = state.segments.map((segment) => keptWords(state, segment));
    const stretches = (spans: readonly Span[]) => stretchesOf(state, kept, spans);
    const measure = (spans: readonly Span[], breath: number) =>
      lengthOf(placeClips(stretches(spans), state.sources, frame, breath));
    const fit = fitLength(
      state.segments.map((segment) => ({
        lines: segment.lines.length,
        priority: segment.priority,
      })),
      measure,
      target,
      TOLERANCE,
    );
    const low = target * (1 - TOLERANCE);
    const high = target * (1 + TOLERANCE);
    if (fit.length >= low && fit.length <= high) {
      const clips = placeClips(stretches(fit.spans), state.sources, frame, fit.breath);
      return { spans: fit.spans, breath: fit.breath, passes: fit.passes + extra, clips, kept };
    }
    const seconds = fit.length / TICKS_PER_SECOND;
    if (fit.length > high) {
      const least = Math.ceil(seconds / (1 + TOLERANCE));
      const ask = least <= LENGTH_RANGE[1] ? `Ask for at least ${least} s, or plan` : "Plan";
      throw new PlanError(
        `The planner's choice cannot be cut to ${state.length} s between lines: its shortest ` +
          `edit lasts ${seconds.toFixed(1)} s. ${ask} again for another choice`,
      );
    }
    if (state.planCalls >= MAX_PLAN_CALLS) {
      const reached = state.least === undefined ? null : fittedLength(seconds, state.least);
      if (reached !== null && !refitted) {
        state.progress(
          `The edit lasts ${seconds.toFixed(1)} s after ${MAX_PLAN_CALLS} requests; fitting it to ` +
            `${reached} s, within the range asked`,
        );
        state.length = reached;
        target = secondsToTicks(reached);
        refitted = true;
        continue;
      }
      throw new PlanError(
        `After ${MAX_PLAN_CALLS} requests the edit lasts ${seconds.toFixed(1)} s, short of ` +
          `${state.length} s − ${TOLERANCE * 100} %: the footage holds too little usable ` +
          `speech for this length once retakes, fillers and pauses are out. ${shorterAsk(seconds)}`,
      );
    }
    state.progress(`The edit lasts ${seconds.toFixed(1)} s; asking for more material`);
    const { title, chapters } = state.extras;
    const extras = {
      music: state.musicListing,
      title,
      chapters,
      names: state.names,
      instructions: state.instructions,
    };
    await decide(state, moreRequest(state.decisions, seconds, state.length, extras));
    extra++;
  }
}

/**
 * The words of a segment that play, line by line: every word, less the fillers and false starts
 * cut inside its lines and the words a review took out. A cut needs a pause to fall in, or for a
 * filler or false start a point joinAt allows beside it, so one with neither stays, and a
 * review's removal grows to the nearest pauses.
 */
function keptWords(state: PlanState, segment: Segment): number[][] {
  const source = state.sources.get(segment.source) as PlanSource;
  const from = (segment.lines[0] as Line).first;
  const to = (segment.lines.at(-1) as Line).last;
  const key = (i: number) => `${source.id}:${i}`;
  const keep = new Map<number, boolean>();
  for (let i = from; i <= to; i++) {
    const cut = state.cuts.has(key(i)) && !state.restored.has(key(i));
    keep.set(i, !cut && !state.excluded.has(key(i)));
  }
  const kept = (i: number) => keep.get(i) === true;
  // Words a review's removal grew over count as taken out by the review.
  const taken = (i: number) => state.excluded.has(key(i)) || grown.has(i);
  const grown = new Set<number>();
  for (let changed = true; changed; ) {
    changed = false;
    for (let a = from; a <= to; a++) {
      if (kept(a)) continue;
      let b = a;
      while (b < to && !kept(b + 1)) b++;
      let excluded = false;
      for (let i = a; i <= b; i++) excluded ||= taken(i);
      const apart = (i: number, side: "before" | "after") =>
        cuttableAfter(source, i) || (!excluded && joinAt(source, i, side) !== null);
      const left = kept(a - 1) && !apart(a - 1, "before");
      const right = kept(b + 1) && !apart(b, "after");
      if (left || right) {
        if (excluded) {
          for (const i of [left ? a - 1 : -1, right ? b + 1 : -1].filter((i) => i >= 0)) {
            keep.set(i, false);
            grown.add(i);
          }
        } else {
          for (let i = a; i <= b; i++) keep.set(i, true);
        }
        changed = true;
      }
      a = b;
    }
  }
  return segment.lines.map((line) => {
    const list: number[] = [];
    for (let i = line.first; i <= line.last; i++) if (kept(i)) list.push(i);
    return list;
  });
}

/** What to ask for when the footage makes at most `seconds`: a shorter edit, or more footage
 * when that is short of even the shortest edit. */
function shorterAsk(seconds: number): string {
  const most = Math.floor(seconds / (1 - TOLERANCE));
  const [shortest] = LENGTH_RANGE;
  return most >= shortest
    ? `Ask for at most ${most} s`
    : `Add footage with more speech: an edit is at least ${shortest} s`;
}

/** Every word of every line, in file order, as clips at the longest breath. */
export function placeAll(sources: ReadonlyMap<string, PlanSource>, frame: number): PlacedClip[] {
  const all = [...sources.values()].map((s) => ({
    source: s.id,
    words: s.lines.flatMap((line) =>
      Array.from({ length: line.last - line.first + 1 }, (_, i) => line.first + i),
    ),
  }));
  return placeClips(all, sources, frame, BREATH_RANGE[1]);
}

/** Leaves each video only the lines said wholly inside `within`, in seconds. */
function keepWithin(
  sources: ReadonlyMap<string, PlanSource>,
  within: { start: number; end: number },
): void {
  for (const source of sources.values()) {
    if (!source.index) continue;
    source.lines = source.lines.filter(
      (line) =>
        (source.words[line.first] as Word).start >= within.start &&
        (source.words[line.last] as Word).end <= within.end,
    );
  }
}

function stretchesOf(state: PlanState, kept: number[][][], spans: readonly Span[]): Stretch[] {
  return state.segments.flatMap((segment, s) => {
    const span = spans[s];
    if (!span) return [];
    const words = (kept[s] as number[][]).slice(span[0], span[1] + 1).flat();
    return words.length > 0 ? [{ source: segment.source, words }] : [];
  });
}

/** Builds the project from the assembly, measures its grade and writes it. */
export async function write(state: PlanState, assembly: Assembly): Promise<PlannedEdit> {
  const { clips } = assembly;
  const folder = dirname(state.out);
  const path = (file: string) => relative(folder, file).split(sep).join("/");
  const used = new Set(clips.map((clip) => clip.source));
  const words = outputWords(clips, state.sources);
  const { music, track } = musicFor(state, clips);
  const broll = brollClips(
    state,
    words,
    lengthOf(clips),
    track ? outputBeats(music, track.index) : [],
  );
  for (const clip of broll) used.add(clip.source);
  // Every input, used or not, so plan.dropped can say why a whole file was left out.
  const sources: Project["sources"][number][] = [
    ...[...state.sources.values()].map(({ id, kind, indexPath, fingerprint, ...s }) =>
      indexPath
        ? { id, kind, path: path(s.path), index: path(indexPath), fingerprint }
        : { id, kind, path: path(s.path), fingerprint },
    ),
    ...(track
      ? [
          {
            id: track.id,
            kind: "audio" as const,
            path: path(track.path),
            index: path(track.indexPath),
            fingerprint: track.fingerprint,
          },
        ]
      : []),
  ];
  const lineOf = new Map<string, number>();
  for (const source of state.sources.values()) {
    for (const line of source.lines) {
      for (let i = line.first; i <= line.last; i++) lineOf.set(`${source.id}:${i}`, line.n);
    }
  }
  // One emoji a line, of one code point, as project.json takes it.
  const emoji = new Map(
    state.decisions.emoji
      .filter((pick) => EMOJI.test(pick.emoji))
      .map((pick) => [`${pick.source}:${pick.line}`, pick.emoji]),
  );
  const [width, height] = outputSize(state.aspect, state.sources);
  const covered = broll.map((clip) => ({ start: clip.start, duration: clip.out - clip.in }));
  let joined = 0;
  const cuts = clips.slice(0, -1).map((clip) => (joined += clip.out - clip.in));
  // Where the picture changes shot: where a source's own shot changes, and at a cut to another
  // source or another of its shots, not at a jump cut inside one shot.
  const transitionsAt = (source: string) =>
    (state.sources.get(source)?.index?.transitions ?? []).map((t) => secondsToTicks(t.start));
  const shotOf = (source: string, t: number) => transitionsAt(source).filter((s) => s <= t).length;
  let at = 0;
  const changes = clips.flatMap((clip, i) => {
    const offset = at;
    at += clip.out - clip.in;
    const next = clips[i + 1];
    const cut =
      next &&
      (next.source !== clip.source ||
        shotOf(clip.source, clip.out - 1) !== shotOf(next.source, next.in));
    const inside = transitionsAt(clip.source).filter((t) => t > clip.in && t < clip.out);
    return [...inside.map((t) => offset + t - clip.in), ...(cut ? [at] : [])];
  });
  // Where someone on screen talks, as the index's faces found it, through pauses under 0.5 s and
  // jump cuts; all of a clip whose source has no faces found, as nothing says otherwise.
  const through = (spans: { start: number; end: number }[]) => {
    const joined: { start: number; end: number }[] = [];
    for (const span of [...spans].sort((a, b) => a.start - b.start)) {
      const last = joined.at(-1);
      if (last && span.start - last.end < secondsToTicks(0.5))
        last.end = Math.max(last.end, span.end);
      else joined.push({ ...span });
    }
    return joined;
  };
  at = 0;
  const speaking = through(
    clips.flatMap((clip) => {
      const offset = at;
      at += clip.out - clip.in;
      const framing = state.sources.get(clip.source)?.index?.framing;
      if (!framing) return [{ start: offset, end: at }];
      const talks = framing.shots.flatMap((shot) =>
        shot.speakers.map((s) => ({ start: secondsToTicks(s.start), end: secondsToTicks(s.end) })),
      );
      return through(talks)
        .filter((t) => t.end > clip.in && t.start < clip.out)
        .map((t) => ({
          start: offset + Math.max(t.start, clip.in) - clip.in,
          end: offset + Math.min(t.end, clip.out) - clip.in,
        }));
    }),
  );
  // Each clip framed for the output's shape on the faces its source's index found, and in a
  // video call on the windows they are in.
  const windows = new Map<string, Map<number, Rect>>();
  for (const clip of clips) {
    const source = state.sources.get(clip.source);
    if (!source?.index) continue;
    const own = windows.get(source.id) ?? new Map<number, Rect>();
    for (const [id, window] of await callWindows(source.path, source.index, clip)) {
      own.set(id, window);
    }
    windows.set(source.id, own);
  }
  const framed = <C extends { source: string; in: number; out: number }>(clip: C): C => {
    const index = state.sources.get(clip.source)?.index;
    const crop =
      index && cropPath(index, clip, { width, height }, CAMERA, windows.get(clip.source));
    return crop ? { ...clip, framing: { crop } } : clip;
  };
  const main = clips.map((clip) =>
    framed({
      source: clip.source,
      in: clip.in,
      out: clip.out,
      ...(clip.soundIn === undefined ? {} : { soundIn: clip.soundIn }),
      ...(clip.soundOut === undefined ? {} : { soundOut: clip.soundOut }),
    }),
  );
  // Where each thing found shows in the frame while its callout would play.
  const placed = new Map<string, Rect>();
  for (const wish of state.decisions.callouts ?? []) {
    const located = state.regions.get(wishKey(wish));
    const source = located && state.sources.get(located.source);
    const span = located && calloutSpan(state.fps, words, lengthOf(clips), located);
    if (!located || !source || !span) continue;
    const size = { width, height, frame: ticksPerFrame(state.fps) };
    const rect = await calloutRect(
      source,
      main,
      located,
      span.from,
      span.duration,
      size,
      state.stills,
    );
    if (rect) placed.set(wishKey(wish), rect);
  }
  const edit = lengthOf(clips);
  const overlays = plannedOverlays(state, words, edit, covered, cuts, placed, changes, speaking);
  // Visuals keep clear of the B-roll placed and of every effect.
  const visuals = state.extras.visuals
    ? placeVisuals(state.decisions.visuals ?? [], state.assets, {
        words,
        lines: (source, n) => state.sources.get(source)?.lines.find((line) => line.n === n),
        sourceWords: (source) => state.sources.get(source)?.words ?? [],
        edit,
        frame: ticksPerFrame(state.fps),
        aspect: state.aspect,
        blocked: [...covered, ...overlays].map((o) => ({
          start: o.start,
          end: o.start + o.duration,
        })),
        onLeftOut: (wish, reason) =>
          state.progress(`Left out the ${wish.kind} visual on line ${wish.line}: ${reason}`),
      })
    : [];
  const output = { aspect: state.aspect, width, height };
  const parts = await visualParts(visuals, output, (file) => visualPath(folder, file));
  sources.push(...parts.sources);
  let project: Project = {
    version: 1,
    output: {
      aspect: state.aspect,
      width,
      height,
      fps: state.fps,
      target: { duration: secondsToTicks(state.length), tolerance: TOLERANCE },
    },
    sources: sources as Project["sources"],
    main: main as Project["main"],
    ...(broll.length > 0 ? { broll: broll.map(framed) } : {}),
    ...(overlays.length > 0 ? { overlays } : {}),
    captions: {
      preset: state.captions,
      srt: true,
      ...(state.emoji ? { emoji: true } : {}),
      lines: captionLines(
        words,
        (source, i) => lineOf.get(`${source}:${i}`) ?? -1,
        (source, line) => emoji.get(`${source}:${line}`),
      ),
    },
    audio: { loudness: loudnessFor(state.aspect), ...(music.length > 0 ? { music } : {}) },
    plan: {
      model: state.model,
      rationale: track
        ? `${state.decisions.content}\n\nMusic: ${state.decisions.music?.reason ?? ""}`
        : state.decisions.content,
      dropped: dropped(state, assembly, used),
      fit: { duration: lengthOf(clips), passes: assembly.passes },
      emphasis: emphasis(state, words),
    },
  };
  validateProject(project);
  await mkdir(folder, { recursive: true });
  await writeFile(state.out, `${JSON.stringify(project, null, 2)}\n`);
  project = await planVoice(punchIns(await graded(state, project), shots(state)), state.out);
  project = withVisuals(state, project, visuals, parts, windows);
  if (state.extras.visuals) {
    const options = {
      claude: state.claude,
      model: state.planModel,
      usage: state.usage,
      progress: state.progress,
      speakers: (spans: readonly { start: number; end: number; layout: string }[]) =>
        splitSpeakers(state, project, spans, windows),
    };
    // Written once the cut is known, and placed again on the words each later fit keeps.
    state.graphics ??= await writeGraphics(project, state.out, words, options);
    project = await withGraphics(project, state.out, state.graphics, words, {
      ...options,
      fix: !state.graphicsFixed,
    });
    state.graphicsFixed = true;
  }
  if (state.brand) project = { ...project, brand: state.brand };
  await writeFile(state.out, `${JSON.stringify(validateProject(project), null, 2)}\n`);
  return { path: state.out, project, assembly, state };
}

/**
 * The project with its visuals, added once its own clips are graded and punched in: captures and
 * footage as B-roll, as sourced; the speaker beside each split screen, framed for that shape and
 * graded as the main clip it plays in step with; and the sound effects.
 */
function withVisuals(
  state: PlanState,
  project: Project,
  visuals: readonly PlacedVisual[],
  parts: Awaited<ReturnType<typeof visualParts>>,
  windows: ReadonlyMap<string, ReadonlyMap<number, Rect>>,
): Project {
  if (visuals.length === 0) return project;
  const speakers = splitSpeakers(state, project, visuals, windows);
  const broll = [...(project.broll ?? []), ...parts.broll, ...speakers];
  return {
    ...project,
    ...(broll.length > 0 ? { broll } : {}),
    audio: { ...project.audio, ...(parts.sfx.length > 0 ? { sfx: parts.sfx } : {}) },
  };
}

/** The speaker beside each split screen of `spans`, framed for its half and graded as the main
 * clip it plays in step with. */
function splitSpeakers(
  state: PlanState,
  project: Project,
  spans: readonly { start: number; end: number; layout: string }[],
  windows: ReadonlyMap<string, ReadonlyMap<number, Rect>>,
): BrollClip[] {
  return speakerClips(
    spans,
    project.main,
    (source) => state.sources.get(source)?.index ?? null,
    project.output,
    (source) => windows.get(source),
  ).map((clip) => {
    let at = 0;
    const under = project.main.find((main) => {
      const hit = clip.start >= at && clip.start < at + main.out - main.in;
      at += main.out - main.in;
      return hit;
    });
    return under?.grade ? { ...clip, grade: under.grade } : clip;
  });
}

/**
 * Each source's size, shot changes and faces, which punch-ins are fitted to. A still has no
 * index, so it is left out and never punched in.
 */
function shots(state: PlanState): Map<string, ShotFacts> {
  const facts = new Map<string, ShotFacts>();
  for (const source of state.sources.values()) {
    if (!source.index) continue;
    const { width = 0, height = 0, sample_aspect: sampleAspect } = source.index.source.video ?? {};
    const { transitions, framing, transcript } = source.index;
    facts.set(source.id, {
      width,
      height,
      ...(sampleAspect ? { sampleAspect } : {}),
      transitions,
      ...(framing ? { framing } : {}),
      words: transcript.words,
    });
  }
  return facts;
}

/**
 * The project graded: every clip's grade.auto, measured by autoGrade once per clip, so a review
 * that moves one cut re-measures only the clips it changed; the main track's sources matched to
 * the one it uses longest; and the look over every clip.
 */
async function graded(state: PlanState, project: Project): Promise<Project> {
  const key = (clip: { source: string; in: number; out: number }) =>
    `${clip.source}:${clip.in}:${clip.out}`;
  const fresh = [...project.main, ...(project.broll ?? [])].filter(
    (clip) => !state.grades.has(key(clip)),
  );
  if (fresh.length > 0) {
    state.progress(`Measuring the colour of ${fresh.length} clips`);
    const main = fresh.map(({ source, in: start, out }) => ({ source, in: start, out }));
    // B-roll is measured as main-track clips here, so each clip is measured once.
    const measured = await autoGrade(
      { ...project, main: main as Project["main"], broll: [] },
      state.out,
    );
    for (const clip of measured.main) {
      if (clip.grade?.auto) state.grades.set(key(clip), clip.grade.auto);
    }
  }
  const withAuto = <C extends { source: string; in: number; out: number }>(clip: C): C => {
    const auto = state.grades.get(key(clip));
    return auto ? { ...clip, grade: { auto } } : clip;
  };
  const auto: Project = {
    ...project,
    main: project.main.map(withAuto) as Project["main"],
    ...(project.broll ? { broll: project.broll.map(withAuto) } : {}),
  };
  const matched = await matchColour(auto, state.out, state.colours);
  for (const { source, reference, problem } of matched.reports) {
    state.progress(
      problem
        ? `Left the colour of ${source} as it is: ${problem}`
        : `Matched the colour of ${source} to ${reference}`,
    );
  }
  const { look } = state;
  if (!look) return matched.project;
  const withLook = <C extends { grade?: Grade }>(clip: C): C => ({
    ...clip,
    grade: { ...clip.grade, look },
  });
  return {
    ...matched.project,
    main: matched.project.main.map(withLook) as Project["main"],
    ...(project.broll ? { broll: (matched.project.broll ?? []).map(withLook) } : {}),
  };
}

/** The chosen music fitted to the edit's length, at the level its speech calls for. */
function musicFor(
  state: PlanState,
  clips: readonly PlacedClip[],
): { music: MusicTrack[]; track: MusicSource | null } {
  const choice = state.decisions.music;
  const track = choice ? state.music.get(choice.track) : undefined;
  if (!choice || !track) return { music: [], track: null };
  let voice: number;
  try {
    // Main clips are cut from video, which has an index; stills only show as B-roll.
    voice = speechLoudness(
      clips.flatMap((clip) => {
        const index = state.sources.get(clip.source)?.index;
        return index ? [{ index, in: clip.in, out: clip.out }] : [];
      }),
    );
  } catch (error) {
    throw new PlanError((error as Error).message, { cause: error });
  }
  const music = fitMusic(track, choice.section, lengthOf(clips) / TICKS_PER_SECOND, voice);
  return music.length > 0 ? { music, track } : { music: [], track: null };
}

/** B-roll the planner placed, each over the line it names, cut to fit the edit and never
 * overlapping the one before. Its cuts need not fall between words, so with music each lands
 * on a beat: its start on the nearest within SNAP of the line, its end on the last that the
 * shot's length allows, both on the frame grid. */
function brollClips(
  state: PlanState,
  words: readonly TimedWord[],
  edit: number,
  beats: readonly number[],
): BrollClip[] {
  const frame = ticksPerFrame(state.fps);
  const onFrame = (ticks: number) => Math.round(ticks / frame) * frame;
  const clips: BrollClip[] = [];
  let free = 0;
  const placements = state.decisions.broll
    .map((item) => {
      const broll = state.sources.get(item.broll);
      const over = state.sources.get(item.source)?.lines.find((line) => line.n === item.line);
      const word =
        over &&
        words.find(
          (w) => w.source === item.source && w.index >= over.first && w.index <= over.last,
        );
      return broll && broll.lines.length === 0 && word ? { item, broll, start: word.start } : null;
    })
    .filter((placement) => placement !== null)
    .sort((a, b) => a.start - b.start);
  for (const { item, broll, start } of placements) {
    let begin = Math.max(start, free);
    if (beats.length > 0) {
      const beat = onFrame(secondsToTicks(snapToBeat(begin / TICKS_PER_SECOND, beats)));
      // The shot before ends on the grid, so a start that rounds below it moves a frame on.
      begin = beat >= free ? beat : onFrame(begin) < free ? onFrame(begin) + frame : onFrame(begin);
    }
    // A still has no time of its own: its clip runs from 0 for as long as it shows.
    const still = broll.kind === "image";
    const inTicks = still ? 0 : secondsToTicks(Math.max(0, item.start));
    const available = still
      ? secondsToTicks(Math.max(0, item.end - item.start))
      : secondsToTicks(Math.max(0, Math.min(item.end, broll.duration))) - inTicks;
    const most = Math.min(available, secondsToTicks(BROLL_MAX), edit - begin);
    let frames = Math.floor(most / frame);
    if (beats.length > 0) {
      const onBeats = beats.map((b) => onFrame(secondsToTicks(b)) - begin);
      const end = lastBeat(frames * frame, secondsToTicks(1), onBeats);
      frames = Math.floor(end / frame);
    }
    if (frames * frame < secondsToTicks(1)) continue;
    clips.push({
      source: broll.id,
      in: inTicks,
      out: inTicks + frames * frame,
      start: begin,
      fade: secondsToTicks(BROLL_FADE),
    });
    free = begin + frames * frame;
  }
  return clips;
}

/** The planner's emphasis moments that are still in the edit, on the output timeline. */
function emphasis(state: PlanState, words: readonly TimedWord[]): Emphasis[] {
  const moments: Emphasis[] = [];
  for (const item of state.decisions.emphasis) {
    const source = state.sources.get(item.source);
    const line = source?.lines.find((l) => l.n === item.line);
    if (!source || !line) continue;
    const found = findWords(source.words, line.first, line.last, item.text);
    if (!found) continue;
    const timed = words.filter(
      (w) => w.source === source.id && w.index >= found[0] && w.index <= found[1],
    );
    const first = timed[0];
    const last = timed.at(-1);
    if (!first || !last || timed.length !== found[1] - found[0] + 1) continue;
    moments.push({ start: first.start, end: last.end, text: item.text, reason: item.reason });
  }
  return moments.sort((a, b) => a.start - b.start);
}

/** What the edit leaves out of each source between its clips, and why: all of a source it does
 * not use, B-roll aside. */
function dropped(state: PlanState, assembly: Assembly, used: ReadonlySet<string>): Dropped[] {
  const reasons = new Map<string, { kind: Dropped["kind"]; reason: string; rank: number }>();
  const mark = (source: string, i: number, kind: Dropped["kind"], reason: string, rank: number) => {
    const key = `${source}:${i}`;
    const current = reasons.get(key);
    if (!current || current.rank < rank) reasons.set(key, { kind, reason, rank });
  };
  for (const removed of state.decisions.removed) {
    const source = state.sources.get(removed.source);
    for (const line of source?.lines ?? []) {
      if (line.n < removed.first || line.n > removed.last) continue;
      const kind = removed.kind === "retake" || removed.kind === "mistake" ? removed.kind : "other";
      for (let i = line.first; i <= line.last; i++)
        mark(removed.source, i, kind, removed.reason, 3);
    }
  }
  for (const [s, segment] of state.segments.entries()) {
    const span = assembly.spans[s];
    for (const [k, line] of segment.lines.entries()) {
      if (span && k >= span[0] && k <= span[1]) continue;
      const reason = `Priority ${segment.priority} of 5, left out to fit ${state.length} s: ${segment.reason}`;
      for (let i = line.first; i <= line.last; i++) mark(segment.source, i, "length", reason, 2);
    }
  }
  for (const [key, kind] of state.cuts) {
    if (state.restored.has(key)) continue;
    const [source, i] = key.split(":") as [string, string];
    const word = state.sources.get(source)?.words[Number(i)];
    if (!word) continue;
    if (kind === "filler")
      mark(source, Number(i), "filler", `「${bare(word.text)}」, a hesitation`, 1);
    else mark(source, Number(i), "mistake", "A false start, said again right after", 1);
  }
  for (const [key, reason] of state.excluded) {
    const [source, i] = key.split(":") as [string, string];
    mark(source, Number(i), "other", reason, 4);
  }

  const list: Dropped[] = [];
  for (const source of state.sources.values()) {
    const clips = assembly.clips
      .filter((clip) => clip.source === source.id)
      .sort((a, b) => a.in - b.in);
    const whole = clips.length === 0;
    if (whole && used.has(source.id)) continue;
    const end = secondsToTicks(source.duration);
    const gaps: [number, number][] = [];
    let previous = 0;
    for (const clip of clips) {
      if (clip.in > previous) gaps.push([previous, clip.in]);
      previous = Math.max(previous, clip.out);
    }
    if (end > previous) gaps.push([previous, end]);
    for (const [from, to] of gaps) {
      const inside = source.words
        .map((word, i) => ({ word, i }))
        .filter(({ word }) => secondsToTicks(word.start) >= from && secondsToTicks(word.end) <= to);
      if (inside.length === 0) {
        const seconds = ((to - from) / TICKS_PER_SECOND).toFixed(1);
        list.push({
          source: source.id,
          in: from,
          out: to,
          ...(whole
            ? { kind: "other", reason: "B-roll the plan did not place" }
            : { kind: "pause", reason: `${seconds} s without speech` }),
        });
        continue;
      }
      const best = inside
        .map(({ i }) => reasons.get(`${source.id}:${i}`))
        .reduce((a, b) => ((b?.rank ?? 0) > (a?.rank ?? 0) ? b : a), undefined);
      const text = joinWords(inside.map(({ word }) => word.text));
      const clipped = text.length > 24 ? `${text.slice(0, 24)}…` : text;
      list.push({
        source: source.id,
        in: from,
        out: to,
        kind: best?.kind ?? "other",
        reason: best?.reason ?? `「${clipped}」 was not chosen for the story`,
      });
    }
  }
  return list;
}

/** Reads every index the inputs name, checks its footage is where the input says (next to an
 * index given alone), and gives each source an id: its file name, or its folder's name when file
 * names repeat, as corpus clips are all called source.mp4. A name with nothing an id allows, such
 * as 訪談, becomes file-1, file-2…, by order. */
export async function loadSources(inputs: readonly PlanInput[]): Promise<Map<string, PlanSource>> {
  const files: { indexPath: string | null; source?: string }[] = [];
  for (const input of inputs) {
    if (typeof input !== "string") {
      files.push(
        "image" in input
          ? { indexPath: null, source: resolve(input.image) }
          : { indexPath: resolve(input.index), source: resolve(input.source) },
      );
      continue;
    }
    const path = resolve(input);
    if (extname(path) === ".json") {
      files.push({ indexPath: path });
      continue;
    }
    const names = (await readdir(path)).filter(
      (n) => n === "index.json" || n.endsWith(".index.json"),
    );
    if (names.length === 0) throw new PlanError(`${input}: no media index (*.index.json) in it`);
    files.push(...names.sort().map((name) => ({ indexPath: join(path, name) })));
  }
  if (files.length === 0) throw new PlanError("No media index to plan from");
  const loaded: {
    indexPath: string | null;
    index: MediaIndex | null;
    path: string;
    fingerprint: Awaited<ReturnType<typeof fingerprintOf>>;
  }[] = [];
  for (const { indexPath, source } of files) {
    if (!indexPath) {
      const path = source as string;
      if (!existsSync(path)) throw new PlanError(`${path}: no such image`);
      loaded.push({ indexPath, index: null, path, fingerprint: await fingerprintOf(path) });
      continue;
    }
    const index = await loadJson(indexPath, validateMediaIndex);
    if (!index.source.video) {
      throw new PlanError(`${indexPath}: ${index.source.name} has no picture to edit`);
    }
    if (index.source.video.sample_aspect === undefined) {
      // The crop would be planned for square pixels.
      throw new PlanError(`${indexPath}: it predates its pixel shape; run vework analyze again`);
    }
    const path = source ?? join(dirname(indexPath), index.source.name);
    if (!existsSync(path)) {
      throw new PlanError(
        source
          ? `${path}: no such file, which ${indexPath} describes`
          : `${indexPath}: ${index.source.name} is not next to it, where the planner reads it from`,
      );
    }
    loaded.push({ indexPath, index, path, fingerprint: await fingerprintOf(path) });
  }
  const stems = loaded.map((s) => basename(s.path, extname(s.path)));
  const names = loaded.map((s, i) => {
    const stem = stems[i] as string;
    const same = loaded.filter((_, j) => stems[j] === stem);
    if (same.length === 1) return stem;
    // Clips all named source.mp4 are told apart by their folders; a video and its thumbnail
    // side by side, by their extensions.
    const folders = new Set(same.map((t) => dirname(t.path)));
    return folders.size === same.length ? basename(dirname(s.path)) : basename(s.path);
  });
  const sources = new Map<string, PlanSource>();
  for (const [i, s] of loaded.entries()) {
    const name = names[i] as string;
    const base =
      name.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[^A-Za-z0-9]+/, "") || `file-${i + 1}`;
    let id = base;
    for (let n = 2; sources.has(id); n++) id = `${base}-${n}`;
    const placed: PlaceSource = {
      id,
      words: (s.index?.transcript.words ?? []) as Word[],
      // A still shows for as long as a B-roll shot may.
      duration: s.index ? s.index.source.duration : BROLL_MAX,
      frameTicks: s.index ? gridTicks(s.index.source.video?.fps ?? 0) : null,
      shots: (s.index?.transitions ?? []).map((t) => [t.start, t.end] as const),
      ...(s.index && s.indexPath ? await stemMarks(s.index, s.indexPath) : {}),
    };
    sources.set(id, {
      ...placed,
      name,
      kind: s.index ? "video" : "image",
      path: s.path,
      indexPath: s.indexPath,
      index: s.index,
      fingerprint: s.fingerprint,
      lines: splitLines(placed),
      roomy: new Set(),
    });
  }
  return sources;
}

/** The frame rate of the source with the most speech, when its frames are whole ticks and no
 * longer than at 24000/1001 fps, so that one fits in a cut (CUT_GAP); 30 fps otherwise, as for a
 * slow screen recording. */
function outputRate(sources: ReadonlyMap<string, PlanSource>): FrameRate {
  const main = [...sources.values()].sort(
    (a, b) => speechSeconds(b.words, b.lines) - speechSeconds(a.words, a.lines),
  )[0];
  const ticks = main?.frameTicks;
  if (!ticks || ticks > ticksPerFrame({ num: 24_000, den: 1001 })) return { num: 30, den: 1 };
  const divisor = gcd(TICKS_PER_SECOND, ticks);
  return { num: TICKS_PER_SECOND / divisor, den: ticks / divisor };
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** The output size: the aspect at the largest of 1080, 720, 540 or 360 lines that the videos'
 * shorter side fills, so footage is not blown up past its own detail. */
function outputSize(aspect: Aspect, sources: ReadonlyMap<string, PlanSource>): [number, number] {
  const short = Math.max(
    ...[...sources.values()].map((s) => {
      const video = s.index?.source.video;
      return video ? Math.min(video.width, video.height) : 0;
    }),
  );
  const side = [1080, 720, 540, 360].find((size) => size <= short) ?? 360;
  if (aspect === "1:1") return [side, side];
  const long = (side * 16) / 9;
  return aspect === "9:16" ? [side, long] : [long, side];
}

function emptyDecisions(): Decisions {
  return {
    content: "",
    segments: [],
    removed: [],
    fillers: [],
    cut_words: [],
    broll: [],
    emphasis: [],
    emoji: [],
  };
}

export function dollars(value: number | null): string {
  return value === null ? "cost unknown" : `$${value.toFixed(4)}`;
}

export { assemble };
