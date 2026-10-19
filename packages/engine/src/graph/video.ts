// One clip's picture, as a chain of filters: clock, then framing with tone mapping, a push-in,
// colour and fades.

import {
  type CropKeyframe,
  type CropPath,
  type CropRect,
  type FrameRate,
  type Framing,
  type Grade,
  type ScalePath,
  type StaticCrop,
  TICKS_PER_SECOND,
} from "@video-editor/schema";
import { cropAt, framingCuts, pastPicture, scaleRange } from "../framing.ts";
import type { SourceFacts } from "../sources.ts";
import type { Dip } from "../timeline.ts";
import { decimal } from "./inputs.ts";

/** A frame that starts this soon after an output frame still counts as on screen at it, which
 * absorbs container timestamp rounding (Matroska keeps whole milliseconds). */
export const ON_SCREEN_TOLERANCE = 0.001;

export interface Box {
  width: number;
  height: number;
}

/**
 * Retimes a span to exactly `frames` output frames: frame n shows the source frame on screen at
 * the span's first instant plus n output frames, whatever the source's rate or timing. A source
 * that ends early holds its last frame.
 */
export function clock(offset: number, fps: FrameRate, frames: number): string[] {
  return [
    // Held before the fps filter, which emits nothing when every frame precedes the span: a span
    // may start after the source's last frame, as when its sound outlasts its picture.
    "tpad=stop=-1:stop_mode=clone",
    `setpts=PTS-${decimal(offset + ON_SCREEN_TOLERANCE)}/TB`,
    `fps=${fps.num}/${fps.den}:start_time=0:round=up`,
    `trim=end_frame=${frames}`,
  ];
}

/** PQ and HLG to BT.709 SDR, so 8-bit output never carries HDR values players misread. */
export function toneMap(hdr: SourceFacts["hdr"]): string[] {
  if (!hdr) return [];
  return [
    "zscale=t=linear:npl=100",
    "format=gbrpf32le",
    "zscale=p=bt709",
    "tonemap=tonemap=hable:desat=0",
    "zscale=t=bt709:m=bt709:r=tv",
    "format=yuv420p",
  ];
}

/** Where a span's frames lie in source time, for framing that moves: its first frame's time in
 * source ticks, and how many frames it has of how many ticks each. */
export interface SpanTime {
  start: number;
  frames: number;
  frameTicks: number;
}

/**
 * Crops the source to the box's shape and scales it to fill the box, in BT.709. The crop is the
 * framing's rect, narrowed around its centre to the box's shape, or the largest centred region
 * of that shape; a punch-in scale keeps 1/scale of it about the anchor, and a push-in's smallest
 * scale between the framing's cuts is where push() zooms in from, into a box enlarged by how far
 * it zooms (pushRoom()). A crop path moves the crop's centre frame by frame, `span` saying which source
 * time each frame shows; within a span the crop keeps the size it has at the span's first frame.
 * A crop that reaches past the picture shows the part on it over a blurred copy of the whole
 * picture, enlarged to cover the box (backdrop()); one that splits the box fills its halves
 * (halves()). Expressions use the size and sample aspect FFmpeg sees after rotating the picture
 * upright. HDR is tone-mapped after scaling, which spares the 32-bit float stages most of a 4K
 * frame's pixels. Untagged SDR is read with the source's assumed matrix; FFmpeg alone would read
 * every size as BT.601. `label` names the links of a graph that branches, unique in the graph.
 */
export function fill(
  framing: Framing | undefined,
  box: Box,
  source: Pick<SourceFacts, "hdr" | "matrix">,
  span?: SpanTime,
  label = "fill",
): string[] {
  const crop = framing?.crop;
  if (crop?.type === "path" && !span) throw new Error("A crop path needs the span's source times");
  const first = span ? span.start + ON_SCREEN_TOLERANCE * TICKS_PER_SECOND : 0;
  const key = cropAt(crop, first);
  if (key.below) return halves(crop, key.rect, key.below, box, source, span, label);
  if (pastPicture(key.rect)) return backdrop(crop, key.rect, box, source, span, label);
  const { w, h } = key.rect;
  const [scale] = range(framing, span);
  const aspect = `${box.width}/${box.height}`;
  const width = `min(${w}*iw,${h}*ih*${aspect}/sar)/${scale}`;
  const height = `min(${h}*ih,${w}*iw*sar/(${aspect}))/${scale}`;
  // Zoomed about the anchor, the crop moves from the narrowed crop's centre towards it by its
  // offset from the centre times what the zoom gives up, (scale - 1) × the zoomed size.
  const anchor = framing?.anchor;
  const toward = (axis: "x" | "y", size: string) =>
    anchor && scale > 1 ? `+(${decimal(anchor[axis] - 0.5)})*${size}*${decimal(scale - 1)}` : "";
  const place = centred(crop, key.rect, span, (axis) => toward(axis, axis === "x" ? "ow" : "oh"));
  const size = enlarged(box, pushRoom(framing, span));
  return [`crop=w='${width}':h='${height}':${place}`, ...scaled(size, source), "setsar=1"];
}

/** Scales to a size in BT.709, tone-mapping HDR after scaling; `options` are more of the scale
 * filter's. */
function scaled(
  size: Box,
  { hdr, matrix }: Pick<SourceFacts, "hdr" | "matrix">,
  options = "flags=lanczos",
): string[] {
  const scale = `scale=${size.width}:${size.height}:${options}`;
  return hdr
    ? [scale, ...toneMap(hdr)]
    : [`${scale}${matrix ? `:in_color_matrix=${matrix}` : ""}:out_color_matrix=bt709:out_range=tv`];
}

/** The crop filter's x and y: the centre of the crop's rect, or of `pick` of a path's rects,
 * moved by `shift` on each axis. */
function centred(
  crop: StaticCrop | CropPath | undefined,
  rect: CropRect,
  span: SpanTime | undefined,
  shift: (axis: "x" | "y") => string = () => "",
  pick: (key: CropKeyframe) => CropRect = (key) => key.rect,
): string {
  if (crop?.type === "path" && span) {
    // Exact: whole-pixel steps; FFmpeg would otherwise move a 4:2:0 crop two pixels at a time.
    const keyframes = crop.keyframes.map((key) => ({ ...key, rect: pick(key) }));
    const path = { ...crop, keyframes: keyframes as CropPath["keyframes"] };
    return (
      `x='(${along(path, span, (r) => r.x + r.w / 2)})*iw-ow/2${shift("x")}':` +
      `y='(${along(path, span, (r) => r.y + r.h / 2)})*ih-oh/2${shift("y")}':exact=1`
    );
  }
  return `x='${rect.x + rect.w / 2}*iw-ow/2${shift("x")}':y='${rect.y + rect.h / 2}*ih-oh/2${shift("y")}'`;
}

/**
 * The two halves of a split screen: `top` fills the upper half of the box and `bottom` the lower,
 * each narrowed around its centre to its half's shape.
 */
function halves(
  crop: StaticCrop | CropPath | undefined,
  top: CropRect,
  bottom: CropRect,
  box: Box,
  source: Pick<SourceFacts, "hdr" | "matrix">,
  span: SpanTime | undefined,
  label: string,
): string[] {
  const upper = { width: box.width, height: Math.round(box.height / 4) * 2 };
  const lower = { width: box.width, height: box.height - upper.height };
  const half = (rect: CropRect, size: Box, pick: (key: CropKeyframe) => CropRect) => {
    const aspect = `${size.width}/${size.height}`;
    const width = `min(${rect.w}*iw,${rect.h}*ih*${aspect}/sar)`;
    const height = `min(${rect.h}*ih,${rect.w}*iw*sar/(${aspect}))`;
    const place = centred(crop, rect, span, undefined, pick);
    return [`crop=w='${width}':h='${height}':${place}`, ...scaled(size, source)].join(",");
  };
  const l = (name: string) => `[${label}_${name}]`;
  return [
    `split=2${l("a")}${l("b")};` +
      `${l("a")}${half(top, upper, (key) => key.rect)}${l("top")};` +
      `${l("b")}${half(bottom, lower, (key) => key.below ?? key.rect)}${l("bottom")};` +
      `${l("top")}${l("bottom")}vstack`,
    "setsar=1",
  ];
}

/** How much smaller than the box the blurred copy is drawn: blurring few pixels is cheap, and the
 * blur hides the enlargement. */
const BACKDROP_SHRINK = 8;
const BACKDROP_BLUR = 6;

/**
 * A crop that reaches past the picture: the part of it on the picture, scaled to where it falls in
 * the box, over the whole picture enlarged to cover the box and blurred. A path keeps the part on
 * the picture one size, so it moves only along an axis on which the crop lies inside the picture.
 */
function backdrop(
  crop: StaticCrop | CropPath | undefined,
  rect: CropRect,
  box: Box,
  source: Pick<SourceFacts, "hdr" | "matrix">,
  span: SpanTime | undefined,
  label: string,
): string[] {
  const x0 = Math.max(rect.x, 0);
  const y0 = Math.max(rect.y, 0);
  const x1 = Math.min(rect.x + rect.w, 1);
  const y1 = Math.min(rect.y + rect.h, 1);
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  const shown = {
    width: even((box.width * (x1 - x0)) / rect.w),
    height: even((box.height * (y1 - y0)) / rect.h),
  };
  const at = {
    x: Math.round((box.width * (x0 - rect.x)) / rect.w),
    y: Math.round((box.height * (y0 - rect.y)) / rect.h),
  };
  const part = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const place = centred(crop, part, span, undefined, (key) => ({
    x: Math.max(key.rect.x, 0),
    y: Math.max(key.rect.y, 0),
    w: part.w,
    h: part.h,
  }));
  const small = {
    width: even(box.width / BACKDROP_SHRINK),
    height: even(box.height / BACKDROP_SHRINK),
  };
  const l = (name: string) => `[${label}_${name}]`;
  const blurred = [
    ...scaled(small, source, "flags=bilinear:force_original_aspect_ratio=increase"),
    `crop=${small.width}:${small.height}`,
    `gblur=sigma=${BACKDROP_BLUR}`,
    `scale=${box.width}:${box.height}:flags=bicubic`,
  ].join(",");
  const front = [`crop=w='${part.w}*iw':h='${part.h}*ih':${place}`, ...scaled(shown, source)].join(
    ",",
  );
  return [
    `split=2${l("a")}${l("b")};` +
      `${l("a")}${blurred}${l("back")};` +
      `${l("b")}${front}${l("front")};` +
      `${l("back")}${l("front")}overlay=x=${at.x}:y=${at.y}`,
    "setsar=1",
  ];
}

/**
 * A value of a crop path's rect as an FFmpeg expression of the frame number `n` within the span:
 * linear between keyframes, held before the first and after the last, as project.json defines a
 * path. Frame n shows source time `span.start + n * span.frameTicks`, so the keyframes become
 * fractional frame numbers. Only the keyframes around the span's frames are written, and the
 * pieces are chosen by halving, so a long path nests a few levels deep instead of one per
 * keyframe.
 */
export function along(path: CropPath, span: SpanTime, value: (rect: CropRect) => number): string {
  // Read at the same moment the clock picks the frame on screen, so a cut in the path lands on
  // the frame that shows the new shot.
  const late = ON_SCREEN_TOLERANCE * TICKS_PER_SECOND;
  const points = path.keyframes.map((key) => ({
    n: (key.t - span.start - late) / span.frameTicks,
    v: value(key.rect),
  }));
  const first = Math.max(
    0,
    points.findLastIndex((point) => point.n <= 0),
  );
  const after = points.findIndex((point) => point.n >= span.frames - 1);
  const used = points.slice(first, after < 0 ? points.length : after + 1);
  const last = used.at(-1);
  if (!last) throw new Error("A crop path needs keyframes");
  if (used.every((point) => point.v === last.v)) return decimal(last.v);
  // Pieces from each keyframe on: a hold before the first, a line to the next, a hold after
  // the last.
  const pieces = used.map((a, i) => {
    const b = used[i + 1];
    if (!b) return { from: a.n, value: decimal(a.v) };
    const slope = (b.v - a.v) / (b.n - a.n);
    return { from: a.n, value: `${decimal(a.v)}+(${decimal(slope)})*(n-(${decimal(a.n)}))` };
  });
  const start = used[0];
  if (start && start.n > 0) pieces.unshift({ from: -Infinity, value: decimal(start.v) });
  const tree = (lo: number, hi: number): string => {
    if (hi - lo === 1) return pieces[lo]?.value ?? "0";
    const mid = (lo + hi) >> 1;
    return `if(lt(n,${decimal(pieces[mid]?.from ?? 0)}),${tree(lo, mid)},${tree(mid, hi)})`;
  };
  return tree(0, pieces.length);
}

/** How far a push-in zooms in from its smallest scale between the framing's cuts; 1 for framing
 * that does not move. */
function pushRoom(framing: Framing | undefined, span: SpanTime | undefined): number {
  const [low, high] = range(framing, span);
  return high / low;
}

/** The smallest and largest scale between the framing's cuts around a span, or over the whole
 * clip without one: a push that pieces split carries on from the same crop. */
function range(framing: Framing | undefined, span: SpanTime | undefined): [number, number] {
  const at = span ? span.start + ON_SCREEN_TOLERANCE * TICKS_PER_SECOND : 0;
  const cuts = framingCuts(framing);
  const from = cuts.findLast((t) => t <= at) ?? 0;
  const to = (cuts.find((t) => t > at) ?? Number.POSITIVE_INFINITY) - 1;
  return scaleRange(framing?.scale, from, to);
}

/** The box enlarged by `k`, in even pixels. */
function enlarged(box: Box, k: number): Box {
  if (k === 1) return box;
  const even = (side: number) => Math.round((side * k) / 2) * 2;
  return { width: even(box.width), height: even(box.height) };
}

/**
 * A push-in over the box fill() filled: each frame shows 1/z of it about the framing's anchor
 * (its middle without one), z being the frame's scale over the smallest one, which fill() cropped
 * at, and is then brought to the box's size. fill() made the picture larger than the box by the push's whole zoom, so even its last
 * frame is scaled once, from the footage, instead of enlarging the box's own pixels.
 * perspective places the four corners of that rectangle with sub-pixel precision, so the zoom
 * glides; crop and scale would move it a whole pixel at a time. It counts the frames it receives
 * from 1, as `in`, and is left out of the frames before the push starts, where it would cost
 * 40 ms or so of CPU a 1080p frame for nothing.
 */
export function push(framing: Framing | undefined, span: SpanTime, box: Box): string[] {
  const scale = framing?.scale;
  if (typeof scale !== "object") return [];
  // The enlarged box is rounded to even pixels, so its shape differs from the box's a little:
  // the picture fills the box all the same, with square pixels.
  const size = [`scale=${box.width}:${box.height}:flags=lanczos`, "setsar=1"];
  const { zoom, still } = zoomAlong(scale, span, range(framing, span)[0]);
  if (zoom === "1") return size;
  const z = `(${zoom})`;
  // The anchor (the centre without one) stays where it is: output pixel x shows source
  // x0 + x/z, pixel centres taken at half-pixel offsets.
  const anchor = framing?.anchor;
  const x0 = `(${anchor ? `W*${decimal(anchor.x)}` : "W/2"}-0.5)*(1-1/${z})`;
  const y0 = `(${anchor ? `H*${decimal(anchor.y)}` : "H/2"}-0.5)*(1-1/${z})`;
  const x1 = `${x0}+W/${z}`;
  const y1 = `${y0}+H/${z}`;
  const corners = `x0='${x0}':y0='${y0}':x1='${x1}':y1='${y0}':x2='${x0}':y2='${y1}':x3='${x1}':y3='${y1}'`;
  const skip = still > 0 ? `:enable='gte(n,${still})'` : "";
  return [`perspective=${corners}:interpolation=cubic:eval=frame${skip}`, ...size];
}

/** A scale path over `base` as an expression of the span's frame number, (in-1): eased between
 * the keyframes around the span's frames, held before the first and after the last; and how many
 * frames it starts with at 1, unzoomed. */
function zoomAlong(path: ScalePath, span: SpanTime, base: number): { zoom: string; still: number } {
  const n = "(in-1)";
  const points = path.keyframes.map((key) => ({
    at: (key.t - span.start) / span.frameTicks,
    value: key.scale / base,
  }));
  const first = Math.max(
    0,
    points.findLastIndex((point) => point.at <= 0),
  );
  const after = points.findIndex((point) => point.at >= span.frames - 1);
  const used = points.slice(first, after < 0 ? points.length : after + 1);
  const [start] = used;
  const last = used.at(-1);
  if (!start || !last) throw new Error("A scale path needs keyframes");
  if (used.every((point) => point.value === start.value)) {
    return { zoom: decimal(start.value), still: 0 };
  }
  let expression = decimal(last.value);
  for (let k = used.length - 2; k >= 0; k--) {
    const a = used[k] as (typeof used)[number];
    const b = used[k + 1] as (typeof used)[number];
    const eased = `(1-cos(PI*(${n}-(${decimal(a.at)}))/${decimal(b.at - a.at)}))/2`;
    const value = `${decimal(a.value)}+(${decimal(b.value - a.value)})*${eased}`;
    expression = `if(lt(${n},${decimal(b.at)}),${value},${expression})`;
  }
  return {
    zoom: `if(lt(${n},${decimal(start.at)}),${decimal(start.value)},${expression})`,
    still: start.value === 1 ? Math.max(0, Math.ceil(start.at)) : 0,
  };
}

/**
 * The clip's grade: its own correction, then its match and look through `lut`, the .cube file
 * ../looks.ts writes for them. The LUT works on BT.709 R'G'B' in 32-bit float, which converts to
 * and from the 8-bit picture without losing a level.
 */
export function colour(grade: Grade | undefined, lut?: string): string[] {
  const auto = grade?.auto;
  return [
    ...(auto
      ? [`eq=contrast=${auto.contrast}:gamma=${auto.gamma}:saturation=${auto.saturation}`]
      : []),
    ...(lut
      ? [
          `scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags=${RGB_FLAGS}`,
          "format=gbrpf32le",
          `lut3d=file=${filterValue(lut)}:interp=tetrahedral`,
          `scale=in_range=pc:out_color_matrix=bt709:out_range=tv:flags=${RGB_FLAGS}`,
        ]
      : []),
  ];
}

const RGB_FLAGS = "accurate_rnd+full_chroma_int";

/** Escapes text, such as a file path, as one value of a filter option in a filter graph: first
 * for the option parser, then for the graph's own parser. */
export function filterValue(text: string): string {
  const option = text.replace(/[\\':]/g, (c) => `\\${c}`);
  return option.replace(/[\\'[\],;]/g, (c) => `\\${c}`);
}

/** Fades from a colour over the first frames and to one over the last, for dips. */
export function dips(dipIn: Dip | null, dipOut: Dip | null, frames: number): string[] {
  const color = (dip: Dip) => `0x${dip.color.slice(1)}`;
  return [
    ...(dipIn && dipIn.frames > 0 ? [`fade=t=in:s=0:n=${dipIn.frames}:c=${color(dipIn)}`] : []),
    ...(dipOut && dipOut.frames > 0
      ? [`fade=t=out:s=${frames - dipOut.frames}:n=${dipOut.frames}:c=${color(dipOut)}`]
      : []),
  ];
}
