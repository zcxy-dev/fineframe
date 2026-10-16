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
import { endOnFrame, MARGIN, type PlaceSource, placeClips } from "./plan/place.ts";
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
}

/** The words, length and frame grid of every analysed source on the main track, from the media
 * index the project names for it. */
export async function placeSources(
  project: Project,
  projectPath: string,
): Promise<Map<string, PlaceSource>> {
  const used = new Set(project.main.map((clip) => clip.source));
  const sources = new Map<string, PlaceSource>();
  for (const source of project.sources) {
    if (!used.has(source.id) || !source.index) continue;
    const index = await loadJson(resolve(dirname(projectPath), source.index), validateMediaIndex);
    sources.set(source.id, {
      id: source.id,
      words: index.transcript.words as Word[],
      duration: index.source.duration,
      frameTicks: gridTicks(index.source.video?.fps ?? 0),
    });
  }
  return sources;
}

/**
 * Takes `ranges` (output ticks, [from, to)) out of the edit. A word goes when its middle falls
 * in a range, and a clip goes when a range covers it or none of its words is left. Where words
 * go from inside a clip, the clip splits around them, and each new end is placed in the pause
 * beside the words kept, as the planner places cuts, so no cut falls inside a word. Captions,
 * overlays, B-roll, music and the planner's emphasis move with the speech they were on; a caption
 * word that went is taken out of its line, and an overlay or B-roll clip whose whole time went
 * goes too.
 */
export function cutEdit(
  project: Project,
  ranges: readonly (readonly [number, number])[],
  sources: ReadonlyMap<string, PlaceSource>,
): CutResult {
  const frame = ticksPerFrame(project.output.fps);
  const inRange = (t: number) => ranges.some(([a, b]) => t >= a && t < b);
  const seconds = (ticks: number) => (ticks / TICKS_PER_SECOND).toFixed(2);
  const notes: string[] = [];

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

  for (const [i, clip] of project.main.entries()) {
    const dissolve = i > 0 && clip.transition?.type === "dissolve";
    const start = dissolve ? position - (clip.transition?.duration ?? 0) : position;
    position = start + clip.out - clip.in;
    const end = position;
    const at = (ticks: number) => start + ticks - clip.in;
    if (ranges.some(([a, b]) => a <= start && b >= end)) {
      notes.push(`Cut /main/${i} whole, ${seconds(start)}–${seconds(end)} s`);
      continue;
    }
    const source = sources.get(clip.source);
    const mid = (word: Word) => secondsToTicks((word.start + word.end) / 2);
    const words = (source?.words ?? []).flatMap((word, index) =>
      mid(word) >= clip.in && mid(word) < clip.out ? [index] : [],
    );
    const gone = words.filter((index) => inRange(at(mid(source?.words[index] as Word))));
    if (!source || gone.length === 0) {
      place(clip, start);
      continue;
    }
    const said = (list: number[]) => list.map((index) => source.words[index]?.text).join(" ");
    notes.push(`Cut from /main/${i}, ${seconds(start)}–${seconds(end)} s: ${said(gone)}`);
    // Runs of the words left, each played by a clip of its own.
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
      const placed = placeClips([{ source: clip.source, words: run }], sources, frame);
      for (const [p, piece] of placed.entries()) {
        const clipIn = head && p === 0 ? clip.in : piece.in;
        const last = source.words[piece.last] as Word;
        const after = source.words[piece.last + 1];
        const limit = source.duration > 0 ? source.duration : 1e9;
        const clipOut = endOnFrame(
          clipIn,
          tail && p === placed.length - 1 ? clip.out : piece.out,
          secondsToTicks(last.end + MARGIN),
          secondsToTicks(after ? after.start - MARGIN : limit),
          frame,
        );
        const split: Clip = { ...clip, in: clipIn, out: clipOut };
        if (!(head && p === 0)) delete split.transition;
        place(split, at(clipIn));
      }
    }
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
  // How much of [a, b) of the old output plays on.
  const keptOf = (a: number, b: number) =>
    kept.reduce(
      (sum, k) => sum + Math.max(0, Math.min(b, k.from + k.length) - Math.max(a, k.from)),
      0,
    );
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
  const span = (start: number, length: number, path: string) => {
    const moved = after(start);
    if (!moved || moved.from >= start + length) {
      notes.push(`Removed ${path}, all of it in the cut`);
      return null;
    }
    if (touched(start, start + length))
      notes.push(`${path} overlapped the cut; check it still fits`);
    return moved;
  };
  if (project.overlays) {
    out.overlays = project.overlays.flatMap((overlay, i) => {
      const moved = span(overlay.start, overlay.duration, `/overlays/${i} (${overlay.template})`);
      return moved ? [{ ...overlay, start: moved.to }] : [];
    });
  }
  if (project.broll) {
    out.broll = project.broll.flatMap((clip, i) => {
      const moved = span(clip.start, clip.out - clip.in, `/broll/${i}`);
      if (!moved) return [];
      const clipIn = clip.in + moved.from - clip.start;
      const length = keptOf(moved.from, clip.start + clip.out - clip.in);
      return [{ ...clip, start: moved.to, in: clipIn, out: clipIn + length }];
    });
  }
  if (project.audio.music) {
    const music = project.audio.music.flatMap((track, i) => {
      const moved = span(track.start, track.out - track.in, `/audio/music/${i}`);
      if (!moved) return [];
      const trackIn = track.in + moved.from - track.start;
      const length = keptOf(moved.from, track.start + track.out - track.in);
      return [{ ...track, start: moved.to, in: trackIn, out: trackIn + length }];
    });
    out.audio = { ...project.audio, music };
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
  return { project: out, length, notes };
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
