// Punch-ins and push-ins: the main track's `framing.scale`, zoomed so the speaker's face sits
// centred with its eyes a third of the way down (`framing.anchor`). A cut inside one continuous
// shot makes the picture jump; a change of framing at that cut reads as another camera angle, the
// way editors hide jump cuts. In a landscape edit a long shot also changes framing between two
// words, so a face never holds one framing for long. A slow push-in lands on the moments the
// planner marks as emphasis.

import {
  type FaceFraming,
  type Framing,
  type Project,
  type ScalePath,
  secondsToTicks,
  TICKS_PER_SECOND,
  ticksPerFrame,
} from "@video-editor/schema";
import { closest, displayAspect, EYES, median, pastPicture, scaleAt, visible } from "./framing.ts";

/** The framing a jump cut alternates to, as far in as the footage allows: a quarter tighter than
 * the wide framing in a landscape edit, 12 % in the others, whose crop is already close. */
const PUNCH_IN = { landscape: 1.25, other: 1.12 };
/** A smaller change of framing reads as the picture bumping rather than as another angle. */
const MIN_PUNCH_IN = 1.08;
/** In a landscape edit, the longest one framing of a face holds, in seconds, and the
 * shortest stretch on either side of a change within a shot: a change lands between two words, at
 * the longest gap between them HOLD to LONGEST seconds after the last change, or failing that at
 * the first gap after. */
const LONGEST = 8;
const HOLD = 4;
const MIN_HOLD = 2;
/** The furthest a push-in goes, and how fast: 6 % over 2 s at most, slow enough to feel like a
 * camera moving in rather than a zoom. */
const PUSH_IN = 1.06;
const PUSH_RATE = 0.03;
/** A push-in starts this long before the words it lands on and lasts at least PUSH_SECONDS. */
const PUSH_LEAD = 0.5;
const PUSH_SECONDS = 2;
/** A push shorter than this, because its clip ends, is too small to see and is left out. */
const MIN_PUSH = 1.02;

export interface ShotFacts {
  /** The source's size in pixels, upright, and their shape: width over height, 1 when square. */
  width: number;
  height: number;
  sampleAspect?: number;
  /** Its media index's shot transitions, in seconds. */
  transitions: readonly { start: number; end: number }[];
  /** Its media index's faces and who speaks: a punch-in centres the speaker's face, a clip
   * without a face and a screen recording keep their whole picture. */
  framing?: FaceFraming;
  /** Its media index's words, in seconds: a long shot changes framing between two of them. */
  words?: readonly { start: number; end: number }[];
}

/**
 * The largest scale at which the crop still holds at least as many source pixels as the box it
 * fills: up to it, a punch-in adds no softness. 1 or less when the framing already uses every
 * pixel the box needs, or more.
 */
export function headroom(
  source: Pick<ShotFacts, "width" | "height" | "sampleAspect">,
  framing: Framing | undefined,
  box: { width: number; height: number },
): number {
  const crop = framing?.crop;
  const { w, h } = (crop?.type === "path" ? crop.keyframes[0].rect : crop?.rect) ?? { w: 1, h: 1 };
  // The crop's size once narrowed to the box's shape, as fill() narrows it, in source pixels:
  // with pixels that are not square, one side holds fewer of them than the box.
  const sar = source.sampleAspect ?? 1;
  const shape = box.width / box.height;
  const width = Math.min(w * source.width, (h * source.height * shape) / sar);
  const height = Math.min(h * source.height, (w * source.width * sar) / shape);
  return Math.min(width / box.width, height / box.height);
}

/**
 * Sets the scale of every main-track clip. At a jump cut, where a clip follows the one before it
 * by a hard cut within the same shot of the same source, the framing changes (level()); a clip
 * that plays on from where the one before it stopped keeps the framing that one ended at. In a
 * landscape edit, a shot with a face held longer than LONGEST changes framing between two words
 * too. On each moment in `plan.emphasis`, the clip it starts in pushes in slowly. In a 9:16 edit,
 * footage already enlarged to fill the box, as landscape 1080p is, is never zoomed further;
 * otherwise the scale goes up to the footage's headroom or the punch-in, whichever is more, and
 * only as far as keeps the whole head of the face it centres in view. A shot of a screen or
 * without a face shows wide, and a clip whose crop reaches past the picture or splits the frame
 * keeps its framing. `shots` gives each video source's size, shot transitions, faces and words,
 * and a source without an entry is left wide; a source whose index has no faces at all zooms
 * about the crop's centre. Every other part of the framing is kept.
 */
export function punchIns(project: Project, shots: ReadonlyMap<string, ShotFacts>): Project {
  const { output } = project;
  const frameTicks = ticksPerFrame(output.fps);
  const landscape = output.aspect === "16:9";
  const portrait = output.aspect === "9:16";
  const punch = landscape ? PUNCH_IN.landscape : PUNCH_IN.other;
  const moments = [...(project.plan?.emphasis ?? [])].sort((a, b) => a.start - b.start);
  // Where each clip starts on the output timeline. A clip's own stretch ends where the next one
  // starts, so a moment during a dissolve belongs to the clip coming in.
  const starts: number[] = [];
  let position = 0;
  for (const clip of project.main) {
    if (clip.transition?.type === "dissolve") position -= clip.transition.duration;
    starts.push(position);
    position += clip.out - clip.in;
  }
  let ended = 1;
  // Where on the output timeline the framing on screen last changed.
  let since = 0;
  const main = project.main.map((clip, i) => {
    const start = starts[i] as number;
    const end = start + clip.out - clip.in;
    const own = starts[i + 1] ?? end;
    const { scale: _, anchor: __, ...rest } = clip.framing ?? {};
    const facts = shots.get(clip.source);
    const face = facts?.framing ? speakerIn(facts.framing, clip, rest, facts, output) : null;
    const room = facts ? roomFor(facts, rest, face, output, punch, portrait) : 1;
    // Shots of a screen, or without a face, show wide: the scale steps back at the shot change.
    const bare = bareIn(facts?.framing, clip, start);
    const isBare = (t: number) => bare.some(([a, b]) => t >= a && t < b);
    const before = project.main[i - 1];
    let scale = 1;
    const continues = !!(facts && before && playsOn(before, clip, frameTicks));
    if (facts && before && !isBare(start)) {
      if (isJumpCut(before, clip, facts, frameTicks)) scale = level(ended, room, punch);
      else if (continues) scale = Math.max(1, Math.min(ended, room));
    }
    if (!continues) since = start;
    // Each push starts from where the one before it ended; a change within the shot is a step.
    const keyframes: ScalePath["keyframes"][number][] = [];
    let at = scale;
    let free = start;
    const pushes: [number, number][] = [];
    for (const moment of moments) {
      if (moment.start < start || moment.start >= own) continue;
      const from = Math.max(free, moment.start - secondsToTicks(PUSH_LEAD));
      const to = Math.min(end, Math.max(moment.end, from + secondsToTicks(PUSH_SECONDS)));
      if (to > from && !bare.some(([a, b]) => a < to && b > from)) pushes.push([from, to]);
      free = Math.max(free, to);
    }
    const changes =
      landscape && face && room >= MIN_PUNCH_IN
        ? changesIn(clip, start, end, since, facts, [...pushes, ...bare])
        : [];
    since = changes.at(-1) ?? since;
    const steps = [
      ...changes.map((t) => ({ t, step: "change" as const })),
      ...bare.filter(([a]) => a > start).map(([a]) => ({ t: a, step: "wide" as const })),
    ];
    const events = [...steps, ...pushes.map(([from, to]) => ({ t: from, to }))].sort(
      (a, b) => a.t - b.t,
    );
    for (const event of events) {
      if ("step" in event) {
        const next = event.step === "wide" ? 1 : level(at, room, punch);
        if (next === at) continue;
        const t = clip.in + (event.t - start);
        keyframes.push({ t: t - 1, scale: round(at) });
        at = next;
        keyframes.push({ t, scale: at });
        continue;
      }
      const { t: from, to } = event;
      const amount = Math.min(PUSH_IN, 1 + (PUSH_RATE * (to - from)) / TICKS_PER_SECOND, room / at);
      if (amount < MIN_PUSH) continue;
      const t = clip.in + (from - start);
      if (keyframes.at(-1)?.t !== t) keyframes.push({ t, scale: round(at) });
      at = round(at * amount);
      keyframes.push({ t: clip.in + (to - start), scale: at });
    }
    const framed: Framing["scale"] =
      keyframes.length > 1
        ? { type: "path", keyframes: keyframes as ScalePath["keyframes"] }
        : scale;
    ended = scaleAt(framed, clip.out);
    const largest =
      typeof framed === "number" ? framed : Math.max(...keyframes.map((k) => k.scale));
    const anchor = largest > 1 && face ? anchorFor(face, largest) : null;
    const framing = framed === 1 ? rest : { ...rest, scale: framed, ...(anchor ? { anchor } : {}) };
    const { framing: ___, ...plain } = clip;
    return Object.keys(framing).length > 0 ? { ...plain, framing } : plain;
  });
  return { ...project, main: main as Project["main"] };
}

/**
 * How far a clip's framing may zoom in: not at all in a portrait edit whose crop already enlarges
 * the footage, as 1080p landscape footage at 9:16 is, nor where it shows no face, reaches past the
 * picture or splits the frame; otherwise up to the source's headroom or the punch-in, whichever is
 * more, and no further than keeps the face's whole head in view.
 */
function roomFor(
  facts: ShotFacts,
  framing: Framing,
  face: Face | null,
  box: { width: number; height: number },
  punch: number,
  portrait: boolean,
): number {
  if (facts.framing && !face) return 1;
  const crop = framing.crop;
  const keys = !crop ? [] : crop.type === "static" ? [crop] : crop.keyframes;
  if (keys.some((key) => key.below || pastPicture(key.rect))) return 1;
  const pixels = headroom(facts, framing, box);
  if (portrait && pixels < 1 - 1e-9) return 1;
  return Math.min(Math.max(pixels, punch), face ? closest(face.h) : Number.POSITIVE_INFINITY);
}

/**
 * The scale a jump cut changes to from `ended`, where the clip before it ended: wide or the
 * punch-in, whichever is at least MIN_PUNCH_IN away, so a run of jump cuts alternates between the
 * two. After a push-in neither may be far enough, and the cut punches in from where the push ended
 * instead.
 */
function level(ended: number, room: number, punch: number): number {
  const tight = Math.min(punch, room);
  if (tight < MIN_PUNCH_IN) return 1;
  const far = (scale: number) => Math.abs(Math.log(scale / ended)) >= Math.log(MIN_PUNCH_IN) - 1e-9;
  if (far(1)) return 1;
  if (far(tight)) return round(tight);
  return round(Math.min(ended * punch, room));
}

/**
 * Where, on the output timeline, a clip from `start` to `end` changes framing within a shot, the
 * framing on screen having last changed at `since`: at the middle of the gap between two of its
 * source's words, none during a push-in or a shot without a face, so no framing holds much past LONGEST seconds and none
 * for less than MIN_HOLD. A shot change in the source starts the count again.
 */
function changesIn(
  clip: { in: number; out: number },
  start: number,
  end: number,
  since: number,
  facts: ShotFacts | undefined,
  pushes: readonly [number, number][],
): number[] {
  const output = (seconds: number) => start + secondsToTicks(seconds) - clip.in;
  const gaps: { at: number; length: number }[] = [];
  const words = facts?.words ?? [];
  for (const [k, word] of words.entries()) {
    const next = words[k + 1];
    if (!next) continue;
    const at = output((word.end + next.start) / 2);
    if (at <= start || at >= end - secondsToTicks(MIN_HOLD)) continue;
    if (pushes.some(([from, to]) => at >= from && at <= to)) continue;
    gaps.push({ at, length: next.start - word.end });
  }
  const cuts = (facts?.transitions ?? []).map((t) => output(t.start)).filter((t) => t > start);
  const changes: number[] = [];
  let last = since;
  while (end - last > secondsToTicks(LONGEST)) {
    const after = (seconds: number) => last + secondsToTicks(seconds);
    const near = gaps.filter((g) => g.at >= after(HOLD) && g.at <= after(LONGEST));
    const choice =
      near.sort((a, b) => b.length - a.length)[0] ?? gaps.find((g) => g.at > after(LONGEST));
    const cut = cuts.find((t) => t > last);
    if (cut !== undefined && cut <= (choice?.at ?? end)) {
      last = cut;
      continue;
    }
    if (!choice) break;
    changes.push(choice.at);
    last = choice.at;
  }
  return changes;
}

/** Whether `clip` follows `before` by a hard cut inside one shot of the same source, skipping
 * more than a frame of it, so the picture visibly jumps. */
export function isJumpCut(
  before: Project["main"][number],
  clip: Project["main"][number],
  facts: ShotFacts,
  frameTicks: number,
): boolean {
  if (clip.transition || clip.source !== before.source) return false;
  if (Math.abs(clip.in - before.out) <= frameTicks) return false;
  // The last frame shown before the cut and the first after it, in source seconds.
  const last = (before.out - 1) / TICKS_PER_SECOND;
  const first = clip.in / TICKS_PER_SECOND;
  const [from, to] = last < first ? [last, first] : [first, last];
  // A transition separates them when the later frame is in or after it and the earlier one is
  // before its end.
  return !facts.transitions.some((t) => t.start <= to && t.end > from);
}

/** Whether `clip` plays on from where `before` stopped, within a frame, with no transition. */
function playsOn(
  before: Project["main"][number],
  clip: Project["main"][number],
  frameTicks: number,
): boolean {
  return (
    !clip.transition &&
    clip.source === before.source &&
    Math.abs(clip.in - before.out) <= frameTicks
  );
}

/**
 * The stretches of a clip, on the output timeline from its start at `start`, that show a screen
 * recording, with or without a webcam in a corner, or no face: clips are cut between words, not at
 * shot changes, so one can run on from a camera into a screen.
 */
function bareIn(
  faces: FaceFraming | undefined,
  clip: { in: number; out: number },
  start: number,
): [number, number][] {
  const end = start + clip.out - clip.in;
  return (faces?.shots ?? [])
    .filter((s) => s.layout === "screen" || s.layout === "screen_cam" || s.faces.length === 0)
    .map((s): [number, number] => [
      Math.max(start, start + secondsToTicks(s.start) - clip.in),
      Math.min(end, start + secondsToTicks(s.end) - clip.in),
    ])
    .filter(([a, b]) => b > a);
}

/** A face as the crop shows it, in fractions of the crop narrowed to the box's shape: its
 * centre across, the height of its eyes and its height. */
interface Face {
  x: number;
  eyes: number;
  h: number;
}

/**
 * The face of whoever speaks most during the clip, as the crop shows it: the median of its samples
 * within the clip. Without speech, the biggest face; null without a face.
 */
function speakerIn(
  faces: FaceFraming,
  clip: { in: number; out: number },
  framing: Framing,
  source: Pick<ShotFacts, "width" | "height" | "sampleAspect">,
  box: { width: number; height: number },
): Face | null {
  const from = clip.in / TICKS_PER_SECOND;
  const to = clip.out / TICKS_PER_SECOND;
  const tracks = faces.shots
    .filter((shot) => shot.start < to && shot.end > from)
    .flatMap((shot) =>
      shot.faces.map((face) => {
        const boxes = face.boxes.filter((b) => b.t >= from && b.t <= to);
        const talk = shot.speakers
          .filter((span) => span.face === face.id)
          .reduce(
            (sum, span) => sum + Math.max(0, Math.min(span.end, to) - Math.max(span.start, from)),
            0,
          );
        const size = median(boxes.map((b) => b.w * b.h));
        return { boxes, talk, size };
      }),
    )
    .filter((track) => track.boxes.length > 0);
  const [face] = tracks.sort((a, b) => b.talk - a.talk || b.size - a.size);
  if (!face) return null;
  const aspect = displayAspect(source.width, source.height, source.sampleAspect);
  const at = face.boxes.map((b) => {
    const view = visible(framing, b.t * TICKS_PER_SECOND, aspect, box);
    return {
      x: (b.x + b.w / 2 - view.x) / view.w,
      eyes: (b.y + EYES * b.h - view.y) / view.h,
      h: b.h / view.h,
    };
  });
  return {
    x: median(at.map((p) => p.x)),
    eyes: median(at.map((p) => p.eyes)),
    h: median(at.map((p) => p.h)),
  };
}

/**
 * The anchor that, zoomed in `scale` times, puts the face in the middle across with its eyes a
 * third of the way down, or as near as the crop's edges allow. Zoomed about the anchor, the
 * crop's left edge moves to anchor × (1 - 1 / scale) of it.
 */
function anchorFor(face: Face, scale: number): NonNullable<Framing["anchor"]> {
  const shown = 1 / scale;
  const within = (edge: number) => round(Math.min(1, Math.max(0, edge / (1 - shown))));
  return { x: within(face.x - shown / 2), y: within(face.eyes - shown / 3) };
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;
