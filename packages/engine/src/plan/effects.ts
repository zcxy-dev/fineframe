// Effect overlays for a planned edit. Claude decides which moments get one and what it says;
// code times each on the speech, keeps one on screen at a time, and drops any whose params or
// length its template does not allow.

import { catalog, overlayProblems, type TemplateId } from "@video-editor/effects";
import {
  type FrameRate,
  type Overlay,
  type Rect,
  secondsToTicks,
  ticksPerFrame,
} from "@video-editor/schema";
import type { TimedWord } from "./captions.ts";
import { findWords } from "./fillers.ts";
import { CALLOUT_LEAD, type Located, wishKey } from "./locate.ts";
import type { PlanState } from "./plan.ts";
import { bare } from "./text.ts";

/** The templates the planner places. */
export const PLANNED: readonly TemplateId[] = ["title", "lower-third", "keyword", "chapter", "wipe", "callout"]; // biome-ignore format: one line
/** Keyword pops per minute of edit at most, the top of the catalog's one to three, and callouts:
 * one every 20 s, as the planner is told. */
const KEYWORDS_PER_MINUTE = 3;
const CALLOUTS_PER_MINUTE = 3;
/** A keyword's swipe lands as its word is said, so it starts this much sooner (catalog). */
const KEYWORD_LEAD = 0.15;
/** A lower third waits this long after its person starts speaking (catalog). */
const NAME_DELAY = 1;
/** How much longer a lower third or a chapter marker waits for an effect already on screen to
 * leave: a chapter marker long enough for the title over the opening. A keyword belongs to its
 * word, the title to the opening and a wipe to its cut, so none of them moves. */
const WAIT: Partial<Record<TemplateId, number>> = { "lower-third": 3, chapter: 4 };
/** Each chapter runs at least this long, and an edit has at most this many (catalog). */
const CHAPTER_MIN = 30;
const CHAPTERS_MAX = 12;

/**
 * The overlays of an edit `edit` ticks long whose kept words are `words`: a title over the
 * opening when one was asked for, a marker as each chapter starts with a wipe over the cut into
 * it, a lower third the first time each named person speaks, a callout on each thing pointed at
 * on a screen recording that was found there, and keyword pops on the emphasised moments, in
 * that order of precedence. One that would overlap another, run shorter than its template allows
 * or break its params is left out; an optional param that breaks them (a subtitle, role or label
 * too long) is left out alone. `broll` is where B-roll covers the speaker, which a lower third
 * waits for or else is left out, and which hides a callout's region; `cuts` are where the clips
 * join. `placed` holds where each found thing shows in the output frame while its callout plays
 * (calloutSpan), by wishKey; a thing that does not show whole and still has none. `changes` are
 * where the picture may cut to someone else: the cuts and the sources' own shot changes;
 * `speaking`, where someone on screen talks. A lower third shows in the first shot, while its
 * person's line is said, where someone on screen talks for as long as its template needs, and
 * ends before that shot does or the talking stops, coming in sooner than usual, but not before
 * they speak, to fit; with no such shot it is left out. A keyword pop ends before the shot
 * changes after its word.
 */
export function plannedOverlays(
  state: PlanState,
  words: readonly TimedWord[],
  edit: number,
  broll: readonly { start: number; duration: number }[] = [],
  cuts: readonly number[] = [],
  placed: ReadonlyMap<string, Rect> = new Map(),
  changes: readonly number[] = cuts,
  speaking: readonly { start: number; end: number }[] = [{ start: 0, end: edit }],
): Overlay[] {
  const frame = ticksPerFrame(state.fps);
  const onFrame = (ticks: number) => Math.max(0, Math.round(ticks / frame) * frame);
  const wanted: Overlay[] = [];
  /** The tick each wanted overlay must end by, when that is before the edit's end. */
  const until = new Map<Overlay, number>();
  const add = (
    template: TemplateId,
    start: number,
    params: Record<string, unknown>,
    end = edit,
  ) => {
    const { from, duration } = span(state.fps, end, template, start);
    if (duration >= secondsToTicks(catalog[template].seconds.min)) {
      const overlay = { template, start: from, duration, params };
      wanted.push(overlay);
      if (end < edit) until.set(overlay, end);
    }
  };
  /** The first kept word of a source's line, on the output timeline. */
  const lineStart = (source: string, n: number) => {
    const line = state.sources.get(source)?.lines.find((l) => l.n === n);
    return line && words.find((w) => w.source === source && w.index >= line.first && w.index <= line.last); // biome-ignore format: one line
  };

  /** Where the last kept word of a source's line ends, on the output timeline. */
  const lineEnd = (source: string, n: number) => {
    const line = state.sources.get(source)?.lines.find((l) => l.n === n);
    return line ? Math.max(...words.filter((w) => w.source === source && w.index >= line.first && w.index <= line.last).map((w) => w.end)) : 0; // biome-ignore format: one line
  };

  const { title, people, emphasis } = state.decisions;
  if (state.extras.title && title?.text.trim() && words[0]) {
    add("title", words[0].start, { text: title.text.trim(), ...optional("subtitle", title.subtitle) }); // biome-ignore format: one line
  }
  if (state.extras.chapters) {
    const marked = chapters(state, words, edit, lineStart);
    for (const [i, { title, word }] of marked.entries()) {
      add("chapter", word.start, { title, index: i + 1, total: marked.length });
      // A wipe needs a cut to hide: one between the chapter's first word and the word before.
      const before = words[words.indexOf(word) - 1];
      const cut = before && cuts.find((c) => c >= before.end && c <= word.start);
      if (cut) add("wipe", cut - secondsToTicks(catalog.wipe.seconds.typical) / 2, {});
    }
  }
  const names = new Map(state.names.map((name) => [bare(name), name]));
  const named = new Set<string>();
  for (const person of people ?? []) {
    const name = names.get(bare(person.name));
    const word = lineStart(person.source, person.line);
    if (!name || !word || named.has(name)) continue;
    named.add(name);
    const window = nameWindow(word, lineEnd(person.source, person.line), edit, frame, changes, speaking); // biome-ignore format: one line
    if (!window) continue;
    const fits = window.end - secondsToTicks(catalog["lower-third"].seconds.min);
    const start = Math.min(window.start + secondsToTicks(NAME_DELAY), fits);
    add("lower-third", start, { name, ...optional("role", person.role) }, window.end);
  }
  for (const wish of state.decisions.callouts ?? []) {
    const located = state.regions.get(wishKey(wish));
    const rect = placed.get(wishKey(wish));
    const word = located && words.find((w) => w.source === located.source && w.index === located.word); // biome-ignore format: one line
    if (word && rect) {
      add("callout", word.start - secondsToTicks(CALLOUT_LEAD), { rect, ...optional("label", wish.label) }); // biome-ignore format: one line
    }
  }
  for (const item of emphasis) {
    const keyword = item.keyword?.trim();
    const source = state.sources.get(item.source);
    const line = source?.lines.find((l) => l.n === item.line);
    if (!keyword || !source || !line) continue;
    // On the keyword as it is said, or else on the moment it belongs to.
    const at =
      findWords(source.words, line.first, line.last, keyword) ??
      findWords(source.words, line.first, line.last, item.text);
    const word = at && words.find((w) => w.source === source.id && w.index === at[0]);
    if (!word) continue;
    // It ends before the shot changes after its word, or else pops over another shot.
    const end = Math.floor((changes.find((c) => c > word.start) ?? edit) / frame) * frame;
    add("keyword", word.start - secondsToTicks(KEYWORD_LEAD), { text: keyword, position: "upper" }, end); // biome-ignore format: one line
  }

  // One at a time, the earlier-listed first: at 9:16 the lower third, the chapter marker and an
  // upper keyword share the top of the frame, and two effects at once compete for the eye. A
  // wipe covers the cut just before its chapter's marker comes in, so those two may overlap.
  const kept: Overlay[] = [];
  const perMinute = (n: number) => Math.max(1, Math.floor((n * edit) / secondsToTicks(60)));
  const left: Partial<Record<TemplateId, number>> = {
    keyword: perMinute(KEYWORDS_PER_MINUTE),
    callout: perMinute(CALLOUTS_PER_MINUTE),
  };
  const paired = (a: string, b: string) =>
    (a === "wipe" && b === "chapter") || (a === "chapter" && b === "wipe");
  // A lower third names someone on camera, and a callout points at the screen under it, so
  // B-roll over them blocks them too.
  const clash = ({ template, start, duration }: Overlay) =>
    [
      ...kept.filter((k) => !paired(template, k.template)),
      ...(template === "lower-third" || template === "callout" ? broll : []),
    ].filter((k) => start < k.start + k.duration && k.start < start + duration);
  for (const wish of wanted) {
    const quota = left[wish.template as TemplateId];
    if (quota === 0) continue;
    let overlay = wish;
    const blocking = clash(overlay);
    const wait = WAIT[overlay.template as TemplateId];
    if (blocking.length > 0 && wait !== undefined) {
      const start = onFrame(Math.max(...blocking.map((k) => k.start + k.duration)) + frame);
      if (
        start - wish.start <= secondsToTicks(wait) &&
        start + overlay.duration <= (until.get(wish) ?? edit)
      ) {
        overlay = { ...overlay, start };
      }
    }
    if (clash(overlay).length > 0) continue;
    if (overlayProblems([overlay]).length > 0) {
      const { subtitle, role, label, ...required } = overlay.params;
      overlay = { ...overlay, params: required };
      if (overlayProblems([overlay]).length > 0) continue;
    }
    kept.push(overlay);
    if (quota !== undefined) left[overlay.template as TemplateId] = quota - 1;
  }
  return kept.sort((a, b) => a.start - b.start);
}

/** The first stretch, from `word` until `until`, inside one shot and while someone on screen
 * talks, long enough for a lower third; its end on the frame grid. */
function nameWindow(
  word: TimedWord,
  until: number,
  edit: number,
  frame: number,
  changes: readonly number[],
  speaking: readonly { start: number; end: number }[],
): { start: number; end: number } | undefined {
  const min = secondsToTicks(catalog["lower-third"].seconds.min);
  const bounds = [0, ...changes, edit].sort((a, b) => a - b);
  for (const [i, shotStart] of bounds.slice(0, -1).entries()) {
    const shotEnd = bounds[i + 1] as number;
    if (shotEnd <= word.start || shotStart >= until) continue;
    for (const talk of speaking) {
      const start = Math.max(shotStart, talk.start, word.start);
      const end = Math.floor(Math.min(shotEnd, talk.end) / frame) * frame;
      if (start < until && end - start >= min) return { start, end };
    }
  }
  return undefined;
}

/** Where an overlay of `template` meant to start at output tick `start` is placed, on the
 * frame grid, and how long it shows when it must end by tick `edit`. */
function span(fps: FrameRate, edit: number, template: TemplateId, start: number) {
  const frame = ticksPerFrame(fps);
  const onFrame = (ticks: number) => Math.max(0, Math.round(ticks / frame) * frame);
  const from = onFrame(start);
  const typical = onFrame(secondsToTicks(catalog[template].seconds.typical));
  return { from, duration: Math.min(typical, edit - from) };
}

/** Where a callout on a found thing would play, by the first word naming it, if it plays. */
export function calloutSpan(
  fps: FrameRate,
  words: readonly TimedWord[],
  edit: number,
  located: Located,
): { from: number; duration: number } | undefined {
  const word = words.find((w) => w.source === located.source && w.index === located.word);
  return word && span(fps, edit, "callout", word.start - secondsToTicks(CALLOUT_LEAD));
}

/**
 * The chapters Claude gave, each at the first kept word of the line that opens it, in play
 * order, the first at the opening; one whose name its template does not allow is none. The
 * shortest section joins the one before it (the first, the one after) until each runs
 * CHAPTER_MIN or longer and there are at most CHAPTERS_MAX; fewer than three is none.
 */
function chapters(
  state: PlanState,
  words: readonly TimedWord[],
  edit: number,
  lineStart: (source: string, n: number) => TimedWord | undefined,
): { title: string; word: TimedWord }[] {
  const starts: { title: string; word: TimedWord }[] = [];
  for (const chapter of state.decisions.chapters ?? []) {
    const title = chapter.title.trim();
    const word = lineStart(chapter.source, chapter.line);
    const duration = secondsToTicks(catalog.chapter.seconds.typical);
    const params = { title, index: 1, total: 1 };
    const named =
      overlayProblems([{ template: "chapter", start: 0, duration, params }]).length === 0;
    if (named && word && !starts.some((s) => s.word === word)) starts.push({ title, word });
  }
  starts.sort((a, b) => words.indexOf(a.word) - words.indexOf(b.word));
  const [first] = starts;
  if (first && words[0]) first.word = words[0];
  const length = (i: number) => (starts[i + 1]?.word.start ?? edit) - (starts[i]?.word.start ?? 0);
  for (;;) {
    if (starts.length < 3) return [];
    let shortest = 0;
    for (let i = 1; i < starts.length; i++) if (length(i) < length(shortest)) shortest = i;
    if (starts.length <= CHAPTERS_MAX && length(shortest) >= secondsToTicks(CHAPTER_MIN)) {
      return starts;
    }
    starts.splice(Math.max(1, shortest), 1);
  }
}

const optional = (key: string, value: string | undefined) =>
  value?.trim() ? { [key]: value.trim() } : {};
