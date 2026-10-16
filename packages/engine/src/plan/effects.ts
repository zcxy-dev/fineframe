// Effect overlays for a planned edit. Claude decides which moments get one and what it says;
// code times each on the speech, keeps one on screen at a time, and drops any whose params or
// length its template does not allow.

import { catalog, overlayProblems, type TemplateId } from "@video-editor/effects";
import { type Overlay, secondsToTicks, ticksPerFrame } from "@video-editor/schema";
import type { TimedWord } from "./captions.ts";
import { findWords } from "./fillers.ts";
import type { PlanState } from "./plan.ts";
import { bare } from "./text.ts";

/** The templates the planner places. A callout needs the region of the screen the speaker refers
 * to, which no index holds: finding it would take reading the screen at the moment it is named. */
export const PLANNED: readonly TemplateId[] = ["title", "lower-third", "keyword", "chapter", "wipe"]; // biome-ignore format: one line
/** Keyword pops per minute of edit at most, the top of the catalog's one to three. */
const KEYWORDS_PER_MINUTE = 3;
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
 * it, a lower third the first time each named person speaks, and keyword pops on the emphasised
 * moments, in that order of precedence. One that would overlap another, run shorter than its
 * template allows or break its params is left out; an optional param that breaks them (a
 * subtitle or role too long) is left out alone. `broll` is where B-roll covers the speaker,
 * which a lower third waits for or else is left out; `cuts` are where the clips join.
 */
export function plannedOverlays(
  state: PlanState,
  words: readonly TimedWord[],
  edit: number,
  broll: readonly { start: number; duration: number }[] = [],
  cuts: readonly number[] = [],
): Overlay[] {
  const frame = ticksPerFrame(state.fps);
  const onFrame = (ticks: number) => Math.max(0, Math.round(ticks / frame) * frame);
  const wanted: Overlay[] = [];
  const add = (template: TemplateId, start: number, params: Record<string, unknown>) => {
    const { min, typical } = catalog[template].seconds;
    const from = onFrame(start);
    const duration = Math.min(onFrame(secondsToTicks(typical)), edit - from);
    if (duration >= secondsToTicks(min)) wanted.push({ template, start: from, duration, params });
  };
  /** The first kept word of a source's line, on the output timeline. */
  const lineStart = (source: string, n: number) => {
    const line = state.sources.get(source)?.lines.find((l) => l.n === n);
    return line && words.find((w) => w.source === source && w.index >= line.first && w.index <= line.last); // biome-ignore format: one line
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
    add("lower-third", word.start + secondsToTicks(NAME_DELAY), { name, ...optional("role", person.role) }); // biome-ignore format: one line
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
    if (word) add("keyword", word.start - secondsToTicks(KEYWORD_LEAD), { text: keyword, position: "upper" }); // biome-ignore format: one line
  }

  // One at a time, the earlier-listed first: at 9:16 the lower third, the chapter marker and an
  // upper keyword share the top of the frame, and two effects at once compete for the eye. A
  // wipe covers the cut just before its chapter's marker comes in, so those two may overlap.
  const kept: Overlay[] = [];
  let keywords = Math.max(1, Math.floor((KEYWORDS_PER_MINUTE * edit) / secondsToTicks(60)));
  const paired = (a: string, b: string) =>
    (a === "wipe" && b === "chapter") || (a === "chapter" && b === "wipe");
  // A lower third names someone on camera, so B-roll over them blocks it too.
  const clash = ({ template, start, duration }: Overlay) =>
    [
      ...kept.filter((k) => !paired(template, k.template)),
      ...(template === "lower-third" ? broll : []),
    ].filter((k) => start < k.start + k.duration && k.start < start + duration);
  for (const wish of wanted) {
    if (wish.template === "keyword" && keywords === 0) continue;
    let overlay = wish;
    const blocking = clash(overlay);
    const wait = WAIT[overlay.template as TemplateId];
    if (blocking.length > 0 && wait !== undefined) {
      const start = onFrame(Math.max(...blocking.map((k) => k.start + k.duration)) + frame);
      if (start - wish.start <= secondsToTicks(wait) && start + overlay.duration <= edit) {
        overlay = { ...overlay, start };
      }
    }
    if (clash(overlay).length > 0) continue;
    if (overlayProblems([overlay]).length > 0) {
      const { subtitle, role, ...required } = overlay.params;
      overlay = { ...overlay, params: required };
      if (overlayProblems([overlay]).length > 0) continue;
    }
    kept.push(overlay);
    if (overlay.template === "keyword") keywords--;
  }
  return kept.sort((a, b) => a.start - b.start);
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
