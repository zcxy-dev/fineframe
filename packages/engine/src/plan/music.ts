// Background music for a planned edit. Claude picks the track and the section to open on from the
// content's mood; code fits it to the edit's length on the track's phrases, sets its level from
// the speech's, and gives the output beats that B-roll cuts land on.

import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  loadJson,
  type MediaIndex,
  type MusicIndex,
  type MusicTrack,
  type Project,
  secondsToTicks,
  TICKS_PER_SECOND,
  validateMusicIndex,
} from "@video-editor/schema";
import { gatedMean } from "../graph/music.ts";
import { fingerprintOf } from "../sources.ts";
import { SPEECH_LUFS } from "../voice.ts";
import { formatDuration } from "./pack.ts";

/** Bars in a phrase: music enters and loops only where one starts. */
export const PHRASE = 4;
/** How far the music sits under the speech's loudness while someone talks, and in the pauses,
 * in LU. The first keeps the voice at least 15 dB over the music while talking, with a margin
 * for the quiet ends of phrases (measured in
 * packages/engine/MEASUREMENTS.md#music-measurements); the second lets the music carry the gaps
 * without competing with the voice. */
export const UNDER_SPEECH = 18;
export const UNDER_PAUSES = 6;
/** Ducking down before speech and back up after it, in milliseconds. */
const ATTACK_MS = 250;
const RELEASE_MS = 750;
/** The most a quiet track is raised, so its noise floor stays down. */
const MAX_GAIN_DB = 12;
/** A cut that need not land between words moves to the nearest beat this close, in seconds. */
const SNAP = 0.15;
/** Loop joins sit this far before the downbeats they join, so they fall before the hits rather
 * than through them, and cross-fade over this long. */
const JOIN_BEFORE = 0.05;
const CROSSFADE = 0.04;
/** A fade-out that ends the music, where it cannot end on its own ending, starts on the last bar
 * line at least this long before the edit ends. */
const FADE_MIN = 2;
/** Beats this close to a constant tempo make a beat grid the check can verify. */
const STEADY = 0.02;

/** A track the planner may use: one music index and the file next to it. */
export interface MusicSource {
  /** Unique among the project's sources: `music-` and the file's name. */
  id: string;
  /** Absolute paths. */
  path: string;
  indexPath: string;
  index: MusicIndex;
  fingerprint: Project["sources"][number]["fingerprint"];
}

/** A music index file, whose track is the one it names next to it, or a folder of
 * `*.music.json`; or an index with its track, wherever each is kept. */
export type MusicInput = string | { index: string; source: string };

/** Reads music indexes (`vework analyze-music`), or folders of `*.music.json`, and checks each
 * names a track that is there. */
export async function loadMusic(
  inputs: readonly MusicInput[],
  taken: ReadonlySet<string>,
): Promise<Map<string, MusicSource>> {
  const files: { indexPath: string; source?: string }[] = [];
  for (const input of inputs) {
    if (typeof input !== "string") {
      files.push({ indexPath: resolve(input.index), source: resolve(input.source) });
      continue;
    }
    const path = resolve(input);
    if (extname(path) === ".json") {
      files.push({ indexPath: path });
      continue;
    }
    const names = (await readdir(path)).filter((name) => name.endsWith(".music.json")).sort();
    if (names.length === 0) throw new Error(`${input}: no music index (*.music.json) in it`);
    files.push(...names.map((name) => ({ indexPath: join(path, name) })));
  }
  const tracks = new Map<string, MusicSource>();
  for (const { indexPath, source } of files) {
    const index = await loadJson(indexPath, validateMusicIndex);
    const path = source ?? join(dirname(indexPath), index.source.name);
    if (!existsSync(path)) {
      throw new Error(
        source
          ? `${path}: no such file, which ${indexPath} describes`
          : `${indexPath}: ${index.source.name} is not next to it`,
      );
    }
    const stem = basename(path, extname(path)).replace(/[^A-Za-z0-9._-]/g, "-");
    const base = `music-${stem}`;
    let id = base;
    for (let n = 2; taken.has(id) || tracks.has(id); n++) id = `${base}-${n}`;
    tracks.set(id, { id, path, indexPath, index, fingerprint: await fingerprintOf(path) });
  }
  return tracks;
}

/** The tracks as the planning request lists them: tempo, length and how loud each section is. */
export function describeMusic(tracks: Iterable<MusicSource>): string {
  const lines = [
    "Music tracks the user supplied, each with its licence. Choose the one whose mood fits the " +
      "content, and the section the edit opens on, or none.",
  ];
  for (const { id, index } of tracks) {
    const bpm = index.tempo.bpm ? `${Math.round(index.tempo.bpm)} BPM` : "no steady beat";
    const sections = index.sections
      .map((s, i) => `${i + 1}) ${s.start.toFixed(1)}-${s.end.toFixed(1)} s, ${s.loudness} LUFS`)
      .join("; ");
    lines.push(
      `${id}: ${index.source.name}, ${formatDuration(index.end)}, ${bpm}, licence ` +
        `${index.license.name}. Sections: ${sections}`,
    );
  }
  return lines.join("\n");
}

/** A path through the track: source ranges in seconds, played back to back. */
type Path = [number, number][];

/** Where the music goes in an edit: a path through the track, how far into the edit it starts,
 * its fades in seconds, and whether it lasts until the edit ends. */
interface Fit {
  path: Path;
  delay: number;
  fadeIn: number;
  fadeOut: number;
  fills: boolean;
}

/** Seconds closer than this are the same time. */
const EPSILON = 1e-6;

/**
 * The music for an edit of `length` seconds: `track` from the phrase that opens `section`
 * (counted from 1), at the level `voiceLufs` calls for, ducked under speech.
 *
 * The music ends on the track's own ending at the edit's last frame. It enters on a phrase at
 * most a bar after the edit starts; to get there, it skips whole phrases forward, or loops back
 * to the chosen section from the track's last section, joining on downbeats. When no path lands
 * within a bar, it enters at the section and fades out, from a bar line, as the edit ends. A
 * section that cannot last the edit even looped, such as a last phrase on its own, gives way to
 * the one before it.
 * A track without a bar grid plays from its start and fades out if it is longer than the edit.
 */
export function fitMusic(
  track: MusicSource,
  section: number,
  length: number,
  voiceLufs: number,
): MusicTrack[] {
  const { index } = track;
  const fit = fitTrack(index, section, length);
  const used = loudnessOver(index, fit.path);
  const gainDb = Math.min(MAX_GAIN_DB, voiceLufs - UNDER_PAUSES - used);
  const common = {
    source: track.id,
    license: index.license,
    gainDb: Math.round(gainDb * 10) / 10,
    ducking: { depthDb: UNDER_PAUSES - UNDER_SPEECH, attackMs: ATTACK_MS, releaseMs: RELEASE_MS },
    ...beatGrid(index),
  };
  // A track whose index has no sound in it fits as an empty range, which no edit can play.
  return toTracks(fit.path, fit.delay, fit.fadeIn, fit.fadeOut)
    .filter((range) => range.out > range.in)
    .map((range) => ({ ...common, ...range }));
}

/** The fit from the chosen section, or from the nearest one before it that lasts the edit. */
function fitTrack(index: MusicIndex, section: number, length: number): Fit {
  const { downbeats, end } = index;
  const bar = median(downbeats.slice(1).map((d, i) => d - (downbeats[i] as number)));
  if (downbeats.length < 2 * PHRASE || !bar) {
    const out = Math.min(end, length);
    const fadeOut = end > length ? FADE_MIN : 0;
    return { path: [[0, out]], delay: 0, fadeIn: 0, fadeOut, fills: out >= length - EPSILON };
  }
  const beat = index.tempo.bpm ? 60 / index.tempo.bpm : bar / PHRASE;
  const chosen = Math.min(Math.max(1, Math.round(section)), Math.max(1, index.sections.length));
  let first: Fit | null = null;
  for (let s = chosen; s >= 1; s--) {
    const fit = fitSection(index, s, length, bar, beat);
    if (fit.fills) return fit;
    first ??= fit;
  }
  return first as Fit;
}

/** The music entering on `section`: on whole phrases if a path lands within a bar, otherwise
 * from the section's start, looped as needed and faded out as the edit ends. */
function fitSection(
  index: MusicIndex,
  section: number,
  length: number,
  bar: number,
  beat: number,
): Fit {
  const { downbeats, end } = index;
  const phrases = phraseStarts(index);
  const phraseTimes = phrases.map((i) => downbeats[i] as number);
  const chosen = index.sections[section - 1];
  const first = chosen?.start ?? 0;
  const last = chosen?.end ?? end;
  // A long edit loops back to the chosen section from the start of the track's last section,
  // which then plays once as the ending: the music runs through the sections in between instead
  // of repeating a short intro on its own.
  const final = index.sections.at(-1);
  const loopEnd = final && final !== chosen && final.start > first ? final.start : last;
  // Where the music may enter: the very start of the track, pickup and all, when the chosen
  // section is its first; any bar line of the chosen section. Paths join only on phrases, so
  // their lengths step by whole phrases; entering a bar or three into one makes up the rest.
  const entries = phrases.filter((i) => (downbeats[i] as number) >= first - 0.01);
  const bars = downbeats.filter((d) => d >= first - 0.01 && d < last - 0.01);
  const starts = [...(first === 0 ? [0] : []), ...bars];
  const loop = loopOf(phrases, entries, downbeats, loopEnd);
  // The decay after the last bar: fading it keeps the edit's end from cutting a ringing note.
  const tail = Math.min(end - ((downbeats.at(-1) as number) + bar), FADE_MIN);
  const best = bestPath(starts, phrases, loop, downbeats, end, length, bar);
  if (best) {
    // On a phrase it fades in over a beat, as it enters mid-track; inside one, until the next
    // phrase starts, so it arrives on it.
    const entry = best.path[0]?.[0] ?? 0;
    const next = phraseTimes.find((p) => p >= entry - 0.01) ?? entry;
    const fadeIn = entry === 0 ? 0 : Math.max(beat, next - entry);
    return { path: best.path, delay: best.delay, fadeIn, fadeOut: tail, fills: true };
  }
  const entry = downbeats[entries[0] ?? 0] ?? 0;
  const path = cover(entry, loop, downbeats, end, length);
  const fills = total(path) >= length - EPSILON;
  // Without a loop, a track shorter than the edit ends on its own ending, early.
  const fadeOut = fills ? fadeTail(path, downbeats, length) : tail;
  return { path, delay: 0, fadeIn: entry === 0 ? 0 : beat, fadeOut, fills };
}

/** Downbeat indices that start a phrase: every PHRASE bars from each section's first. */
function phraseStarts(index: MusicIndex): number[] {
  const starts: number[] = [];
  let origin = 0;
  for (const [i, downbeat] of index.downbeats.entries()) {
    if (index.sections.some((s) => s.start > 0 && Math.abs(s.start - downbeat) < 0.01)) origin = i;
    if ((i - origin) % PHRASE === 0) starts.push(i);
  }
  return starts;
}

/** The phrases a long edit repeats, as downbeat indices [first, after last): from the chosen
 * section's first phrase to `until`, short of the track's last phrase, so the ending still
 * plays after the loops. */
function loopOf(
  phrases: number[],
  entries: number[],
  downbeats: number[],
  until: number,
): [number, number] | null {
  const a = entries[0];
  const b = phrases
    .filter((i) => i <= downbeats.length - PHRASE && (downbeats[i] as number) <= until + 0.01)
    .at(-1);
  return a !== undefined && b !== undefined && b > a ? [a, b] : null;
}

/**
 * The path from one of `starts` to the track's end that lasts `length` less a delay of at most
 * a bar: straight through, one skip forward between phrases, or loops back over `loop` and a
 * last jump back to any phrase in it. Every range lasts at least a bar, so no join follows
 * another, or the start, within a few beats. The fewest joins wins, then an entry on a phrase,
 * then the shortest delay.
 */
function bestPath(
  starts: number[],
  phrases: number[],
  loop: [number, number] | null,
  downbeats: number[],
  end: number,
  length: number,
  bar: number,
): { path: Path; delay: number } | null {
  const at = (i: number) => downbeats[i] as number;
  const options: Path[] = [];
  for (const start of starts) {
    options.push([[start, end]]);
    for (const q of phrases) {
      for (const p of phrases) {
        if (at(q) > start && p > q)
          options.push([
            [start, at(q)],
            [at(p), end],
          ]);
      }
    }
    if (!loop) continue;
    const [a, b] = loop;
    if (at(b) <= start) continue;
    const span = at(b) - at(a);
    // A last jump back to b itself would only continue the loop's last pass.
    for (const p of phrases.filter((i) => i >= a && i < b)) {
      for (let k = 0; ; k++) {
        const path: Path = [[start, at(b)], ...Array(k).fill([at(a), at(b)]), [at(p), end]];
        if (total(path) > length) break;
        options.push(path);
        if (span <= 0) break;
      }
    }
  }
  const phraseTimes = phrases.map(at);
  const onPhrase = (path: Path) => {
    const entry = path[0]?.[0] ?? 0;
    return entry === 0 || phraseTimes.some((p) => Math.abs(p - entry) < 0.01) ? 0 : 1;
  };
  const fitting = options
    .filter((path) => path.every(([from, to]) => to - from >= bar - 0.01))
    .map((path) => ({ path, delay: length - total(path) }))
    .filter((option) => option.delay >= -EPSILON && option.delay <= bar)
    .map((option) => ({ ...option, delay: Math.max(0, option.delay) }))
    .sort(
      (x, y) =>
        x.path.length - y.path.length || onPhrase(x.path) - onPhrase(y.path) || x.delay - y.delay,
    );
  return fitting[0] ?? null;
}

/** From `entry`, looping back over `loop` as often as needed, until `length` seconds play. The
 * last pass then lasts longer than the track's last phrase, which leaves its fade-out room. */
function cover(
  entry: number,
  loop: [number, number] | null,
  downbeats: number[],
  end: number,
  length: number,
): Path {
  if (!loop || end - entry >= length) return [[entry, Math.min(end, entry + length)]];
  const [a, b] = [downbeats[loop[0]] as number, downbeats[loop[1]] as number];
  const path: Path = [[entry, b]];
  while (total(path) + (end - a) < length) path.push([a, b]);
  path.push([a, a + length - total(path)]);
  return path;
}

/** The fade-out that ends a path lasting the edit: from the last bar line of its last range
 * at least FADE_MIN before the edit ends, to the end. */
function fadeTail(path: Path, downbeats: number[], length: number): number {
  const [from, to] = path.at(-1) as [number, number];
  let fade = Math.min(FADE_MIN, to - from);
  for (const d of downbeats) {
    const remaining = to - d;
    if (d >= from - EPSILON && remaining >= FADE_MIN - EPSILON) fade = remaining;
  }
  return Math.min(fade, length);
}

/**
 * The path as music ranges, the first starting `delay` into the edit. Each join cross-fades
 * over CROSSFADE, centred JOIN_BEFORE before the downbeat it joins, so the hit is the incoming
 * range's alone and the beats run on as one grid; a downbeat too near the track's start for
 * that cross-fades as early as the track allows. Fades are in whole ticks and never outlast
 * their range: a fade-in until the next phrase ends where the cross-fade into it begins.
 */
function toTracks(path: Path, delay: number, fadeIn: number, fadeOut: number) {
  // How long before its downbeat each range starts.
  const leads = path.map(([from], k) =>
    k === 0 ? 0 : Math.min(JOIN_BEFORE + CROSSFADE / 2, from),
  );
  const ranges = [];
  let position = delay;
  for (const [k, [from, to]] of path.entries()) {
    const lead = leads[k] as number;
    const next = leads[k + 1];
    const inTicks = secondsToTicks(from - lead);
    const outTicks = secondsToTicks(next === undefined ? to : to - next + CROSSFADE);
    const span = outTicks - inTicks;
    const fadeOutTicks = Math.min(
      secondsToTicks(Math.max(0, next === undefined ? fadeOut : CROSSFADE)),
      span,
    );
    const fadeInTicks = Math.min(
      secondsToTicks(Math.max(0, k > 0 ? CROSSFADE : fadeIn)),
      span - fadeOutTicks,
    );
    ranges.push({
      in: inTicks,
      out: outTicks,
      start: secondsToTicks(position - lead),
      ...(fadeInTicks > 0 ? { fadeIn: fadeInTicks } : {}),
      ...(fadeOutTicks > 0 ? { fadeOut: fadeOutTicks } : {}),
    });
    position += to - from;
  }
  return ranges;
}

/** The beat grid of a track whose beats keep one tempo, for the check to verify cuts against. */
function beatGrid(index: MusicIndex): { beatGrid?: MusicTrack["beatGrid"] } {
  const beats = index.beats;
  const downbeat = index.downbeats[0];
  if (beats.length < 8 || downbeat === undefined) return {};
  // A least-squares line through the beats against their numbers.
  const n = beats.length;
  const mean = (n - 1) / 2;
  const average = beats.reduce((s, b) => s + b, 0) / n;
  let num = 0;
  let den = 0;
  for (const [i, b] of beats.entries()) {
    num += (i - mean) * (b - average);
    den += (i - mean) ** 2;
  }
  const period = num / den;
  const steady = beats.every((b, i) => Math.abs(average + (i - mean) * period - b) <= STEADY);
  if (!steady || period <= 0) return {};
  return {
    beatGrid: {
      bpm: Math.round((60 / period) * 1000) / 1000,
      downbeat: secondsToTicks(downbeat),
      beatsPerBar: index.tempo.beats_per_bar ?? PHRASE,
    },
  };
}

/** Where the beats of the music fall on the output timeline, in seconds, in order. */
export function outputBeats(music: readonly MusicTrack[], index: MusicIndex): number[] {
  const beats = new Set<number>();
  for (const track of music) {
    const from = track.in / TICKS_PER_SECOND;
    const to = track.out / TICKS_PER_SECOND;
    const start = track.start / TICKS_PER_SECOND;
    for (const b of index.beats) {
      // A cross-fade plays two ranges' beats at once; they are the same beats.
      if (b >= from && b < to) beats.add(Math.round((start + b - from) * 1000) / 1000);
    }
  }
  return [...beats].sort((x, y) => x - y);
}

/** Where a cut that may come early lands, such as the end of a shot that need not run its
 * whole length: the last beat from `earliest` to `latest`, when it is less than a beat before
 * `latest`; otherwise `latest`. Any unit, as long as all three are in it. */
export function lastBeat(latest: number, earliest: number, beats: readonly number[]): number {
  const period = median(beats.slice(1).map((b, i) => b - (beats[i] as number)));
  const found = beats.filter((b) => b >= earliest && b <= latest && latest - b < period).at(-1);
  return found ?? latest;
}

/** The beat nearest `seconds`, if one is within SNAP; otherwise `seconds` itself. */
export function snapToBeat(seconds: number, beats: readonly number[]): number {
  let best = seconds;
  let distance = SNAP;
  for (const b of beats) {
    if (Math.abs(b - seconds) <= distance) {
      best = b;
      distance = Math.abs(b - seconds);
    }
  }
  return best;
}

/**
 * The loudness of the speech the edit plays, as the render weighs it: BS.1770's gated mean over
 * the short-term values of each clip's seconds in its media index, which weighs each channel as
 * BS.1770 does, as the render's sound is weighed. A source with measured speech plays through its
 * voice chain, which brings its speech to SPEECH_LUFS, so its seconds are moved by as much. The
 * chain plays its mono mix in both channels, which a source recorded the same on both reads up
 * to 3 LU under, leaving the music further under it, not closer.
 */
export function speechLoudness(clips: { index: MediaIndex; in: number; out: number }[]): number {
  const values: number[] = [];
  for (const clip of clips) {
    const shortTerm = clip.index.loudness?.short_term;
    if (!shortTerm) {
      throw new Error(
        `${clip.index.source.name}: its media index has no loudness to set music under; run vework analyze again`,
      );
    }
    const from = Math.floor(clip.in / TICKS_PER_SECOND);
    const to = Math.ceil(clip.out / TICKS_PER_SECOND);
    const chain = clip.index.voice ? SPEECH_LUFS - clip.index.voice.recorded.speech_lufs : 0;
    values.push(...shortTerm.slice(from, to).map((value) => value + chain));
  }
  return gatedMean(values);
}

/** The music's loudness over the ranges it plays, from its index's seconds. */
function loudnessOver(index: MusicIndex, path: Path): number {
  const values = path.flatMap(([from, to]) =>
    index.loudness.slice(Math.floor(from), Math.max(Math.ceil(to), Math.floor(from) + 1)),
  );
  return gatedMean(values);
}

function total(path: Path): number {
  return path.reduce((sum, [from, to]) => sum + to - from, 0);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}
