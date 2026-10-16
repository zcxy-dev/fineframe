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

/**
 * Turns the words to keep, in play order, into main-track clips, cutting only in the silence
 * between words:
 *
 * - Consecutive words of one source play on in one clip, unless the pause between them is longer
 *   than PAUSE_MAX: that is cut down to a breath of TAIL + LEAD.
 * - Where words are left out, the clip before ends in the gap after its last word and the next
 *   one starts in the gap before its first, each at least MARGIN from the words on either side.
 *   Up to TAIL and LEAD of silence stay with the words, less when the gap is shorter.
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
  const runs: { source: PlaceSource; first: number; last: number }[] = [];
  for (const stretch of stretches) {
    const source = sources.get(stretch.source);
    if (!source) throw new Error(`No words loaded for ${stretch.source}`);
    for (const i of stretch.words) {
      const run = runs.at(-1);
      const previous = run && source.words[run.last];
      const word = source.words[i] as Word;
      if (run?.source === source && i === run.last + 1 && previous) {
        if (word.start - previous.end <= PAUSE_MAX) {
          run.last = i;
          continue;
        }
      }
      runs.push({ source, first: i, last: i });
    }
  }
  return runs.map(({ source, first, last }) => {
    const words = source.words;
    const head = words[first] as Word;
    const tail = words[last] as Word;
    const before = words[first - 1];
    const after = words[last + 1];
    const end = source.duration > 0 ? source.duration : Number.POSITIVE_INFINITY;

    const gapBefore = before ? head.start - before.end : head.start;
    const lead = source.roomy?.has(first) ? ROOM : LEAD * breath;
    const wantIn = head.start - Math.min(lead, before ? gapBefore / 2 : gapBefore);
    const clipIn = startOnFrame(
      ticks(Math.max(0, wantIn)),
      ticks(before ? before.end + MARGIN : 0),
      ticks(head.start - MARGIN),
      source.frameTicks,
    );
    const gapAfter = after ? after.start - tail.end : end - tail.end;
    const trail = source.roomy?.has(last) ? ROOM : TAIL * breath;
    const wantOut = tail.end + Math.min(trail, after ? gapAfter / 2 : gapAfter);
    const clipOut = endOnFrame(
      clipIn,
      ticks(Math.min(wantOut, end)),
      ticks(tail.end + MARGIN),
      after ? ticks(after.start - MARGIN) : ticks(Math.min(end, 1e9)),
      outputFrameTicks,
    );
    return { source: source.id, in: clipIn, out: clipOut, first, last };
  });
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

/** Whether a cut fits between word `i` of a source and the word after it. */
export function cuttableAfter(source: PlaceSource, i: number): boolean {
  const next = source.words[i + 1];
  const word = source.words[i];
  return !word || !next || next.start - word.end >= cutGap(source.frameTicks);
}
