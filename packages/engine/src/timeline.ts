import { catalog, isCardId, isTemplateId } from "@video-editor/effects";
import {
  type BrollClip,
  type CardClip,
  type Clip,
  type MusicTrack,
  type Overlay,
  type Project,
  secondsToTicks,
  TICKS_PER_SECOND,
  ticksPerFrame,
  ticksToFrame,
} from "@video-editor/schema";
import type { SourceFacts } from "./sources.ts";

export const SAMPLE_RATE = 48_000;

/** The output sample at a tick. A tick is 2.5 samples, so rounding never meets a tie. */
export function ticksToSamples(ticks: number): number {
  return Math.round((ticks * SAMPLE_RATE) / TICKS_PER_SECOND);
}

/** A fade between the picture and a solid colour, over whole frames. */
export interface Dip {
  frames: number;
  /** `#rrggbb`. */
  color: string;
}

/** A main-track clip placed on the output frame grid. */
export interface TimelineClip {
  /** Position in `project.main`. */
  index: number;
  clip: Clip;
  source: SourceFacts;
  /** Source ticks at the clip's first output frame, snapped to the source's frame grid. */
  in: number;
  /** Output frames [start, end). */
  start: number;
  end: number;
  /** Frames a dissolve into this clip overlaps the end of the clip before. */
  dissolveIn: number;
  /** Frames a dissolve into the next clip overlaps the end of this one. */
  dissolveOut: number;
  /** Fade in from a colour at the start, after a dip. */
  dipIn: Dip | null;
  /** Fade out to a colour at the end, before a dip. */
  dipOut: Dip | null;
}

/** A B-roll clip placed on the output frame grid. */
export interface TimelineBroll {
  /** Position in `project.broll`. */
  index: number;
  clip: BrollClip;
  source: SourceFacts;
  in: number;
  start: number;
  end: number;
  /** Frames of its fade in and of its fade out; 0 cuts in and out. */
  fade: number;
}

/** An effect overlay placed on the output frame grid. */
export interface TimelineOverlay {
  /** Position in `project.overlays`. */
  index: number;
  overlay: Overlay;
  /** Output frames [start, end): those whose start falls within the overlay's time. */
  start: number;
  end: number;
}

/** A motion-graphics card placed on the output frame grid. */
export interface TimelineCard {
  /** Position in `project.cards`. */
  index: number;
  card: CardClip;
  /** Output frames [start, end). */
  start: number;
  end: number;
}

/** The longest a sound effect plays. */
export const SFX_SECONDS = 2;

/** A music track's range placed on the output sample grid. */
export interface TimelineMusic {
  /** Position in `project.audio.music`. */
  index: number;
  music: MusicTrack;
  source: SourceFacts;
  /** Output samples [start, start + samples); a range running past the edit is cut where the
   * edit ends. */
  start: number;
  samples: number;
  /** Samples of its fade in and of its fade out. */
  fadeIn: number;
  fadeOut: number;
}

/** The edit on the output frame grid, from which every frame and sample count follows. */
export interface Timeline {
  output: Project["output"];
  frameTicks: number;
  /** Output frames; the edit lasts frames × frameTicks. */
  frames: number;
  /** Output samples at SAMPLE_RATE, counted from the frame grid so audio ends with the picture. */
  samples: number;
  main: TimelineClip[];
  broll: TimelineBroll[];
  overlays: TimelineOverlay[];
  cards: TimelineCard[];
  music: TimelineMusic[];
  /** The sound effects, each as a range of its file from its start, mixed in with the music and
   * never ducked. */
  sfx: TimelineMusic[];
  /** Where someone speaks in the output, as [start, end] seconds in time order, from the speech
   * detected in each source the main track and B-roll sound play. */
  speech: [number, number][];
  /** Where each main-track edit falls in the output, in seconds: the cut, the middle of a dip, or
   * the middle of a dissolve. */
  cuts: number[];
}

/**
 * Places every clip on the output frame grid. Positions are rounded on the edit's cumulative
 * timeline rather than clip by clip, so rounding never accumulates: the edit lasts its planned
 * length to the nearest frame, and every boundary is within half a frame of where it was planned.
 */
export function buildTimeline(project: Project, sources: Map<string, SourceFacts>): Timeline {
  const { fps } = project.output;
  const frameTicks = ticksPerFrame(fps);
  const frame = (ticks: number) => ticksToFrame(ticks, fps, "round");
  const fact = (id: string) => {
    const source = sources.get(id);
    if (!source) throw new Error(`No facts loaded for source ${id}`);
    return source;
  };

  let position = 0;
  const main = project.main.map((clip, index): TimelineClip => {
    if (clip.transition?.type === "dissolve") position -= clip.transition.duration;
    const start = frame(position);
    position += clip.out - clip.in;
    const source = fact(clip.source);
    return {
      index,
      clip,
      source,
      in: snap(clip.in, source),
      start,
      end: frame(position),
      dissolveIn: 0,
      dissolveOut: 0,
      dipIn: null,
      dipOut: null,
    };
  });

  const cuts: number[] = [];
  for (const [i, current] of main.entries()) {
    const before = main[i - 1];
    const transition = current.clip.transition;
    if (!before) continue;
    if (transition?.type === "dissolve") {
      // A dissolve shorter than half a frame rounds away to a cut.
      const overlap = before.end - current.start;
      before.dissolveOut = overlap;
      current.dissolveIn = overlap;
    } else if (transition?.type === "dip") {
      const half = Math.floor(transition.duration / 2);
      before.dipOut = { frames: Math.round(half / frameTicks), color: transition.color };
      current.dipIn = {
        frames: Math.round((transition.duration - half) / frameTicks),
        color: transition.color,
      };
    }
    cuts.push(((before.end + current.start) / 2) * (frameTicks / TICKS_PER_SECOND));
  }
  for (const clip of main) check(clip, frameTicks);

  const last = main.at(-1);
  const frames = last ? last.end : 0;
  const broll = (project.broll ?? []).flatMap((clip, index): TimelineBroll[] => {
    const start = frame(clip.start);
    // B-roll running past the main track is cut where the edit ends.
    const end = Math.min(frame(clip.start + clip.out - clip.in), frames);
    if (end <= start) {
      if (start >= frames) {
        throw new Error(`/broll/${index}: starts after the edit ends`);
      }
      return [];
    }
    const fadeFrames = clip.fade ? Math.max(1, Math.round(clip.fade / frameTicks)) : 0;
    const source = fact(clip.source);
    const fade = Math.min(fadeFrames, Math.floor((end - start) / 2));
    return [{ index, clip, source, in: snap(clip.in, source), start, end, fade }];
  });

  // Frame n shows an overlay when the overlay's time covers the frame's start, so both ends round
  // up to a frame start. One running past the main track is cut where the edit ends; its render
  // is that much shorter, so it still plays its exit, as long as what is left is no shorter than
  // its template's motion needs.
  const overlays = (project.overlays ?? []).map((overlay, index): TimelineOverlay => {
    const path = `/overlays/${index}`;
    const start = ticksToFrame(overlay.start, fps, "ceil");
    if (start >= frames) throw new Error(`${path}: starts after the edit ends`);
    const planned = ticksToFrame(overlay.start + overlay.duration, fps, "ceil");
    const end = Math.min(planned, frames);
    const { template } = overlay;
    if (end < planned && isTemplateId(template)) {
      const left = Number((((end - start) * frameTicks) / TICKS_PER_SECOND).toFixed(3));
      const { min } = catalog[template].seconds;
      if (left < min) {
        throw new Error(
          `${path}: the edit ends ${left} s into it, under ${template}'s minimum of ${min} s`,
        );
      }
    }
    return { index, overlay, start, end };
  });

  // A card is cut to like B-roll, so its ends round to the nearest frame.
  const cards = (project.cards ?? []).flatMap((card, index): TimelineCard[] => {
    if (!isCardId(card.card)) throw new Error(`/cards/${index}/card: no card ${card.card}`);
    const start = frame(card.start);
    if (start >= frames) throw new Error(`/cards/${index}: starts after the edit ends`);
    const end = Math.min(frame(card.start + card.duration), frames);
    return end > start ? [{ index, card, start, end }] : [];
  });

  const samples = ticksToSamples(frames * frameTicks);
  const music = (project.audio.music ?? []).map((track, index): TimelineMusic => {
    const start = ticksToSamples(track.start);
    if (start >= samples) throw new Error(`/audio/music/${index}: starts after the edit ends`);
    const planned = ticksToSamples(track.start + track.out - track.in) - start;
    const length = Math.min(planned, samples - start);
    const fade = (ticks: number | undefined) =>
      ticks ? Math.min(ticksToSamples(ticks), Math.floor(length / 2)) : 0;
    return {
      index,
      music: track,
      source: fact(track.source),
      start,
      samples: length,
      fadeIn: fade(track.fadeIn),
      fadeOut: fade(track.fadeOut),
    };
  });

  const sfx = (project.audio.sfx ?? []).map((effect, index): TimelineMusic => {
    const start = ticksToSamples(effect.start);
    if (start >= samples) throw new Error(`/audio/sfx/${index}: starts after the edit ends`);
    const out = secondsToTicks(SFX_SECONDS);
    return {
      index,
      music: { ...effect, license: { name: "sound effect" }, in: 0, out },
      source: fact(effect.source),
      start,
      samples: Math.min(ticksToSamples(out), samples - start),
      fadeIn: 0,
      fadeOut: 0,
    };
  });

  const { duration, tolerance } = project.output.target;
  const length = frames * frameTicks;
  if (Math.abs(length - duration) > tolerance * duration) {
    const seconds = (ticks: number) => (ticks / TICKS_PER_SECOND).toFixed(3);
    throw new Error(
      `The edit lasts ${seconds(length)} s, outside ${seconds(duration)} s ± ${tolerance * 100} %`,
    );
  }
  // B-roll is heard only when it has a gain.
  const heard = [...main, ...broll.filter((clip) => clip.clip.gainDb !== undefined)];
  return {
    output: project.output,
    frameTicks,
    frames,
    samples,
    main,
    broll,
    overlays,
    cards,
    music,
    sfx,
    speech: speechOf(heard, frameTicks),
    cuts,
  };
}

/** Where the sources' detected speech plays on the output timeline, merged where it overlaps. */
function speechOf(
  clips: { source: SourceFacts; in: number; start: number; end: number }[],
  frameTicks: number,
): [number, number][] {
  const seconds = (frames: number) => (frames * frameTicks) / TICKS_PER_SECOND;
  const spans: [number, number][] = [];
  for (const clip of clips) {
    const from = clip.in / TICKS_PER_SECOND;
    const to = from + seconds(clip.end - clip.start);
    for (const [start, end] of clip.source.speech) {
      const a = Math.max(start, from);
      const b = Math.min(end, to);
      if (b > a) spans.push([seconds(clip.start) + a - from, seconds(clip.start) + b - from]);
    }
  }
  spans.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([...span]);
  }
  return merged;
}

/** The source frame start nearest a time, so the clip's first output frame shows one whole source
 * frame and its sound starts with it. Sources without a frame grid keep the planned time. */
function snap(ticks: number, source: SourceFacts): number {
  const grid = source.frameTicks;
  return grid ? Math.round(ticks / grid) * grid : ticks;
}

function check(clip: TimelineClip, frameTicks: number): void {
  const frames = clip.end - clip.start;
  const path = `/main/${clip.index}`;
  if (frames < 1) throw new Error(`${path}: shorter than one output frame`);
  if (clip.dissolveIn + clip.dissolveOut > frames) {
    throw new Error(`${path}: its dissolves need more frames than the ${frames} it lasts`);
  }
  const fades = (clip.dipIn?.frames ?? 0) + (clip.dipOut?.frames ?? 0);
  if (fades + clip.dissolveIn + clip.dissolveOut > frames) {
    throw new Error(`${path}: its transitions need more frames than the ${frames} it lasts`);
  }
  const { duration } = clip.source;
  const seconds = clip.in / TICKS_PER_SECOND;
  if (duration > 0 && seconds + (frames * frameTicks) / TICKS_PER_SECOND > duration + 0.5) {
    throw new Error(`${path}: runs past the end of ${clip.source.id} (${duration} s)`);
  }
}
