// The edit as an editing app's timeline: tracks of clips on the output frame grid, each a range of
// one file, which the timeline files (fcpxml.ts, xmeml.ts) write out.

import { type CropRect, type Framing, TICKS_PER_SECOND, ticksToFrame } from "@video-editor/schema";
import { panes } from "../framing.ts";
import { type Placement, placement } from "../graph/broll.ts";
import { MIN_RISE } from "../graph/music.ts";
import { ON_SCREEN_TOLERANCE } from "../graph/video.ts";
import { SAMPLE_RATE, type Timeline, type TimelineMusic } from "../timeline.ts";
import type { Media } from "./media.ts";

/** The id of the overlay video's media: the edit's graphics, effect overlays and watermark. */
export const OVERLAY = "overlay";

/** Where a clip's picture sits: the part of the file it shows, as fractions of the file's
 * displayed width and height (which may reach past its edges), filling `box` of the output
 * frame, in pixels. `crop` when the box is less than the frame, so the rest of the file must be
 * cut away rather than fall outside the frame. */
export interface Picture {
  view: CropRect;
  box: Placement;
  crop: boolean;
}

/** A gain at a frame of a clip, counted from its start. */
export interface GainKey {
  frame: number;
  gainDb: number;
}

export interface NleClip {
  /** The media's id. */
  media: string;
  /** Output frames [start, end). */
  start: number;
  end: number;
  /** Media ticks at the clip's first frame, counted from the file's first frame. */
  in: number;
  /** Null for sound alone. */
  picture: Picture | null;
  /** Null for a clip whose sound is not heard: the level, or its keyframes when it changes, and
   * what the sound is. */
  sound: { gainDb: number; keys: GainKey[]; role: "dialogue" | "music" | "effects" } | null;
  /** A cross dissolve from the clip before, `before` frames ending at this clip's start and
   * `after` frames from it; null for a cut. */
  dissolve: { before: number; after: number } | null;
}

/** The tracks an editing app shows. */
export interface NleTimeline {
  output: Timeline["output"];
  frameTicks: number;
  frames: number;
  /** Bottom to top: the main track first, each with its clips in time order and none
   * overlapping. Main-track clips carry the edit's speech. */
  video: NleClip[][];
  /** Sound alone, music and sound effects, likewise. */
  audio: NleClip[][];
  media: ReadonlyMap<string, Media>;
}

/** The output frame of a time on the output timeline, rounded as the timeline rounds it. */
const frameOf = (timeline: Timeline, ticks: number) =>
  ticksToFrame(ticks, timeline.output.fps, "round");

/**
 * The edit as tracks of clips, every clip on exactly the frames the render shows it:
 * - **Main track:** each clip's picture and sound. A dissolve becomes a cross dissolve centred
 *   where its middle falls, with the material either side of it from the clips' own frames, so
 *   every frame outside a dissolve is the render's. A dip is a cut at the same frames, without
 *   the fade.
 * - **Framing:** one fixed position and scale per clip: the time-weighted mean of what the crop
 *   and punch-in show over its frames. A clip whose framing cuts (two keyframes a tick apart, as
 *   from one speaker to another) is split there, so each part holds one framing and the mean
 *   never falls between two people. The halves of a split screen are two clips, the bottom one
 *   on its own track above.
 * - **B-roll** on the tracks above, each where the render draws it; then the overlay video, when
 *   there is one.
 * - **Music and sound effects** on sound tracks, at their gains, the music's fades and ducking
 *   under speech as level keyframes.
 */
export function nleTimeline(
  timeline: Timeline,
  media: ReadonlyMap<string, Media>,
  overlay: boolean,
): NleTimeline {
  const { frameTicks, output } = timeline;
  const file = (id: string) => {
    const found = media.get(id);
    if (!found) throw new Error(`No media facts for ${id}`);
    return found;
  };
  const frame = { x: 0, y: 0, width: output.width, height: output.height };

  const main: NleClip[] = [];
  const split: NleClip[] = [];
  for (const [i, clip] of timeline.main.entries()) {
    const next = timeline.main[i + 1];
    const into = clip.dissolveIn;
    const out = next?.dissolveIn ?? 0;
    // A dissolve's cut falls `floor(d / 2)` frames into it.
    const start = clip.start + Math.floor(into / 2);
    const end = clip.end - out + Math.floor(out / 2);
    const m = file(clip.source.id);
    const parts = framed(
      clip.clip.framing,
      clip.in,
      frameTicks,
      start - clip.start,
      end - clip.start,
    );
    for (const [k, [from, to]] of parts.entries()) {
      const first = clip.in + from * frameTicks;
      const [top, bottom] = pictures(clip.clip.framing, first, to - from, m, frame, timeline);
      const base = { media: m.id, start: clip.start + from, end: clip.start + to };
      const at = mediaTicks(first, m);
      main.push({
        ...base,
        in: at,
        picture: top,
        sound: m.channels > 0 ? { gainDb: 0, keys: [], role: "dialogue" } : null,
        dissolve:
          k === 0 && into > 0
            ? { before: Math.floor(into / 2), after: into - Math.floor(into / 2) }
            : null,
      });
      if (bottom) split.push({ ...base, in: at, picture: bottom, sound: null, dissolve: null });
    }
  }

  const broll: NleClip[] = timeline.broll.map((clip) => {
    const m = file(clip.source.id);
    const box = placement(clip.clip.rect, output);
    const [picture] = pictures(clip.clip.framing, clip.in, clip.end - clip.start, m, box, timeline);
    const heard = clip.clip.gainDb !== undefined && m.channels > 0;
    return {
      media: m.id,
      start: clip.start,
      end: clip.end,
      in: m.kind === "image" ? 0 : mediaTicks(clip.in, m),
      picture,
      sound: heard ? { gainDb: clip.clip.gainDb ?? 0, keys: [], role: "effects" } : null,
      dissolve: null,
    };
  });

  const video = [main, ...(split.length > 0 ? [split] : []), ...lanes(broll)];
  if (overlay) {
    const whole = { view: { x: 0, y: 0, w: 1, h: 1 }, box: frame, crop: false };
    video.push([
      {
        media: OVERLAY,
        start: 0,
        end: timeline.frames,
        in: 0,
        picture: whole,
        sound: null,
        dissolve: null,
      },
    ]);
  }

  const sounds = [...timeline.music, ...timeline.sfx].map((track): NleClip => {
    const music = timeline.music.includes(track);
    const start = frameOf(timeline, track.music.start);
    // Starting on a frame, it starts that much later or earlier in its file, so each moment of
    // it still plays when the render plays it; and it ends with the edit or its file, as a sound
    // effect shorter than the 2 s it may play does.
    const at = Math.max(0, track.music.in + start * frameTicks - track.music.start);
    const end = Math.min(
      frameOf(timeline, track.music.start + track.music.out - track.music.in),
      timeline.frames,
      start + Math.floor((file(track.source.id).duration - at) / frameTicks),
    );
    return {
      media: track.source.id,
      start,
      end,
      in: at,
      picture: null,
      sound: music
        ? {
            gainDb: track.music.gainDb,
            keys: musicKeys(track, timeline, end - start),
            role: "music",
          }
        : { gainDb: track.music.gainDb, keys: [], role: "effects" },
      dissolve: null,
    };
  });
  return {
    output,
    frameTicks,
    frames: timeline.frames,
    video,
    audio: lanes(sounds.filter((clip) => clip.end > clip.start)),
    media,
  };
}

/** Media ticks at source time `ticks`, on the file's own frame grid. */
function mediaTicks(ticks: number, media: Media): number {
  const at = Math.max(0, ticks - media.start);
  if (!media.rate) return at;
  const grid = (TICKS_PER_SECOND * media.rate.den) / media.rate.num;
  return Number.isInteger(grid) ? Math.round(at / grid) * grid : at;
}

/** The frames [from, to) of a clip, counted from its start, split where its framing cuts:
 * at the first frame that shows each cut, as the renderer draws it. `start` is the clip's source
 * ticks at its first frame. */
function framed(
  framing: Framing | undefined,
  start: number,
  frameTicks: number,
  from: number,
  to: number,
): [number, number][] {
  const late = ON_SCREEN_TOLERANCE * TICKS_PER_SECOND;
  const cuts = cutTicks(framing)
    .map((t) => Math.ceil((t - late - start) / frameTicks - 1e-9))
    .filter((n) => n > from && n < to);
  const edges = [from, ...new Set(cuts), to];
  return edges.slice(1).map((end, k): [number, number] => [edges[k] as number, end]);
}

/** The source ticks at which a framing cuts: the later of two keyframes a tick apart. */
function cutTicks(framing: Framing | undefined): number[] {
  const cuts: number[] = [];
  const crop = framing?.crop;
  if (crop?.type === "path") {
    for (const [k, key] of crop.keyframes.entries()) {
      const before = crop.keyframes[k - 1];
      if (before && key.t - before.t <= 1) cuts.push(key.t);
    }
  }
  const scale = framing?.scale;
  if (typeof scale === "object") {
    for (const [k, key] of scale.keyframes.entries()) {
      const before = scale.keyframes[k - 1];
      if (before && key.t - before.t <= 1) cuts.push(key.t);
    }
  }
  return [...new Set(cuts)].sort((a, b) => a - b);
}

/** The mean of what a framing shows over `frames` output frames from source tick `first`: one
 * picture, or the top and bottom of a split screen. */
function pictures(
  framing: Framing | undefined,
  first: number,
  frames: number,
  media: Media,
  box: Placement,
  { frameTicks, output }: Pick<Timeline, "frameTicks" | "output">,
): [Picture, Picture?] {
  const aspect = media.height > 0 ? media.width / media.height : 1;
  const late = ON_SCREEN_TOLERANCE * TICKS_PER_SECOND;
  const sums: { view: CropRect; box: Placement }[] = [];
  for (let n = 0; n < frames; n++) {
    const shown = panes(framing, first + n * frameTicks + late, aspect, box);
    for (const [p, pane] of shown.entries()) {
      const sum = sums[p] ?? { view: { x: 0, y: 0, w: 0, h: 0 }, box: pane.box };
      sum.view = {
        x: sum.view.x + pane.view.x,
        y: sum.view.y + pane.view.y,
        w: sum.view.w + pane.view.w,
        h: sum.view.h + pane.view.h,
      };
      sums[p] = sum;
    }
  }
  const [top, bottom] = sums.map(
    ({ view, box: at }): Picture => ({
      view: { x: view.x / frames, y: view.y / frames, w: view.w / frames, h: view.h / frames },
      box: at,
      crop: sums.length > 1 || at.width < output.width || at.height < output.height,
    }),
  );
  if (!top) throw new Error("A clip shows no frame");
  return bottom ? [top, bottom] : [top];
}

/** Clips on as few tracks as hold them without overlap, each on the lowest free one, in the
 * order they come. */
function lanes(clips: NleClip[]): NleClip[][] {
  const tracks: NleClip[][] = [];
  for (const clip of [...clips].sort((a, b) => a.start - b.start)) {
    const free = tracks.find((track) => (track.at(-1)?.end ?? 0) <= clip.start);
    if (free) free.push(clip);
    else tracks.push([clip]);
  }
  return tracks;
}

/**
 * A music range's level through its `frames` frames, as keyframes: its fades, straight in the
 * editing app where the render's follow a quarter sine, and its ducking under the edit's speech,
 * down by its depth from `attack` before each stretch of speech to `release` after it, pauses
 * too short to come back up for MIN_RISE staying down, as the render ducks. The render also
 * takes the music further down under speech quieter than the edit's as a whole, measured from
 * the rendered sound; the keyframes leave that out. None for a range at one level.
 */
function musicKeys(track: TimelineMusic, timeline: Timeline, frames: number): GainKey[] {
  const seconds = (frame: number) => (frame * timeline.frameTicks) / TICKS_PER_SECOND;
  const length = seconds(frames);
  const from = seconds(frameOf(timeline, track.music.start));
  const { gainDb, ducking } = track.music;
  const fadeIn = track.fadeIn / SAMPLE_RATE;
  const fadeOut = track.fadeOut / SAMPLE_RATE;
  const spans: [number, number][] = [];
  if (ducking) {
    const attack = ducking.attackMs / 1000;
    const release = ducking.releaseMs / 1000;
    for (const [start, end] of timeline.speech) {
      const last = spans.at(-1);
      if (last && start - last[1] < attack + release + MIN_RISE) last[1] = Math.max(last[1], end);
      else spans.push([start, end]);
    }
  }
  const attack = (ducking?.attackMs ?? 0) / 1000;
  const release = (ducking?.releaseMs ?? 0) / 1000;
  /** How far down the ducking is at `t` seconds into the range, 0 to 1. */
  const depth = (t: number) => {
    const at = from + t;
    let d = 0;
    for (const [start, end] of spans) {
      if (at >= start && at <= end) return 1;
      if (at < start && at > start - attack) d = Math.max(d, 1 - (start - at) / attack);
      if (at > end && at < end + release) d = Math.max(d, 1 - (at - end) / release);
    }
    return d;
  };
  const fade = (t: number) =>
    Math.min(fadeIn > 0 ? t / fadeIn : 1, fadeOut > 0 ? (length - t) / fadeOut : 1, 1);
  const times = new Set([0, length]);
  if (fadeIn > 0) times.add(Math.min(fadeIn, length));
  if (fadeOut > 0) times.add(Math.max(0, length - fadeOut));
  for (const [start, end] of spans) {
    for (const t of [start - attack, start, end, end + release]) {
      if (t - from > 0 && t - from < length) times.add(t - from);
    }
  }
  if (times.size === 2 && spans.length === 0 && fadeIn === 0 && fadeOut === 0) return [];
  const keys = [...times]
    .sort((a, b) => a - b)
    .map((t): GainKey => {
      const level = fade(t);
      const db = level <= 0 ? -Infinity : 20 * Math.log10(level);
      return {
        frame: Math.round((t * TICKS_PER_SECOND) / timeline.frameTicks),
        gainDb: gainDb + (ducking ? ducking.depthDb * depth(t) : 0) + db,
      };
    });
  // One key per frame: the last at each wins, as a step lands there.
  return keys.filter((key, k) => keys[k + 1]?.frame !== key.frame);
}
