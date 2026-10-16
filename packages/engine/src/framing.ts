// A virtual camera over the source: the crop that frames a clip in the output's shape, moving to
// keep the faces in the media index's `framing` in view; and which part of the source a framing,
// its punch-ins included, puts on screen.

import {
  type CropKeyframe,
  type CropPath,
  type FaceTrack,
  type FramedShot,
  type Framing,
  type MediaIndex,
  type Project,
  type Rect,
  type ScalePath,
  type SpeakerSpan,
  type StaticCrop,
  secondsToTicks,
  ticksToSeconds,
} from "@video-editor/schema";

export interface Camera {
  /** How far the subject may drift from the crop's centre before the camera follows, in crop
   * widths (crop heights when the crop moves up and down). */
  deadZone: number;
  /** The fastest pan, in crop widths per second. */
  maxSpeed: number;
  /** How quickly a pan speeds up and slows down, in crop widths per second per second. */
  acceleration: number;
}

/** Calm by default: a reframe eases in and out, and a pan the width of the crop takes 1.8 s. */
export const CAMERA: Camera = { deadZone: 0.1, maxSpeed: 0.75, acceleration: 2 };

/** A switch to a speaker further away than this, in crop widths, cuts instead of panning: the pan
 * would sweep over whatever lies between them. */
const CUT_DISTANCE = 1;
/** Where a face's centre sits in a crop that moves up and down, from its top: room above the
 * head, as a camera operator frames it. */
const HEADROOM = 0.4;
/** Seconds someone must talk for the camera to turn to them: a quick reply or a laugh from
 * someone else leaves it on whoever holds the floor, instead of swinging there and back. */
const MIN_TURN = 1.5;
/** One person's spans less than this many seconds apart are one turn: speech is split into spans
 * at a tenth of a second of silence, and a speaker pauses between phrases without giving up the
 * floor. */
const TURN_GAP = 1;
/** Room around two faces framed together, in face widths on each side. */
const MARGIN = 0.75;
/** Samples on each side in the median filter that drops single-sample detector jumps. */
const MEDIAN = 2;
const STEP = 1 / 50; // seconds between camera positions, finer than any output frame rate
/** Keyframes keep the camera within this share of the source's size: under one pixel at 1080p. */
const TOLERANCE = 0.0005;
/** Within this share of the crop of its target, a moving camera has arrived. */
const SETTLED = 0.01;

/**
 * The crop for a clip of a source, as the planner writes it into `framing.crop`: a path that keeps
 * the subject in view in a box of the output's shape, or a static crop when the camera never moves.
 * `clip` is in source ticks, as a project's clips are; `box` is the area it fills, such as the
 * output frame. Undefined when the index has no `framing`, or when the box already has the
 * source's shape, which needs no crop. What the camera follows and how it moves:
 * packages/engine/README.md#framing.
 */
export function cropPath(
  index: MediaIndex,
  clip: { in: number; out: number },
  box: { width: number; height: number },
  camera: Camera = CAMERA,
): StaticCrop | CropPath | undefined {
  const video = index.source.video;
  if (!index.framing || !video || video.width <= 0 || video.height <= 0) return undefined;
  // The largest region with the box's shape: full height of a wider source, else full width.
  const ratio =
    box.width / box.height / displayAspect(video.width, video.height, video.sample_aspect);
  const w = Math.min(1, ratio);
  const h = Math.min(1, 1 / ratio);
  if (w > 1 - 1e-9 && h > 1 - 1e-9) return undefined;
  const axis: Axis = w < 1 ? "x" : "y";
  const size = axis === "x" ? w : h;

  const from = ticksToSeconds(clip.in);
  const to = ticksToSeconds(clip.out);
  const runs: Point[][] = [];
  for (const shot of index.framing.shots) {
    // A shot of no length shows no frame.
    if (shot.end <= from || shot.start >= to || shot.end <= shot.start) continue;
    const path = follow(shot, axis, size, camera);
    runs.push(...split(within(path, Math.max(from, shot.start), Math.min(to, shot.end))));
  }

  const keyframes: CropKeyframe[] = [];
  const add = (t: number, position: number) => {
    const last = keyframes.at(-1);
    if (last && t <= last.t) last.rect = rect(axis, size, position);
    else keyframes.push({ t, rect: rect(axis, size, position) });
  };
  for (const [i, run] of runs.entries()) {
    const next = runs[i + 1]?.[0];
    // At a cut, the frame before it keeps the old position: no frame lands between the two.
    const until = next ? secondsToTicks(next.t) - 1 : Number.POSITIVE_INFINITY;
    const kept = simplify(run);
    for (const point of kept) {
      const t = secondsToTicks(point.t);
      if (t < until) add(t, point.p);
    }
    const last = kept.at(-1);
    if (next && last) add(until, last.p);
  }
  const [first, second, ...rest] = keyframes;
  if (!first) return undefined;
  if (!second || keyframes.every((k) => sameRect(k, first))) {
    return { type: "static", rect: first.rect };
  }
  return { type: "path", keyframes: [first, second, ...rest] };
}

/** The picture's shape as displayed, width over height: its pixels need not be square. */
export function displayAspect(width: number, height: number, sampleAspect = 1): number {
  return (width * sampleAspect) / height;
}

type Axis = "x" | "y";

interface Point {
  t: number;
  /** The crop's centre on the axis it moves along, as a share of the source. */
  p: number;
  /** The camera cut to this position instead of moving there. */
  cut?: boolean;
}

/** Camera paths already worked out, per shot, crop size and camera: a planner frames many clips
 * from one long shot. */
const followed = new WeakMap<FramedShot, Map<string, Point[]>>();

/** The camera through a whole shot, one position every STEP seconds. */
function follow(shot: FramedShot, axis: Axis, size: number, camera: Camera): Point[] {
  const key = JSON.stringify([axis, size, camera]);
  const cached = followed.get(shot)?.get(key);
  if (cached) return cached;
  const path = simulate(shot, axis, size, camera);
  followed.set(shot, (followed.get(shot) ?? new Map()).set(key, path));
  return path;
}

function simulate(shot: FramedShot, axis: Axis, size: number, camera: Camera): Point[] {
  const clamp = (p: number) => Math.min(Math.max(p, size / 2), 1 - size / 2);
  const aim = subject(shot, axis, size);
  const deadZone = camera.deadZone * size;
  const maxSpeed = camera.maxSpeed * size;
  const acceleration = camera.acceleration * size;
  // A shot starts framed on where its subject is over its first second.
  const opening = [];
  for (let t = shot.start; t < Math.min(shot.end, shot.start + 1); t += STEP) {
    opening.push(aim(t).at);
  }
  let p = clamp(median(opening));
  let speed = 0;
  let moving = false;
  let following = aim(shot.start).who;
  const path: Point[] = [];
  for (let k = 0; shot.start + k * STEP < shot.end; k++) {
    const t = shot.start + k * STEP;
    const { at, who } = aim(t);
    const target = clamp(at);
    let cut = false;
    if (who !== following && Math.abs(target - p) > CUT_DISTANCE * size) {
      p = target;
      speed = 0;
      moving = false;
      cut = k > 0;
    }
    following = who;
    const error = target - p;
    if (!moving && Math.abs(error) > deadZone) moving = true;
    if (moving) {
      // As fast as allowed, but never faster than it can brake to a stop on the target.
      const wanted =
        Math.sign(error) *
        Math.min(maxSpeed, Math.sqrt(2 * acceleration * Math.abs(error)), 4 * Math.abs(error));
      const change = acceleration * STEP;
      speed += Math.min(Math.max(wanted - speed, -change), change);
      p = clamp(p + speed * STEP);
      if (Math.abs(target - p) < SETTLED * size && Math.abs(speed) <= change) {
        moving = false;
        speed = 0;
      }
    }
    path.push(cut ? { t, p, cut } : { t, p });
  }
  path.push({ t: shot.end, p });
  return path;
}

/** Where the camera should centre at a time in the shot, on its axis, and whose face that is. */
function subject(
  shot: FramedShot,
  axis: Axis,
  size: number,
): (t: number) => { at: number; who: number | null } {
  const faces = new Map(shot.faces.map((face) => [face.id, track(face, axis, size)]));
  const middle = { at: 0.5, who: null };
  if (shot.layout === "screen" || shot.layout === "screen_cam" || faces.size === 0) {
    return () => middle;
  }
  const biggest = [...shot.faces].sort((a, b) => area(b) - area(a))[0]?.id ?? null;
  const turns: SpeakerSpan[] = [];
  for (const span of shot.speakers) {
    if (!faces.has(span.face)) continue;
    const last = turns.at(-1);
    if (last?.face === span.face && span.start - last.end < TURN_GAP) last.end = span.end;
    else turns.push({ ...span });
  }
  const speakers = turns.filter((turn) => turn.end - turn.start >= MIN_TURN);
  // The last span to start by t, by binary search: a long shot holds thousands.
  const speakerAt = (t: number): number | null => {
    let lo = 0;
    let hi = speakers.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((speakers[mid]?.start ?? 0) <= t) lo = mid + 1;
      else hi = mid;
    }
    return speakers[lo - 1]?.face ?? speakers[0]?.face ?? biggest;
  };
  if ((shot.layout === "two_shot" || shot.layout === "group") && axis === "x") {
    // Everyone fits when their face boxes, with room around them, are no wider than the crop.
    const boxes = shot.faces.map(medianBox);
    const left = Math.min(...boxes.map((box) => box.x - MARGIN * box.w));
    const right = Math.max(...boxes.map((box) => box.x + box.w + MARGIN * box.w));
    if (right - left <= size) return () => ({ at: (left + right) / 2, who: null });
  }
  return (t) => {
    const who = speakerAt(t);
    const position = who === null ? undefined : faces.get(who);
    return position ? { at: position(t), who } : middle;
  };
}

/** A face's position over time as the crop's centre should follow it: median-filtered to drop
 * single-sample detector jumps, linear between samples, held before the first and after the last. */
function track(face: FaceTrack, axis: Axis, size: number): (t: number) => number {
  const raw = face.boxes.map((box) =>
    axis === "x" ? box.x + box.w / 2 : box.y + box.h / 2 + (0.5 - HEADROOM) * size,
  );
  const values = raw.map((_, i) => median(raw.slice(Math.max(0, i - MEDIAN), i + MEDIAN + 1)));
  const times = face.boxes.map((box) => box.t);
  return (t) => {
    // The first sample after t, by binary search: a shot can hold an hour of samples.
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((times[mid] ?? 0) <= t) lo = mid + 1;
      else hi = mid;
    }
    const after = values[lo];
    const before = values[lo - 1];
    if (before === undefined) return after ?? 0.5;
    if (after === undefined) return before;
    const t0 = times[lo - 1] ?? t;
    const t1 = times[lo] ?? t;
    return before + ((after - before) * (t - t0)) / (t1 - t0);
  };
}

/** The part of a path in [from, to], with positions interpolated at both ends. A cut at either
 * end belongs to what lies outside: `to` takes the position before it, `from` the one after. */
function within(path: Point[], from: number, to: number): Point[] {
  const at = (t: number, end = false): number => {
    const i = path.findIndex((point) => (end ? point.t >= t : point.t > t));
    const after = path[i];
    const before = path[i - 1];
    if (i < 0) return path.at(-1)?.p ?? 0.5;
    if (!before || !after) return after?.p ?? 0.5;
    // A cut lands on its own time; there is no position between the two sides of it.
    if (after.cut) return before.p;
    return before.p + ((after.p - before.p) * (t - before.t)) / (after.t - before.t);
  };
  const inside = path.filter((point) => point.t > from && point.t < to);
  return [{ t: from, p: at(from) }, ...inside, { t: to, p: at(to, true) }];
}

/** Runs of a path between its cuts. */
function split(path: Point[]): Point[][] {
  const runs: Point[][] = [[]];
  for (const point of path) {
    if (point.cut) runs.push([]);
    runs.at(-1)?.push(point);
  }
  return runs.filter((run) => run.length > 0);
}

/** The fewest points whose straight lines stay within TOLERANCE of the path: the point furthest
 * from the line between two kept ones is kept, until none is that far (Ramer–Douglas–Peucker). */
function simplify(run: Point[]): Point[] {
  if (run.length <= 2) return run;
  const keep = new Set([0, run.length - 1]);
  const stack: [number, number][] = [[0, run.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop() ?? [0, 0];
    const start = run[a];
    const end = run[b];
    if (!start || !end) continue;
    let worst = -1;
    let worstError = TOLERANCE;
    for (let i = a + 1; i < b; i++) {
      const point = run[i];
      if (!point) continue;
      const line = start.p + ((end.p - start.p) * (point.t - start.t)) / (end.t - start.t);
      const error = Math.abs(point.p - line);
      if (error > worstError) {
        worst = i;
        worstError = error;
      }
    }
    if (worst >= 0) {
      keep.add(worst);
      stack.push([a, worst], [worst, b]);
    }
  }
  return [...keep].sort((x, y) => x - y).flatMap((i) => run[i] ?? []);
}

function rect(axis: Axis, size: number, centre: number) {
  // Six decimals are a hundredth of a pixel at 8K; the crop stays inside the frame after rounding.
  const round = (v: number) => Math.round(v * 1e6) / 1e6;
  const span = Math.floor(size * 1e6) / 1e6;
  const offset = Math.min(Math.max(round(centre - span / 2), 0), round(1 - span));
  return axis === "x" ? { x: offset, y: 0, w: span, h: 1 } : { x: 0, y: offset, w: 1, h: span };
}

function sameRect(a: CropKeyframe, b: CropKeyframe | undefined): boolean {
  return !!b && a.rect.x === b.rect.x && a.rect.y === b.rect.y;
}

function medianBox(face: FaceTrack) {
  const pick = (key: "x" | "y" | "w" | "h") => median(face.boxes.map((box) => box[key]));
  return { x: pick("x"), y: pick("y"), w: pick("w"), h: pick("h") };
}

function area(face: FaceTrack): number {
  const box = medianBox(face);
  return box.w * box.h;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0.5;
  return sorted.length % 2
    ? (sorted[mid] ?? 0.5)
    : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

/** The scale at source time `t`: eased along half a cosine between keyframes, held outside them. */
export function scaleAt(scale: Framing["scale"], t: number): number {
  if (scale === undefined) return 1;
  if (typeof scale === "number") return scale;
  const [first] = scale.keyframes;
  if (t <= first.t) return first.scale;
  for (const [k, b] of scale.keyframes.entries()) {
    const a = scale.keyframes[k - 1];
    if (!a || t >= b.t) continue;
    return (
      a.scale + ((b.scale - a.scale) * (1 - Math.cos((Math.PI * (t - a.t)) / (b.t - a.t)))) / 2
    );
  }
  return (scale.keyframes.at(-1) as ScalePath["keyframes"][number]).scale;
}

/** The smallest scale a framing reaches, which is the crop fill() takes from the source. */
export function smallestScale(scale: Framing["scale"]): number {
  if (scale === undefined) return 1;
  if (typeof scale === "number") return scale;
  return Math.min(...scale.keyframes.map((key) => key.scale));
}

/**
 * The part of the source on screen at source tick `t`, as fractions of its width and height:
 * the framing's crop narrowed around its centre to the output's shape, then to its punch-in or
 * push-in at that moment about its anchor, kept inside the picture, as the renderer does
 * (graph/video.ts).
 */
export function visible(
  framing: Framing | undefined,
  t: number,
  aspect: number,
  output: Pick<Project["output"], "width" | "height">,
): Rect {
  const crop = framing?.crop;
  const rect = !crop ? FULL : crop.type === "static" ? crop.rect : along(crop.keyframes, t);
  const scale = scaleAt(framing?.scale, t);
  const { x: ax, y: ay } = framing?.anchor ?? { x: 0.5, y: 0.5 };
  const shape = output.width / output.height;
  // In units of the source's height, so a width is comparable with a height.
  const w = Math.min(rect.w * aspect, rect.h * shape) / scale;
  const h = Math.min(rect.h, (rect.w * aspect) / shape) / scale;
  // Zoomed about the anchor, as graph/video.ts zooms.
  const x = clamp(
    (rect.x + rect.w / 2) * aspect - w / 2 + (ax - 0.5) * w * (scale - 1),
    0,
    aspect - w,
  );
  const y = clamp(rect.y + rect.h / 2 - h / 2 + (ay - 0.5) * h * (scale - 1), 0, 1 - h);
  return { x: x / aspect, y, w: w / aspect, h };
}

const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high));

/** A crop path's rect at tick t: linear between keyframes, held before the first and after the
 * last, as project.json defines it. */
function along(keyframes: { t: number; rect: Rect }[], t: number): Rect {
  const after = keyframes.findIndex((key) => key.t > t);
  if (after === 0) return (keyframes[0] as { rect: Rect }).rect;
  if (after < 0) return (keyframes.at(-1) as { rect: Rect }).rect;
  const a = keyframes[after - 1] as { t: number; rect: Rect };
  const b = keyframes[after] as { t: number; rect: Rect };
  const k = (t - a.t) / (b.t - a.t);
  const mix = (p: number, q: number) => p + (q - p) * k;
  return {
    x: mix(a.rect.x, b.rect.x),
    y: mix(a.rect.y, b.rect.y),
    w: mix(a.rect.w, b.rect.w),
    h: mix(a.rect.h, b.rect.h),
  };
}
