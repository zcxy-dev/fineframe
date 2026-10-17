// Punch-ins and push-ins: the main track's `framing.scale`, zoomed about the speaker's face
// (`framing.anchor`). A cut inside one continuous shot makes the picture jump; a change of
// framing at that cut reads as another camera angle, the way editors hide jump cuts. A slow
// push-in lands on the moments the planner marks as emphasis.

import {
  type FaceFraming,
  type Framing,
  type Project,
  type ScalePath,
  secondsToTicks,
  TICKS_PER_SECOND,
  ticksPerFrame,
} from "@video-editor/schema";
import { displayAspect, median, scaleAt, visible } from "./framing.ts";

/** The framing a jump cut alternates to: 12 % tighter than the wide framing. */
const PUNCH_IN = 1.12;
/** A smaller change of framing reads as the picture bumping rather than as another angle. */
const MIN_PUNCH_IN = 1.08;
/** How far a punch-in or push-in may enlarge the framing even where the footage has no pixels
 * to spare, as 1080p footage edited at 1080 lines has none: the picture softens a little, while
 * a jump cut left in shows. Where the footage has more room, it may go as far as that. */
const UPSCALE = 1.2;
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
  /** Its media index's faces and who speaks: a punch-in zooms about the speaker's face, and a
   * screen recording keeps its whole picture. */
  framing?: FaceFraming;
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
 * that plays on from where the one before it stopped keeps the framing that one ended at. On
 * each moment in `plan.emphasis`, the clip it starts in pushes in slowly. Both stay within the
 * source's headroom or UPSCALE, whichever is more; `shots` gives each video source's size and
 * shot transitions, and a source without an entry is left wide. Every other part of the framing is kept.
 */
export function punchIns(project: Project, shots: ReadonlyMap<string, ShotFacts>): Project {
  const { output } = project;
  const frameTicks = ticksPerFrame(output.fps);
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
  const main = project.main.map((clip, i) => {
    const start = starts[i] as number;
    const end = start + clip.out - clip.in;
    const own = starts[i + 1] ?? end;
    const { scale: _, ...rest } = clip.framing ?? {};
    const facts = shots.get(clip.source);
    // A screen's edges hold text and controls, so a screen recording is never cropped further.
    const room =
      facts && !onScreen(facts.framing, clip)
        ? Math.max(headroom(facts, rest, output), UPSCALE)
        : 1;
    const before = project.main[i - 1];
    let scale = 1;
    if (facts && before) {
      if (isJumpCut(before, clip, facts, frameTicks)) scale = level(ended, room);
      else if (playsOn(before, clip, frameTicks)) scale = Math.max(1, Math.min(ended, room));
    }
    // Each push starts from where the one before it ended.
    const keyframes: ScalePath["keyframes"][number][] = [];
    let at = scale;
    let free = start;
    for (const moment of moments) {
      if (moment.start < start || moment.start >= own) continue;
      const from = Math.max(free, moment.start - secondsToTicks(PUSH_LEAD));
      const to = Math.min(end, Math.max(moment.end, from + secondsToTicks(PUSH_SECONDS)));
      const amount = Math.min(PUSH_IN, 1 + (PUSH_RATE * (to - from)) / TICKS_PER_SECOND, room / at);
      if (to <= from || amount < MIN_PUSH) continue;
      const t = clip.in + (from - start);
      if (keyframes.at(-1)?.t !== t) keyframes.push({ t, scale: round(at) });
      at = round(at * amount);
      keyframes.push({ t: clip.in + (to - start), scale: at });
      free = to;
    }
    const framed: Framing["scale"] =
      keyframes.length > 0
        ? { type: "path", keyframes: keyframes as ScalePath["keyframes"] }
        : scale;
    ended = scaleAt(framed, clip.out);
    const anchor =
      framed !== 1 && facts?.framing ? speakerIn(facts.framing, clip, rest, facts, output) : null;
    const framing = framed === 1 ? rest : { ...rest, scale: framed, ...(anchor ? { anchor } : {}) };
    const { framing: __, ...plain } = clip;
    return Object.keys(framing).length > 0 ? { ...plain, framing } : plain;
  });
  return { ...project, main: main as Project["main"] };
}

/**
 * The scale a jump cut changes to from `ended`, where the clip before it ended: wide or PUNCH_IN,
 * whichever is at least MIN_PUNCH_IN away, so a run of jump cuts alternates between the two. After
 * a push-in neither may be far enough, and the cut punches in from where the push ended instead.
 */
function level(ended: number, room: number): number {
  const tight = Math.min(PUNCH_IN, room);
  if (tight < MIN_PUNCH_IN) return 1;
  const far = (scale: number) => Math.abs(Math.log(scale / ended)) >= Math.log(MIN_PUNCH_IN) - 1e-9;
  if (far(1)) return 1;
  if (far(tight)) return tight;
  return Math.min(round(ended * PUNCH_IN), room);
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
 * Whether any part of the clip shows a screen recording, with or without a webcam in a corner:
 * clips are cut between words, not at shot changes, so one can run on from a camera into a screen.
 */
function onScreen(faces: FaceFraming | undefined, clip: { in: number; out: number }): boolean {
  const from = clip.in / TICKS_PER_SECOND;
  const to = clip.out / TICKS_PER_SECOND;
  return (
    faces?.shots.some(
      (s) => s.start < to && s.end > from && (s.layout === "screen" || s.layout === "screen_cam"),
    ) ?? false
  );
}

/**
 * Where the face of whoever speaks most during the clip sits in its crop, narrowed to the box's
 * shape as the renderer narrows it, as fractions of the crop: the median of its samples within
 * the clip. Without speech, the biggest face; null without a face.
 */
function speakerIn(
  faces: FaceFraming,
  clip: { in: number; out: number },
  framing: Framing,
  source: Pick<ShotFacts, "width" | "height" | "sampleAspect">,
  box: { width: number; height: number },
): NonNullable<Framing["anchor"]> | null {
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
    return { x: (b.x + b.w / 2 - view.x) / view.w, y: (b.y + b.h / 2 - view.y) / view.h };
  });
  const within = (v: number) => round(Math.min(1, Math.max(0, v)));
  return { x: within(median(at.map((p) => p.x))), y: within(median(at.map((p) => p.y))) };
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;
