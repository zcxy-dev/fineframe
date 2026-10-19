// Cutting stretches out of a finished edit, for `pnpm render --cut`: the main track loses the
// words said in them, and everything on the output timeline moves up to follow.

import { dirname, resolve } from "node:path";
import {
  type CaptionLine,
  loadJson,
  type Project,
  secondsToTicks,
  TICKS_PER_SECOND,
  ticksPerFrame,
  validateMediaIndex,
  type Word,
} from "@video-editor/schema";
import {
  cuttableAfter,
  endOnFrame,
  MARGIN,
  type PlacedClip,
  type PlaceSource,
  placeClips,
} from "./plan/place.ts";
import { stemMarks } from "./plan/stem.ts";
import { joinWords } from "./plan/text.ts";
import { gridTicks } from "./sources.ts";

type Clip = Project["main"][number];

/** A stretch of the old edit that plays on in the new one: `length` ticks from `from` in the old
 * output, now at `to`. */
interface Kept {
  from: number;
  to: number;
  length: number;
}

export interface CutResult {
  project: Project;
  /** The edit's new length, in ticks. */
  length: number;
  /** What was taken out, for a person to check: the words, and what moved or went with them. */
  notes: string[];
  /** The stretches of the old edit that no longer play, in its output ticks, in order: where
   * each cut landed once moved into the pauses. */
  removed: [number, number][];
  /** The words a cut took beyond those asked for, by the range it came from, where no pause a
   * cut fits in lay inside that range. */
  outside: { range: number; words: string }[];
}

/** The words, length, frame grid, shot changes and voice stem's marks of every analysed source on
 * the main track, from the media index the project names for it. */
export async function placeSources(
  project: Project,
  projectPath: string,
): Promise<Map<string, PlaceSource>> {
  const used = new Set(project.main.map((clip) => clip.source));
  const sources = new Map<string, PlaceSource>();
  for (const source of project.sources) {
    if (!used.has(source.id) || !source.index) continue;
    const indexPath = resolve(dirname(projectPath), source.index);
    const index = await loadJson(indexPath, validateMediaIndex);
    sources.set(source.id, {
      id: source.id,
      words: index.transcript.words as Word[],
      duration: index.source.duration,
      frameTicks: gridTicks(index.source.video?.fps ?? 0),
      shots: index.transitions.map((t) => [t.start, t.end] as const),
      ...(await stemMarks(index, indexPath)),
    });
  }
  return sources;
}

/**
 * Takes `ranges` (output ticks, [from, to)) out of the edit. A word goes when its middle falls
 * in a range, and a clip goes when a range covers it or none of its words is left. Where words
 * go from inside a clip, each edge of what goes moves to a pause a cut fits in: inward first,
 * keeping some words asked for rather than taking one not asked for, and outward only when
 * none lies inside (`outside` says which words that took). The clip splits around them, each
 * new end placed in that pause as the planner places cuts, so no cut falls inside a word or
 * between two words said without a pause. Captions,
 * overlays, B-roll, cards, music, sound effects and the planner's emphasis move with the speech
 * they were on; a caption word that went is taken out of its line, and an overlay, B-roll clip or
 * card whose whole time went goes too. B-roll of a source the main track plays, the speaker beside
 * a split screen, splits where the main track does, so it stays in step.
 */
export function cutEdit(
  project: Project,
  ranges: readonly (readonly [number, number])[],
  sources: ReadonlyMap<string, PlaceSource>,
): CutResult {
  const frame = ticksPerFrame(project.output.fps);
  // Which ranges took something out, so one that took nothing fails instead of passing for done.
  const used = new Set<number>();
  const inRange = (t: number) => {
    const r = ranges.findIndex(([a, b]) => t >= a && t < b);
    if (r >= 0) used.add(r);
    return r >= 0;
  };
  const seconds = (ticks: number) => (ticks / TICKS_PER_SECOND).toFixed(2);
  const notes: string[] = [];
  const outside: CutResult["outside"] = [];

  const main: Clip[] = [];
  const kept: Kept[] = [];
  let position = 0;
  let next = 0;
  const place = (clip: Clip, from: number) => {
    const dissolve = main.length > 0 && clip.transition?.type === "dissolve";
    const to = dissolve ? next - (clip.transition?.duration ?? 0) : next;
    const first = main.length === 0;
    const { transition, ...rest } = clip;
    main.push(first || !transition ? rest : clip);
    kept.push({ from, to, length: clip.out - clip.in });
    next = to + clip.out - clip.in;
  };

  // Where each main clip started before the cut.
  const placed: { clip: Clip; start: number }[] = [];
  for (const [i, clip] of project.main.entries()) {
    const dissolve = i > 0 && clip.transition?.type === "dissolve";
    const start = dissolve ? position - (clip.transition?.duration ?? 0) : position;
    placed.push({ clip, start });
    position = start + clip.out - clip.in;
    const end = position;
    const at = (ticks: number) => start + ticks - clip.in;
    const covering = ranges.findIndex(([a, b]) => a <= start && b >= end);
    if (covering >= 0) {
      used.add(covering);
      notes.push(`Cut /main/${i} whole, ${seconds(start)}–${seconds(end)} s`);
      continue;
    }
    const source = sources.get(clip.source);
    const mid = (word: Word) => secondsToTicks((word.start + word.end) / 2);
    const words = (source?.words ?? []).flatMap((word, index) =>
      mid(word) >= clip.in && mid(word) < clip.out ? [index] : [],
    );
    const asked = words.filter((index) => inRange(at(mid(source?.words[index] as Word))));
    if (!source || asked.length === 0) {
      place(clip, start);
      continue;
    }
    const { gone, beyond } = toPauses(words, new Set(asked), source);
    const said = (list: number[]) =>
      joinWords(list.map((index) => source.words[index]?.text ?? ""));
    notes.push(`Cut from /main/${i}, ${seconds(start)}–${seconds(end)} s: ${said(gone)}`);
    for (const run of beyond) {
      const t = at(mid(source.words[run.first] as Word));
      const range = ranges.findIndex(([a, b]) => t >= a && t < b);
      const [a, b] = ranges[range] as readonly [number, number];
      // What it took before the stretch and after it, apart.
      const text = [run.before, run.after]
        .filter((list) => list.length > 0)
        .map(said)
        .join(" … ");
      outside.push({ range, words: text });
      notes.push(
        `${seconds(a)}–${seconds(b)} s has no pause a cut fits in inside it, so it also takes: ${text}`,
      );
    }
    // Runs of the words left, each played by a clip of its own whose ends next to the words cut
    // are placed as the planner places a cut; a pause inside a run stays as it was.
    const runs: number[][] = [];
    for (const index of words) {
      if (gone.includes(index)) continue;
      const run = runs.at(-1);
      if (run && run.at(-1) === index - 1) run.push(index);
      else runs.push([index]);
    }
    for (const run of runs) {
      const head = run[0] === words[0];
      const tail = run.at(-1) === words.at(-1);
      const edge = (index: number) =>
        placeClips([{ source: clip.source, words: [index] }], sources, frame)[0] as PlacedClip;
      const first = run[0] as number;
      const lastIndex = run.at(-1) as number;
      const clipIn = head ? clip.in : edge(first).in;
      const last = source.words[lastIndex] as Word;
      const after = source.words[lastIndex + 1];
      const limit = source.duration > 0 ? source.duration : 1e9;
      const clipOut = endOnFrame(
        clipIn,
        tail ? clip.out : edge(lastIndex).out,
        secondsToTicks(last.end + MARGIN),
        secondsToTicks(after ? after.start - MARGIN : limit),
        frame,
      );
      const split: Clip = { ...clip, in: clipIn, out: clipOut };
      if (!head) delete split.transition;
      place(split, at(clipIn));
    }
  }
  for (const [r, [a, b]] of ranges.entries()) {
    if (!used.has(r)) throw new Error(`${seconds(a)}–${seconds(b)} s takes out no words`);
  }
  if (main.length === 0) throw new Error("The cut leaves nothing of the edit");

  // Old output time to new: a stretch that plays on, or null for time cut out.
  const map = (t: number): number | null => {
    for (const k of kept) if (t >= k.from && t < k.from + k.length) return k.to + t - k.from;
    return null;
  };
  // The first moment at or after `t` that plays on, old and new.
  const after = (t: number): { from: number; to: number } | null => {
    const to = map(t);
    if (to !== null) return { from: t, to };
    const k = kept.filter((k) => k.from > t).sort((a, b) => a.from - b.from)[0];
    return k ? { from: k.from, to: k.to } : null;
  };
  // How much of [a, b) of the old output plays on. Clips a dissolve overlaps cover some of the
  // old output twice, which counts once.
  const covered: [number, number][] = [];
  for (const k of [...kept].sort((x, y) => x.from - y.from)) {
    const last = covered.at(-1);
    if (last && k.from <= last[1]) last[1] = Math.max(last[1], k.from + k.length);
    else covered.push([k.from, k.from + k.length]);
  }
  const keptOf = (a: number, b: number) =>
    covered.reduce((sum, [x, y]) => sum + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);
  // How far a moment that plays on moves, or null for one cut out.
  const moveBy = (t: number): number | null => {
    const to = map(t);
    return to === null ? null : to - t;
  };
  const touched = (a: number, b: number) => ranges.some(([x, y]) => x < b && y > a);

  const out: Project = { ...project, main: main as Project["main"] };
  if (project.captions) {
    const lines = project.captions.lines.flatMap((line): CaptionLine[] => {
      const words = line.words ?? [];
      if (words.length === 0) {
        const shift = moveBy(Math.floor((line.start + line.end) / 2));
        return shift === null
          ? []
          : [{ ...line, start: line.start + shift, end: line.end + shift }];
      }
      const shifts = words.map((word) => moveBy(Math.floor((word.start + word.end) / 2)));
      const moved = words.flatMap((word, w) => {
        const shift = shifts[w];
        return shift == null ? [] : [{ ...word, start: word.start + shift, end: word.end + shift }];
      });
      const first = moved[0];
      const last = moved.at(-1);
      if (!first || !last) return [];
      const head = shifts[0];
      const tail = shifts.at(-1);
      return [
        {
          ...line,
          // A line keeps the time it showed before its first word and after its last.
          start: head == null ? first.start : line.start + head,
          end: tail == null ? last.end : line.end + tail,
          text: moved.length === words.length ? line.text : without(line.text, words, shifts),
          words: moved,
        },
      ];
    });
    out.captions = { ...project.captions, lines };
  }
  // Placed by its start: it goes when its whole time went, and moves to the first moment left.
  // Music plays on under a cut, so only what is seen is worth a second look.
  const span = (start: number, length: number, path: string, seen = true) => {
    const moved = after(start);
    if (!moved || moved.from >= start + length) {
      notes.push(`Removed ${path}, all of it in the cut`);
      return null;
    }
    if (seen && touched(start, start + length))
      notes.push(`${path} overlapped the cut; check it still fits`);
    return moved;
  };
  if (project.overlays) {
    out.overlays = project.overlays.flatMap((overlay, i) => {
      const moved = span(overlay.start, overlay.duration, `/overlays/${i} (${overlay.template})`);
      return moved ? [{ ...overlay, start: moved.to }] : [];
    });
  }
  // The speaker beside a split screen plays the main clip under it in step with it, so it
  // splits wherever the main track does.
  const inStep = (clip: NonNullable<Project["broll"]>[number]) =>
    placed.some(
      ({ clip: main, start }) =>
        main.source === clip.source &&
        clip.start >= start &&
        clip.start < start + main.out - main.in &&
        clip.in === main.in + clip.start - start,
    );
  if (project.broll) {
    out.broll = project.broll.flatMap((clip, i) => {
      const step = inStep(clip);
      const moved = span(clip.start, clip.out - clip.in, `/broll/${i}`, !step);
      if (!moved) return [];
      const end = clip.start + clip.out - clip.in;
      if (step) {
        return kept.flatMap((k) => {
          const from = Math.max(clip.start, k.from);
          const to = Math.min(end, k.from + k.length);
          if (to <= from) return [];
          const clipIn = clip.in + from - clip.start;
          return [{ ...clip, start: k.to + from - k.from, in: clipIn, out: clipIn + to - from }];
        });
      }
      const clipIn = clip.in + moved.from - clip.start;
      const length = keptOf(moved.from, end);
      return [{ ...clip, start: moved.to, in: clipIn, out: clipIn + length }];
    });
  }
  if (project.cards) {
    out.cards = project.cards.flatMap((card, i) => {
      const moved = span(card.start, card.duration, `/cards/${i} (${card.card})`);
      if (!moved) return [];
      return [
        { ...card, start: moved.to, duration: keptOf(moved.from, card.start + card.duration) },
      ];
    });
  }
  if (project.audio.music) {
    const music = project.audio.music.flatMap((track, i) => {
      const moved = span(track.start, track.out - track.in, `/audio/music/${i}`, false);
      if (!moved) return [];
      const trackIn = track.in + moved.from - track.start;
      const length = keptOf(moved.from, track.start + track.out - track.in);
      return [{ ...track, start: moved.to, in: trackIn, out: trackIn + length }];
    });
    out.audio = { ...project.audio, music };
  }
  if (project.audio.sfx) {
    // A sound effect goes with the moment it marks.
    const sfx = project.audio.sfx.flatMap((effect, i) => {
      const to = map(effect.start);
      if (to === null) notes.push(`Removed /audio/sfx/${i}, its moment in the cut`);
      return to === null ? [] : [{ ...effect, start: to }];
    });
    out.audio = { ...(out.audio ?? project.audio), sfx };
  }
  const length = next;
  if (project.plan) {
    const emphasis = project.plan.emphasis?.flatMap((moment) => {
      const shift = moveBy(Math.floor((moment.start + moment.end) / 2));
      return shift === null
        ? []
        : [{ ...moment, start: moment.start + shift, end: moment.end + shift }];
    });
    out.plan = {
      ...project.plan,
      ...(project.plan.fit ? { fit: { ...project.plan.fit, duration: length } } : {}),
      ...(emphasis ? { emphasis } : {}),
    };
  }
  const removed: [number, number][] = [];
  let from = 0;
  for (const [a, b] of covered) {
    if (a > from) removed.push([from, a]);
    from = Math.max(from, b);
  }
  if (position > from) removed.push([from, position]);
  return { project: out, length, notes, removed, outside };
}

/** The words to take out of a clip that plays `words` (source indices, ascending, one after
 * another) once each edge of the runs in `asked` sits in a pause a cut fits in. An edge between
 * two words said without one moves inward first, to the nearest pause inside the run, so no word
 * goes that was not asked for, though some asked for may stay; only a run with no such pause
 * inside grows outward to the nearest pauses, and `beyond` lists the words that took before it
 * and after it, by the run's first word asked for. The clip's own ends are cuts already. */
function toPauses(
  words: readonly number[],
  asked: ReadonlySet<number>,
  source: PlaceSource,
): { gone: number[]; beyond: { first: number; before: number[]; after: number[] }[] } {
  const n = words.length;
  // Edge b lies before words[b]; 0 and n are the clip's ends.
  const fits = (b: number) => b === 0 || b === n || cuttableAfter(source, words[b - 1] as number);
  const gone = new Set<number>();
  const beyond: { first: number; before: number[]; after: number[] }[] = [];
  for (let p = 0; p < n; p++) {
    if (!asked.has(words[p] as number)) continue;
    let q = p;
    while (q + 1 < n && asked.has(words[q + 1] as number)) q++;
    // Inside the run, each edge keeps at least one word between them.
    let first = p;
    while (first <= q && !fits(first)) first++;
    let last = q + 1;
    while (last > first && first <= q && !fits(last)) last--;
    if (first > q || last <= first) {
      // No pause inside: out to the nearest on each side.
      first = p;
      while (!fits(first)) first--;
      last = q + 1;
      while (!fits(last)) last++;
    }
    for (let r = first; r < last; r++) gone.add(words[r] as number);
    const before = words.slice(first, p);
    const after = words.slice(q + 1, last);
    if (before.length + after.length > 0) beyond.push({ first: words[p] as number, before, after });
    p = q;
  }
  return { gone: words.filter((index) => gone.has(index)), beyond };
}

/** A caption line's text without the words a cut took out (a null shift): each word is found in
 * the text in order. Words cut between two kept ones take with them what follows them, so the
 * two are set apart as they were before the first word cut; the line's own marks before its
 * first word and after its last stay. A text that no longer holds its words, as after a hand
 * edit of one and not the other, is rebuilt from them. */
function without(
  text: string,
  words: readonly { text: string }[],
  shifts: readonly (number | null)[],
): string {
  const spans: [number, number][] = [];
  let cursor = 0;
  for (const word of words) {
    const at = text.indexOf(word.text, cursor);
    if (at < 0) return joinWords(words.filter((_, w) => shifts[w] != null).map((w) => w.text));
    spans.push([at, at + word.text.length]);
    cursor = at + word.text.length;
  }
  let result = "";
  let position = 0;
  for (let w = 0; w < words.length; w++) {
    if (shifts[w] != null) continue;
    let last = w;
    while (last + 1 < words.length && shifts[last + 1] == null) last++;
    const [from] = spans[w] as [number, number];
    const next = spans[last + 1];
    const to = next ? next[0] : (spans[last] as [number, number])[1];
    result += text.slice(position, from);
    position = to;
    w = last;
  }
  return (result + text.slice(position)).trim();
}
