import { secondsToTicks, TICKS_PER_SECOND, type Word } from "@video-editor/schema";

// Where code cuts, in seconds. The values are starting points for a hand-checked corpus to tune.

/** The closest a cut comes to a word edge: word timings are a few tens of milliseconds off. */
export const MARGIN = 0.04;
/** The shortest gap between two words that a cut fits in: both margins, plus 0.05 s of room for
 * a frame start between them, so the cut lands exactly where it is planned (see placeClips). The
 * room holds an output frame, since outputs run at 24000/1001 fps or faster (plan.ts), and a
 * source frame down to 20 fps; a slower source needs the wider gap of cutGap. */
export const CUT_GAP = 0.13;
/** Silence kept before the first word after a cut, and after the last word before one, where the
 * pause has that much: a natural breath at the join. */
export const LEAD = 0.15;
export const TAIL = 0.25;
/** A pause between two kept words up to this long is part of the speech; a longer one is dead
 * air, cut down to TAIL + LEAD. */
export const PAUSE_MAX = 0.75;
/** Silence kept beside a word a review found clipped, where the pause has that much. */
export const ROOM = 0.5;
/** Seconds of a source's sound per entry of PlaceSource.peaks. */
export const PEAK_BLOCK = 0.005;
/** A cut clicks when the sharpest jump in the sound within CLICK_WINDOW of it is more than CLICK
 * times the median PEAK_BLOCK peak within CLICK_CONTEXT around it. `vebench render` reads clicks
 * against the 99th percentile of the samples around instead, which this flags whenever it does
 * (README.md, What code does). CLICK_FLOOR keeps jumps in near-silence from counting. */
const CLICK = 4;
const CLICK_FLOOR = 0.004;
const CLICK_WINDOW = 0.005;
const CLICK_CONTEXT = 0.1;
/** How far the renderer may place a clip's sound from its planned time: Matroska times packets
 * in whole milliseconds. */
const SOUND_SLACK = 0.002;

/** What placing cuts needs to know about a source. */
export interface PlaceSource {
  id: string;
  words: readonly Word[];
  /** Seconds; 0 when unknown. */
  duration: number;
  /** Ticks per source frame, or null for a source without a frame grid. */
  frameTicks: number | null;
  /** Words that keep up to ROOM of silence at a cut beside them, instead of LEAD or TAIL. */
  roomy?: ReadonlySet<number>;
  /** Seconds, in order: speech no word covers, which the transcript missed. No cut falls in it. */
  unheard?: readonly (readonly [number, number])[];
  /** The sharpest jump in the source's sound in each PEAK_BLOCK from its start (the largest
   * second difference of its samples), or none when unknown. */
  peaks?: Float32Array;
}

/** Words of one source to play in a row, by index, ascending. */
export interface Stretch {
  source: string;
  words: number[];
}

/** A main-track clip and the words it plays: every word from `first` to `last`. */
export interface PlacedClip {
  source: string;
  /** Source ticks. */
  in: number;
  out: number;
  first: number;
  last: number;
}

const ticks = secondsToTicks;

interface Run {
  source: PlaceSource;
  first: number;
  last: number;
  /** Whether the run starts or ends at a pause cut down inside kept speech. */
  pauseBefore: boolean;
  pauseAfter: boolean;
}

/**
 * Turns the words to keep, in play order, into main-track clips, cutting only in silence: the
 * time between words less the speech the transcript missed (`unheard`), which plays with the
 * words beside it.
 *
 * - Consecutive words of one source play on in one clip, unless a silence between them is longer
 *   than PAUSE_MAX: that is cut down to a breath of TAIL + LEAD.
 * - Where words are left out, the clip before ends in the first silence after its last word that
 *   a cut fits in, and the next one starts in the last such silence before its first, or in the
 *   longest silence there when none fits, each at least MARGIN from the sound on either side. Up to TAIL and LEAD of silence stay with the
 *   sound, less when the silence is shorter.
 * - A clip that would start or end on a jump in its source's sound, such as a splice the source
 *   was edited with, starts on the first frame after the jump or ends before it, where that
 *   keeps MARGIN from the sound: it would click however the cut is faded.
 *
 * Each clip starts on a frame of its source and lasts whole output frames. The renderer then
 * moves neither end: it starts a clip on the source frame nearest its `in` and lays clips on the
 * output frame grid, which would otherwise shift a cut by up to half a source frame plus an
 * output frame, enough to clip a word next to a short gap.
 *
 * `breath` scales LEAD and TAIL, which is how the length is fine-tuned.
 */
export function placeClips(
  stretches: readonly Stretch[],
  sources: ReadonlyMap<string, PlaceSource>,
  outputFrameTicks: number,
  breath = 1,
): PlacedClip[] {
  const runs: Run[] = [];
  for (const stretch of stretches) {
    const source = sources.get(stretch.source);
    if (!source) throw new Error(`No words loaded for ${stretch.source}`);
    for (const i of stretch.words) {
      const run = runs.at(-1);
      const pause = run?.source === source && i === run.last + 1;
      if (pause && longestSilenceAfter(source, run.last) <= PAUSE_MAX) {
        run.last = i;
        continue;
      }
      if (pause) run.pauseAfter = true;
      runs.push({ source, first: i, last: i, pauseBefore: pause, pauseAfter: false });
    }
  }
  return runs.map(({ source, first, last, pauseBefore, pauseAfter }) => {
    const words = source.words;
    const head = words[first] as Word;
    const tail = words[last] as Word;
    const end = source.duration > 0 ? source.duration : Number.POSITIVE_INFINITY;
    const gap = cutGap(source.frameTicks);
    // A silence at the source's start or end needs no room: nothing plays beyond it.
    const fits = (pause: boolean) => (a: number, b: number) =>
      pause ? b - a > PAUSE_MAX : b - a >= gap || a <= 0 || b >= end;

    const [s0, s1] = nearest(silencesAfter(source, first - 1), fits(pauseBefore), true) ?? [
      words[first - 1]?.end ?? 0,
      head.start,
    ];
    const bounded = s0 > 0 || first > 0;
    const lead = source.roomy?.has(first) ? ROOM : LEAD * breath;
    const wantIn = s1 - Math.min(lead, bounded ? (s1 - s0) / 2 : s1 - s0);
    const clipIn = pastJump(
      source,
      startOnFrame(
        ticks(Math.max(0, wantIn)),
        ticks(bounded ? s0 + MARGIN : 0),
        ticks(s1 - MARGIN),
        source.frameTicks,
      ),
      ticks(s1 - MARGIN),
    );

    const [t0, t1] = nearest(silencesAfter(source, last), fits(pauseAfter), false) ?? [
      tail.end,
      words[last + 1]?.start ?? end,
    ];
    const closed = t1 < end;
    const trail = source.roomy?.has(last) ? ROOM : TAIL * breath;
    const wantOut = t0 + Math.min(trail, closed ? (t1 - t0) / 2 : t1 - t0);
    const clipOut = beforeJump(
      source,
      clipIn,
      endOnFrame(
        clipIn,
        ticks(Math.min(wantOut, end)),
        ticks(t0 + MARGIN),
        closed ? ticks(t1 - MARGIN) : ticks(Math.min(end, 1e9)),
        outputFrameTicks,
      ),
      ticks(t0 + MARGIN),
      outputFrameTicks,
    );
    return { source: source.id, in: clipIn, out: clipOut, first, last };
  });
}

/** The silences between word `i` of a source and the next, from the source's start for -1 and to
 * its end after the last word: the time between them less the speech the transcript missed. */
function silencesAfter(source: PlaceSource, i: number): [number, number][] {
  const from = source.words[i]?.end ?? 0;
  const to =
    source.words[i + 1]?.start ??
    (source.duration > 0 ? source.duration : Number.POSITIVE_INFINITY);
  const unheard = source.unheard ?? [];
  // The first stretch of unheard speech that ends after `from`.
  let low = 0;
  let high = unheard.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if ((unheard[mid] as readonly [number, number])[1] <= from) low = mid + 1;
    else high = mid;
  }
  const silences: [number, number][] = [];
  let at = from;
  for (const [a, b] of unheard.slice(low)) {
    if (a >= to) break;
    if (a > at) silences.push([at, a]);
    at = Math.max(at, b);
  }
  if (to > at) silences.push([at, to]);
  return silences;
}

/** The longest silence between word `i` of a source and the next, 0 for none. */
export function longestSilenceAfter(source: PlaceSource, i: number): number {
  return Math.max(0, ...silencesAfter(source, i).map(([a, b]) => b - a));
}

/** Of the silences on one side of a clip, the one nearest its words that `fits` (the last before
 * them, or the first after), else the longest; none where there is no silence. */
function nearest(
  silences: [number, number][],
  fits: (a: number, b: number) => boolean,
  last: boolean,
): [number, number] | undefined {
  const fitting = silences.filter(([a, b]) => fits(a, b));
  if (fitting.length > 0) return last ? fitting.at(-1) : fitting[0];
  return silences.reduce<[number, number] | undefined>(
    (best, silence) => (!best || silence[1] - silence[0] > best[1] - best[0] ? silence : best),
    undefined,
  );
}

/** Where the sound of `source` jumps by a click within [from, to] (seconds): the end of the last
 * PEAK_BLOCK holding one, or the start of the first, or null for none. */
function jump(source: PlaceSource, from: number, to: number, last: boolean): number | null {
  const peaks = source.peaks;
  if (!peaks) return null;
  const a = Math.max(0, Math.floor(from / PEAK_BLOCK));
  const b = Math.min(peaks.length - 1, Math.floor(to / PEAK_BLOCK));
  const reach = Math.round(CLICK_CONTEXT / PEAK_BLOCK);
  const around = [
    ...peaks.subarray(Math.max(0, a - reach), a),
    ...peaks.subarray(b + 1, b + 1 + reach),
  ].sort((x, y) => x - y);
  const base = around.length > 0 ? (around[around.length >> 1] as number) : 0;
  const limit = CLICK * Math.max(base, CLICK_FLOOR / CLICK);
  let found: number | null = null;
  for (let k = a; k <= b; k++) {
    if ((peaks[k] as number) <= limit) continue;
    if (!last) return k * PEAK_BLOCK;
    found = (k + 1) * PEAK_BLOCK;
  }
  return found;
}

/** `clipIn`, or the first source frame after the jumps in the sound where it would click, when
 * that is no later than `latest`. */
function pastJump(source: PlaceSource, clipIn: number, latest: number): number {
  let at = clipIn;
  for (;;) {
    const t = at / TICKS_PER_SECOND;
    const found = jump(source, t - SOUND_SLACK, t + CLICK_WINDOW, true);
    if (found === null) return at;
    const after = ticks(found + SOUND_SLACK);
    const next = source.frameTicks
      ? Math.ceil(after / source.frameTicks) * source.frameTicks
      : after;
    if (next <= at || next > latest) return clipIn;
    at = next;
  }
}

/** `clipOut`, or the last whole output frame from `clipIn` before the jumps in the sound where it
 * would click, when that is no earlier than `earliest`. */
function beforeJump(
  source: PlaceSource,
  clipIn: number,
  clipOut: number,
  earliest: number,
  frame: number,
): number {
  let at = clipOut;
  for (;;) {
    const t = at / TICKS_PER_SECOND;
    const found = jump(source, t - CLICK_WINDOW, t + SOUND_SLACK, false);
    if (found === null) return at;
    const next = clipIn + Math.floor((ticks(found - SOUND_SLACK) - clipIn) / frame) * frame;
    if (next >= at || next < earliest || next <= clipIn) return clipOut;
    at = next;
  }
}

/** The source frame start nearest `want` inside [low, high]; without a grid, or with no frame
 * start inside, `want` itself, which the renderer then moves by at most half a frame. */
function startOnFrame(want: number, low: number, high: number, grid: number | null): number {
  if (!grid) return want;
  const nearest = Math.round(want / grid) * grid;
  if (nearest >= low && nearest <= high) return nearest;
  const first = Math.ceil(low / grid) * grid;
  return first <= high ? first : want;
}

/** `start` plus the whole number of output frames that ends nearest `want` inside [low, high];
 * with none inside, the first that ends after `low`, so the last word is never clipped. */
export function endOnFrame(
  start: number,
  want: number,
  low: number,
  high: number,
  frame: number,
): number {
  let frames = Math.max(1, Math.round((want - start) / frame));
  if (start + frames * frame > high) frames = Math.floor((high - start) / frame);
  if (start + frames * frame < low) frames = Math.ceil((low - start) / frame);
  return start + Math.max(1, frames) * frame;
}

/** The edit's length in ticks: its clips back to back. */
export function lengthOf(clips: readonly PlacedClip[]): number {
  return clips.reduce((sum, clip) => sum + clip.out - clip.in, 0);
}

/** The shortest gap a cut fits in beside a source with frames of `frameTicks`: CUT_GAP, or both
 * margins and one of its frames when that is longer, plus a millisecond for rounding to ticks. */
export function cutGap(frameTicks: number | null): number {
  return Math.max(CUT_GAP, 2 * MARGIN + (frameTicks ?? 0) / TICKS_PER_SECOND + 0.001);
}

/** Whether a cut fits between word `i` of a source and the word after it: a silence there is at
 * least cutGap long. */
export function cuttableAfter(source: PlaceSource, i: number): boolean {
  const next = source.words[i + 1];
  const word = source.words[i];
  return !word || !next || longestSilenceAfter(source, i) >= cutGap(source.frameTicks);
}
