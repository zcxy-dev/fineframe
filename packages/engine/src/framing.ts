// A virtual camera over the source: the crop that frames a clip in the output's shape, moving to
// keep the faces in the media index's `framing` in view; and which part of the source a framing,
// its punch-ins included, puts on screen.

import {
  type CropKeyframe,
  type CropPath,
  type CropRect,
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
/** Where the eyes are in a face detector's box, as a share of its height from its top, and how far
 * the top of the head is above the box, hair included: the box runs from the brow to the chin. */
export const EYES = 0.38;
export const CROWN = 0.25;
/** Room above the head, as a share of the crop's height, with the eyes a third of the way down
 * it, as a camera operator frames a face. */
const ROOM = 0.06;
/** How much wider a head is than its face's box, ears and hair included, and the share of the
 * crop's width it may fill. */
const HEAD_WIDTH = 1.25;
const HEAD_FILL = 0.8;
/** Seconds someone must talk for the camera to turn to them: a quick reply or a laugh from
 * someone else leaves it on whoever holds the floor, instead of swinging there and back. */
const MIN_TURN = 1.5;
/** One person's spans less than this many seconds apart are one turn: speech is split into spans
 * at a tenth of a second of silence, and a speaker pauses between phrases without giving up the
 * floor. */
const TURN_GAP = 1;
/** Room around two faces framed together, in face widths on each side. */
const MARGIN = 0.75;
/** The least of the picture's height each half of a split screen shows: less would enlarge the
 * footage too far. */
const MIN_PANE = 0.5;
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
 * output frame. `windows` gives the window a face is in, by face id, in a video call's layout.
 * Undefined when the index has no `framing`, or when the box already has the source's shape,
 * which needs no crop. What the camera follows and how it moves: packages/engine/README.md#framing.
 */
export function cropPath(
  index: MediaIndex,
  clip: { in: number; out: number },
  box: { width: number; height: number },
  camera: Camera = CAMERA,
  windows: ReadonlyMap<number, Rect> = new Map(),
): StaticCrop | CropPath | undefined {
  const video = index.source.video;
  if (!index.framing || !video || video.width <= 0 || video.height <= 0) return undefined;
  // The largest region with the box's shape: full height of a wider source, else full width.
  const ratio =
    box.width / box.height / displayAspect(video.width, video.height, video.sample_aspect);
  const w = Math.min(1, ratio);
  const h = Math.min(1, 1 / ratio);
  if (w > 1 - 1e-9 && h > 1 - 1e-9) return undefined;
  const geometry: Geometry = { axis: w < 1 ? "x" : "y", ratio, w, h, tall: box.height > box.width };

  const from = ticksToSeconds(clip.in);
  const to = ticksToSeconds(clip.out);
  const runs: Point[][] = [];
  for (const shot of index.framing.shots) {
    // A shot of no length shows no frame.
    if (shot.end <= from || shot.start >= to || shot.end <= shot.start) continue;
    const path = framed(shot, geometry, camera, windows);
    runs.push(...split(within(path, Math.max(from, shot.start), Math.min(to, shot.end))));
  }

  const keyframes: CropKeyframe[] = [];
  const add = (t: number, point: Point) => {
    const last = keyframes.at(-1);
    const key = keyframe(t, point);
    if (last && t <= last.t) Object.assign(last, key, { t: last.t });
    else keyframes.push(key);
  };
  for (const [i, run] of runs.entries()) {
    const next = runs[i + 1]?.[0];
    // At a cut, the frame before it keeps the old position: no frame lands between the two.
    const until = next ? secondsToTicks(next.t) - 1 : Number.POSITIVE_INFINITY;
    const kept = simplify(run);
    for (const point of kept) {
      const t = secondsToTicks(point.t);
      if (t < until) add(t, point);
    }
    const last = kept.at(-1);
    if (next && last) add(until, last);
  }
  const [first, second, ...rest] = keyframes;
  if (!first) return undefined;
  if (!second || keyframes.every((k) => sameRect(k, first))) {
    return { type: "static", rect: first.rect, ...(first.below ? { below: first.below } : {}) };
  }
  return { type: "path", keyframes: [first, second, ...rest] };
}

/** The picture's shape as displayed, width over height: its pixels need not be square. */
export function displayAspect(width: number, height: number, sampleAspect = 1): number {
  return (width * sampleAspect) / height;
}

type Axis = "x" | "y";

/** How the box sits on the source: the box's shape over the source's, the largest crop of that
 * shape inside the picture, the axis that crop moves along, and whether the box is portrait. */
interface Geometry {
  axis: Axis;
  ratio: number;
  w: number;
  h: number;
  tall: boolean;
}

interface Point {
  t: number;
  /** The crop, and the bottom half's crop of a split screen. */
  rect: CropRect;
  below?: CropRect;
  /** The camera cut to this position instead of moving there. */
  cut?: boolean;
}

/** The crop a camera holds on one face, or on everyone together (`face` null): its size, where
 * its centre may go on the axis it moves along, and its centre on the other axis. */
interface Frame {
  w: number;
  h: number;
  low: number;
  high: number;
  across: number;
}

/** Camera paths already worked out, per shot, geometry, camera and windows: a planner frames many
 * clips from one long shot. */
const cached = new WeakMap<FramedShot, Map<string, Point[]>>();

/** The camera through a whole shot, one position every STEP seconds. */
function framed(
  shot: FramedShot,
  geometry: Geometry,
  camera: Camera,
  windows: ReadonlyMap<number, Rect>,
): Point[] {
  const own = shot.faces.flatMap((face) => {
    const window = windows.get(face.id);
    return window ? [[face.id, window]] : [];
  });
  const key = JSON.stringify([geometry, camera, own]);
  const known = cached.get(shot)?.get(key);
  if (known) return known;
  const path = frame(shot, geometry, camera, windows);
  cached.set(shot, (cached.get(shot) ?? new Map()).set(key, path));
  return path;
}

function frame(
  shot: FramedShot,
  geometry: Geometry,
  camera: Camera,
  windows: ReadonlyMap<number, Rect>,
): Point[] {
  const still = (rect: CropRect, below?: CropRect): Point[] =>
    [shot.start, shot.end].map((t) => ({ t, rect, ...(below ? { below } : {}) }));
  // A screen's text, and a shot without a face, are shown whole rather than cut down.
  if (shot.layout === "screen" || shot.layout === "screen_cam" || shot.faces.length === 0) {
    return still(whole(geometry));
  }
  const turns = turnsOf(shot);
  const together = everyone(shot, geometry);
  const halves = together ? undefined : split2(shot, geometry, turns);
  if (halves) return still(...halves);
  return simulate(shot, geometry, camera, windows, turns, together);
}

/** The whole picture in the box's shape, centred: a blurred copy of it fills the rest. */
function whole({ axis, ratio }: Geometry): CropRect {
  const span = axis === "x" ? 1 / ratio : ratio;
  const offset = round((1 - span) / 2);
  return axis === "x"
    ? { x: 0, y: offset, w: 1, h: round(span) }
    : { x: offset, y: 0, w: round(span), h: 1 };
}

/** One person's turns at speaking in a shot, as long as a turn needs to be to move the camera. */
function turnsOf(shot: FramedShot): SpeakerSpan[] {
  const ids = new Set(shot.faces.map((face) => face.id));
  const turns: SpeakerSpan[] = [];
  for (const span of shot.speakers) {
    if (!ids.has(span.face)) continue;
    const last = turns.at(-1);
    if (last?.face === span.face && span.start - last.end < TURN_GAP) last.end = span.end;
    else turns.push({ ...span });
  }
  return turns.filter((turn) => turn.end - turn.start >= MIN_TURN);
}

/** The middle of everyone in a two-shot or a group whose faces, with room around them, fit in a
 * crop that moves across; undefined when they do not. */
function everyone(shot: FramedShot, geometry: Geometry): number | undefined {
  if ((shot.layout !== "two_shot" && shot.layout !== "group") || geometry.axis !== "x") return;
  const boxes = shot.faces.map(medianBox);
  const left = Math.min(...boxes.map((box) => box.x - MARGIN * box.w));
  const right = Math.max(...boxes.map((box) => box.x + box.w + MARGIN * box.w));
  return right - left <= geometry.w ? (left + right) / 2 : undefined;
}

/**
 * A split screen for two people side by side who both take turns to talk, in a portrait box: the
 * one on the left above, the one on the right below, each crop half the box's shape, eyes a third
 * of the way down, and narrow enough to leave out the other.
 */
function split2(
  shot: FramedShot,
  geometry: Geometry,
  turns: readonly SpeakerSpan[],
): [CropRect, CropRect] | undefined {
  if (shot.layout !== "two_shot" || geometry.axis !== "x" || !geometry.tall) return;
  const [left, right] = [...shot.faces]
    .sort((p, q) => area(q) - area(p))
    .slice(0, 2)
    .map((face) => ({ id: face.id, box: medianBox(face) }))
    .sort((p, q) => p.box.x - q.box.x);
  const talkers = new Set(turns.map((turn) => turn.face));
  if (!left || !right || !talkers.has(left.id) || !talkers.has(right.id)) return;
  const [a, b] = [left.box, right.box];
  // A half of the box is twice as wide, for its height, as the whole box.
  const shape = 2 * geometry.ratio;
  const gap = b.x + b.w / 2 - (a.x + a.w / 2);
  const h = Math.min(1, gap / shape, Math.max(MIN_PANE, needed(a).h, needed(b).h));
  const w = h * shape;
  const pane = (box: Box): CropRect => ({
    x: round(clamp(box.x + box.w / 2 - w / 2, 0, 1 - w)),
    y: round(clamp(box.y + EYES * box.h - h / 3, 0, 1 - h)),
    w: round(w),
    h: round(h),
  });
  return [pane(a), pane(b)];
}

/** The furthest a framing may zoom in on a face `height` of its own height tall and still keep
 * the whole head in it with room above, the eyes a third of the way down. */
export function closest(height: number): number {
  return (1 / 3 - ROOM) / ((EYES + CROWN) * height);
}

/** The height of crop that keeps a face's whole head in it with room above, eyes a third of the
 * way down, and the width that keeps the head's sides in, as shares of the picture. */
function needed(box: Box): { w: number; h: number } {
  return { w: (HEAD_WIDTH * box.w) / HEAD_FILL, h: ((EYES + CROWN) * box.h) / (1 / 3 - ROOM) };
}

function simulate(
  shot: FramedShot,
  geometry: Geometry,
  camera: Camera,
  windows: ReadonlyMap<number, Rect>,
  turns: readonly SpeakerSpan[],
  together: number | undefined,
): Point[] {
  const { axis } = geometry;
  const faces = new Map(shot.faces.map((face) => [face.id, face]));
  const tracks = new Map(shot.faces.map((face) => [face.id, track(face)]));
  const frames = new Map<number | null, Frame>();
  const frameOf = (who: number | null): Frame => {
    const known = frames.get(who);
    if (known) return known;
    const face = who === null ? undefined : faces.get(who);
    const made = face ? faceFrame(face, geometry, windows.get(face.id)) : wholeHeight(geometry);
    frames.set(who, made);
    return made;
  };
  const biggest = [...shot.faces].sort((a, b) => area(b) - area(a))[0]?.id ?? null;
  // The last turn to start by t, by binary search: a long shot holds thousands.
  const speakerAt = (t: number): number | null => {
    let lo = 0;
    let hi = turns.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((turns[mid]?.start ?? 0) <= t) lo = mid + 1;
      else hi = mid;
    }
    return turns[lo - 1]?.face ?? turns[0]?.face ?? biggest;
  };
  const aim = (t: number): { at: number; who: number | null } => {
    if (together !== undefined) return { at: together, who: null };
    const who = speakerAt(t);
    const at = who === null ? undefined : tracks.get(who)?.(t);
    if (!at) return { at: 0.5, who: null };
    const { h } = frameOf(who);
    return { at: axis === "x" ? at.x : at.eyes + h / 6, who };
  };
  const clampTo = (p: number, f: Frame) => Math.min(Math.max(p, f.low), f.high);
  // A shot starts framed on where its subject is over its first second.
  let following = aim(shot.start).who;
  let current = frameOf(following);
  const opening = [];
  for (let t = shot.start; t < Math.min(shot.end, shot.start + 1); t += STEP) {
    const { at, who } = aim(t);
    if (who === following) opening.push(at);
  }
  let p = clampTo(median(opening), current);
  let speed = 0;
  let moving = false;
  const path: Point[] = [];
  for (let k = 0; shot.start + k * STEP < shot.end; k++) {
    const t = shot.start + k * STEP;
    const { at, who } = aim(t);
    const next = frameOf(who);
    let target = clampTo(at, next);
    const size = axis === "x" ? current.w : current.h;
    let cut = false;
    if (
      who !== following &&
      (!sameFrame(next, current) || Math.abs(target - p) > CUT_DISTANCE * size)
    ) {
      current = next;
      p = target;
      speed = 0;
      moving = false;
      cut = k > 0;
    }
    following = who;
    target = clampTo(at, current);
    const length = axis === "x" ? current.w : current.h;
    const deadZone = camera.deadZone * length;
    const maxSpeed = camera.maxSpeed * length;
    const acceleration = camera.acceleration * length;
    const error = target - p;
    if (!moving && Math.abs(error) > deadZone) moving = true;
    if (moving) {
      // As fast as allowed, but never faster than it can brake to a stop on the target.
      const wanted =
        Math.sign(error) *
        Math.min(maxSpeed, Math.sqrt(2 * acceleration * Math.abs(error)), 4 * Math.abs(error));
      const change = acceleration * STEP;
      speed += Math.min(Math.max(wanted - speed, -change), change);
      p = clampTo(p + speed * STEP, current);
      if (Math.abs(target - p) < SETTLED * length && Math.abs(speed) <= change) {
        moving = false;
        speed = 0;
      }
    }
    path.push({ t, rect: place(geometry, current, p), ...(cut ? { cut } : {}) });
  }
  path.push({ t: shot.end, rect: place(geometry, current, p) });
  return path;
}

/** The crop that holds one face: the largest of the box's shape in its window, in a video call;
 * otherwise the largest in the picture, widened past it where the whole head needs more room. The
 * eyes sit a third of the way down, where the crop can move that way; a crop of the picture's full
 * height moves down only for a head the picture cuts off at the top, which then gets room above
 * it. */
function faceFrame(face: FaceTrack, geometry: Geometry, window: Rect | undefined): Frame {
  const box = medianBox(face);
  const { axis, ratio } = geometry;
  let w: number;
  let h: number;
  if (window) {
    w = Math.min(window.w, window.h * ratio);
    h = w / ratio;
  } else {
    const need = needed(box);
    const zoom = Math.max(1, need.h / geometry.h, need.w / geometry.w);
    w = geometry.w * zoom;
    h = geometry.h * zoom;
  }
  const range = (size: number, start = 0, length = 1): [number, number] =>
    size <= length
      ? [start + size / 2, start + length - size / 2]
      : [start + length - size / 2, start + size / 2];
  const [xLow, xHigh] = window ? range(w, window.x, window.w) : range(w);
  let [yLow, yHigh] = window ? range(h, window.y, window.h) : range(h);
  const eyes = box.y + EYES * box.h;
  const centreY = eyes + h / 6;
  if (!window && h <= 1 && box.y - CROWN * box.h < ROOM * h) yLow = Math.min(yLow, centreY);
  const centreX = box.x + box.w / 2;
  return axis === "x"
    ? { w, h, low: xLow, high: xHigh, across: clamp(centreY, yLow, yHigh) }
    : { w, h, low: yLow, high: yHigh, across: clamp(centreX, xLow, xHigh) };
}

/** The largest crop of the box's shape, for everyone in a two-shot or a group at once. */
function wholeHeight({ axis, w, h }: Geometry): Frame {
  return axis === "x"
    ? { w, h, low: w / 2, high: 1 - w / 2, across: 0.5 }
    : { w, h, low: h / 2, high: 1 - h / 2, across: 0.5 };
}

function sameFrame(a: Frame, b: Frame): boolean {
  return (
    Math.abs(a.w - b.w) < 1e-9 && Math.abs(a.h - b.h) < 1e-9 && Math.abs(a.across - b.across) < 0.01
  );
}

/** The crop with its centre at `p` on the axis it moves along. */
function place({ axis }: Geometry, frame: Frame, p: number): CropRect {
  const centre = axis === "x" ? { x: p, y: frame.across } : { x: frame.across, y: p };
  return {
    x: round(centre.x - frame.w / 2),
    y: round(centre.y - frame.h / 2),
    w: round(frame.w),
    h: round(frame.h),
  };
}

/** A face's centre across and the height of its eyes over time, as the crop should follow them:
 * median-filtered to drop single-sample detector jumps, linear between samples, held before the
 * first and after the last. */
function track(face: FaceTrack): (t: number) => { x: number; eyes: number } {
  const filtered = (raw: number[]) =>
    raw.map((_, i) => median(raw.slice(Math.max(0, i - MEDIAN), i + MEDIAN + 1)));
  const xs = filtered(face.boxes.map((box) => box.x + box.w / 2));
  const ys = filtered(face.boxes.map((box) => box.y + EYES * box.h));
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
    const at = (values: number[]) => {
      const after = values[lo];
      const before = values[lo - 1];
      if (before === undefined) return after ?? 0.5;
      if (after === undefined) return before;
      const t0 = times[lo - 1] ?? t;
      const t1 = times[lo] ?? t;
      return before + ((after - before) * (t - t0)) / (t1 - t0);
    };
    return { x: at(xs), eyes: at(ys) };
  };
}

/** The part of a path in [from, to], with crops interpolated at both ends. A cut at either end
 * belongs to what lies outside: `to` takes the crop before it, `from` the one after. */
function within(path: Point[], from: number, to: number): Point[] {
  const at = (t: number, end = false): Point => {
    const i = path.findIndex((point) => (end ? point.t >= t : point.t > t));
    const after = path[i];
    const before = path[i - 1];
    const last = path.at(-1) as Point;
    if (i < 0) return { ...last, t, cut: undefined };
    if (!before || !after) return { ...after, t, cut: undefined } as Point;
    // A cut lands on its own time; there is no crop between the two sides of it.
    if (after.cut) return { ...before, t };
    const k = (t - before.t) / (after.t - before.t);
    const mix = (p: number, q: number) => round(p + (q - p) * k);
    return {
      t,
      rect: {
        ...before.rect,
        x: mix(before.rect.x, after.rect.x),
        y: mix(before.rect.y, after.rect.y),
      },
      ...(before.below ? { below: before.below } : {}),
    };
  };
  const inside = path.filter((point) => point.t > from && point.t < to);
  const strip = ({ cut: _, ...point }: Point): Point => point;
  return [strip(at(from)), ...inside, strip(at(to, true))];
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
      const k = (point.t - start.t) / (end.t - start.t);
      const error = Math.max(
        ...(["x", "y"] as const).map((axis) =>
          Math.abs(point.rect[axis] - (start.rect[axis] + (end.rect[axis] - start.rect[axis]) * k)),
        ),
      );
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

/** A keyframe at tick t, with a crop that lies on the picture kept on it once rounded. */
function keyframe(t: number, { rect, below }: Point): CropKeyframe {
  return { t, rect: inside(rect), ...(below ? { below: inside(below) } : {}) };
}

function inside(rect: CropRect): CropRect {
  const fit = (offset: number, size: number) =>
    size <= 1 && offset > -1e-5 && offset < 1 - size + 1e-5
      ? Math.min(Math.max(offset, 0), round(1 - size))
      : offset;
  return { ...rect, x: fit(rect.x, rect.w), y: fit(rect.y, rect.h) };
}

/** Six decimals are a hundredth of a pixel at 8K. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function sameRect(a: CropKeyframe, b: CropKeyframe | undefined): boolean {
  const same = (p: CropRect | undefined, q: CropRect | undefined) =>
    p === q || (!!p && !!q && p.x === q.x && p.y === q.y && p.w === q.w && p.h === q.h);
  return !!b && same(a.rect, b.rect) && same(a.below, b.below);
}

type Box = { x: number; y: number; w: number; h: number };

function medianBox(face: FaceTrack): Box {
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

/** The smallest and largest scale a framing reaches from source tick `from` to `to`: between
 * keyframes it eases from one to the other, so the extremes are at keyframes or the ends. */
export function scaleRange(scale: Framing["scale"], from: number, to: number): [number, number] {
  if (scale === undefined) return [1, 1];
  if (typeof scale === "number") return [scale, scale];
  const values = [
    from,
    to,
    ...scale.keyframes.map((key) => key.t).filter((t) => t > from && t < to),
  ].map((t) => scaleAt(scale, t));
  return [Math.min(...values), Math.max(...values)];
}

/**
 * The source ticks at which a framing cuts to another crop size, splits the frame or stops
 * splitting it, moves a crop that reaches past the picture, or changes its scale at once: the
 * later of two keyframes a tick apart. The renderer draws each stretch between them on its own.
 */
export function framingCuts(framing: Framing | undefined): number[] {
  const cuts: number[] = [];
  const crop = framing?.crop;
  if (crop?.type === "path") {
    for (const [k, key] of crop.keyframes.entries()) {
      const before = crop.keyframes[k - 1];
      if (!before || key.t - before.t > 1) continue;
      const moved = before.rect.x !== key.rect.x || before.rect.y !== key.rect.y;
      const past = pastPicture(before.rect) || pastPicture(key.rect);
      if (!sameSize(before, key) || (moved && past)) cuts.push(key.t);
    }
  }
  const scale = framing?.scale;
  if (typeof scale === "object") {
    for (const [k, key] of scale.keyframes.entries()) {
      const before = scale.keyframes[k - 1];
      if (before && key.t - before.t <= 1 && key.scale !== before.scale) cuts.push(key.t);
    }
  }
  return [...new Set(cuts)].sort((a, b) => a - b);
}

function sameSize(a: CropKeyframe, b: CropKeyframe): boolean {
  const same = (p: CropRect, q: CropRect) => p.w === q.w && p.h === q.h;
  if (!same(a.rect, b.rect)) return false;
  return a.below && b.below ? same(a.below, b.below) : !a.below && !b.below;
}

/** The crop in effect at source tick `t`, and its split: a keyframe's size holds until the next
 * cut. */
export function cropAt(
  crop: StaticCrop | CropPath | undefined,
  t: number,
): Omit<CropKeyframe, "t"> {
  if (!crop) return { rect: FULL };
  if (crop.type === "static") return crop;
  return crop.keyframes.findLast((key) => key.t <= t) ?? crop.keyframes[0];
}

/** Whether a crop reaches past the picture's edges. */
export function pastPicture(rect: CropRect): boolean {
  const off = 1e-6;
  return rect.x < -off || rect.y < -off || rect.x + rect.w > 1 + off || rect.y + rect.h > 1 + off;
}

/**
 * The part of the source on screen at source tick `t`, as fractions of its width and height:
 * the framing's crop narrowed around its centre to the output's shape, then to its punch-in or
 * push-in at that moment about its anchor, which the renderer keeps inside the picture
 * (graph/video.ts). A crop may reach past the picture. Of a split screen, the top half's.
 */
export function visible(
  framing: Framing | undefined,
  t: number,
  aspect: number,
  output: Pick<Project["output"], "width" | "height">,
): CropRect {
  return panes(framing, t, aspect, output)[0].view;
}

/**
 * What a framing shows at source tick `t` in a box of output pixels: the part of the source
 * (`view`, as visible() gives it) and the part of the box it fills, one each for the halves of a
 * split screen.
 */
export function panes<B extends Pick<Project["output"], "width" | "height">>(
  framing: Framing | undefined,
  t: number,
  aspect: number,
  box: B & { x?: number; y?: number },
): [Pane, ...Pane[]] {
  const crop = framing?.crop;
  const key = !crop ? { rect: FULL } : crop.type === "static" ? crop : along(crop.keyframes, t);
  const x = box.x ?? 0;
  const y = box.y ?? 0;
  if (key.below) {
    const top = Math.round(box.height / 2);
    const upper = { width: box.width, height: top };
    const lower = { width: box.width, height: box.height - top };
    return [
      { view: view(key.rect, 1, { x: 0.5, y: 0.5 }, aspect, upper), box: { x, y, ...upper } },
      {
        view: view(key.below, 1, { x: 0.5, y: 0.5 }, aspect, lower),
        box: { x, y: y + top, ...lower },
      },
    ];
  }
  const scale = scaleAt(framing?.scale, t);
  const anchor = framing?.anchor ?? { x: 0.5, y: 0.5 };
  return [
    {
      view: view(key.rect, scale, anchor, aspect, box),
      box: { x, y, width: box.width, height: box.height },
    },
  ];
}

export interface Pane {
  view: CropRect;
  box: { x: number; y: number; width: number; height: number };
}

/** A crop narrowed to a box's shape, then zoomed in `scale` times about the anchor and kept inside
 * the picture, as graph/video.ts zooms. */
function view(
  rect: CropRect,
  scale: number,
  anchor: { x: number; y: number },
  aspect: number,
  box: { width: number; height: number },
): CropRect {
  const shape = box.width / box.height;
  // In units of the source's height, so a width is comparable with a height.
  const w = Math.min(rect.w * aspect, rect.h * shape) / scale;
  const h = Math.min(rect.h, (rect.w * aspect) / shape) / scale;
  let x = (rect.x + rect.w / 2) * aspect - w / 2 + (anchor.x - 0.5) * w * (scale - 1);
  let y = rect.y + rect.h / 2 - h / 2 + (anchor.y - 0.5) * h * (scale - 1);
  if (scale > 1) {
    x = clamp(x, 0, aspect - w);
    y = clamp(y, 0, 1 - h);
  }
  return { x: x / aspect, y, w: w / aspect, h };
}

const FULL: CropRect = { x: 0, y: 0, w: 1, h: 1 };

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high));

/** A crop path's rects at tick t: linear between keyframes, held before the first and after the
 * last, as project.json defines it. */
function along(keyframes: CropKeyframe[], t: number): Omit<CropKeyframe, "t"> {
  const after = keyframes.findIndex((key) => key.t > t);
  if (after === 0) return keyframes[0] as CropKeyframe;
  if (after < 0) return keyframes.at(-1) as CropKeyframe;
  const a = keyframes[after - 1] as CropKeyframe;
  const b = keyframes[after] as CropKeyframe;
  const k = (t - a.t) / (b.t - a.t);
  const mix = (p: CropRect, q: CropRect) => ({
    x: p.x + (q.x - p.x) * k,
    y: p.y + (q.y - p.y) * k,
    w: p.w + (q.w - p.w) * k,
    h: p.h + (q.h - p.h) * k,
  });
  return {
    rect: mix(a.rect, b.rect),
    ...(a.below && b.below ? { below: mix(a.below, b.below) } : {}),
  };
}
