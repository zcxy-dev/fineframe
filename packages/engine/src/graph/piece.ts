// One piece's FFmpeg run: its inputs and its filter graph, for the video pass or the audio pass.

import { watermarkPlacement } from "@video-editor/effects";
import { type Framing, type Grade, TICKS_PER_SECOND } from "@video-editor/schema";
import { QUIET } from "../ffmpeg.ts";
import { framingCuts } from "../framing.ts";
import { lutKey } from "../looks.ts";
import type { Piece } from "../pieces.ts";
import { EDGE_FADE_SAMPLES } from "../pieces.ts";
import type { SourceFacts } from "../sources.ts";
import { type Timeline, type TimelineClip, ticksToSamples } from "../timeline.ts";
import { fades, silence, soundClock, span } from "./audio.ts";
import { brollSound, brollTiming, mix, overlay, placement } from "./broll.ts";
import { RAW_AUDIO, RAW_VIDEO } from "./encode.ts";
import { openSource } from "./inputs.ts";
import { graphicPlacement, overlayInput, overlayTiming, slideIn } from "./overlays.ts";
import { crossfade, dissolve } from "./transitions.ts";
import { clock, colour, dips, fill, ON_SCREEN_TOLERANCE, push } from "./video.ts";
import { lead, voiceSound } from "./voice.ts";
import { type Watermark, watermarkLines } from "./watermark.ts";

/** Collects inputs, numbering them as FFmpeg will. */
function inputs(timeline: Timeline) {
  const args: string[] = [];
  let count = 0;
  const add = (input: string[]) => {
    args.push(...input);
    return count++;
  };
  return {
    args,
    add,
    open(source: SourceFacts, ticks: number) {
      const input = openSource(source, ticks, timeline.output.fps);
      return { index: add(input.args), offset: input.offset };
    },
  };
}

/** The piece's picture, written to stdout as raw frames. `overlays` are the rendered files of
 * `timeline.overlays`, in its order, and `graphics` those of `timeline.graphics`; `luts` the
 * .cube file of each clip's match and look, by lutKey; `watermark` a brand kit's logo. */
export function pieceVideo(
  piece: Piece,
  timeline: Timeline,
  overlays: string[] = [],
  luts: ReadonlyMap<string, string> = new Map(),
  graphics: string[] = [],
  watermark: Watermark | null = null,
): string[] {
  const lut = (grade: Grade | undefined) => {
    const key = lutKey(grade);
    if (key === null) return undefined;
    const file = luts.get(key);
    if (!file) throw new Error("A clip's match or look has no LUT file");
    return file;
  };
  const { output } = timeline;
  const { fps } = output;
  const opened = inputs(timeline);
  const graph: string[] = [];
  for (const [i, layer] of piece.main.entries()) {
    const { clip } = layer;
    const picture = framed(opened, layer, output, timeline, `m${i}`);
    const chain = [
      ...colour(clip.clip.grade, lut(clip.clip.grade)),
      "format=yuv420p",
      ...dips(layer.dipIn, layer.dipOut, layer.frames),
    ];
    graph.push(...picture.lines, `${picture.out}${chain.join(",")}[m${i}]`);
  }
  let base = "[m0]";
  if (piece.main.length === 2) {
    graph.push(`[m0][m1]${dissolve(piece.end - piece.start, fps)}[dissolved]`);
    base = "[dissolved]";
  }
  for (const [j, layer] of piece.broll.entries()) {
    const { clip } = layer;
    const at = placement(clip.clip.rect, output);
    const picture = framed(opened, layer, at, timeline, `b${j}`);
    const chain = [...colour(clip.clip.grade, lut(clip.clip.grade)), ...brollTiming(layer, fps)];
    graph.push(
      ...picture.lines,
      `${picture.out}${chain.length > 0 ? chain.join(",") : "null"}[b${j}]`,
      `${base}[b${j}]${overlay(at)}[o${j}]`,
    );
    base = `[o${j}]`;
  }
  for (const [k, layer] of piece.graphics.entries()) {
    const file = graphics[layer.clip.index];
    if (!file) throw new Error(`/graphics/${layer.clip.index}: has no rendered file`);
    const { graphic } = layer.clip;
    const at = graphicPlacement(graphic, output);
    if (graphic.layout === "label" || graphic.layout === "lower-third") {
      const index = opened.add(overlayInput(file));
      graph.push(
        `[${index}:v]${overlayTiming(layer, fps).join(",")}[c${k}]`,
        `${base}[c${k}]${overlay(at)}[d${k}]`,
      );
    } else {
      const index = opened.add(["-i", file]);
      graph.push(
        `[${index}:v]${overlayTiming(layer, fps).slice(0, -1).join(",")},format=yuv420p[c${k}]`,
        `${base}[c${k}]${slideIn(graphic.layout, at, layer, output)}[d${k}]`,
      );
    }
    base = `[d${k}]`;
  }
  for (const [k, layer] of piece.overlays.entries()) {
    const file = overlays[layer.clip.index];
    if (!file) throw new Error(`/overlays/${layer.clip.index}: has no rendered file`);
    const index = opened.add(overlayInput(file));
    const whole = overlay(placement(undefined, output));
    graph.push(
      `[${index}:v]${overlayTiming(layer, fps).join(",")}[e${k}]`,
      `${base}[e${k}]${whole}[f${k}]`,
    );
    base = `[f${k}]`;
  }
  if (watermark) {
    const index = opened.add(["-i", watermark.path]);
    const at = watermarkPlacement(watermark, output);
    graph.push(...watermarkLines(index, watermark, at, piece.graphics, base, "[wm]"));
    base = "[wm]";
  }
  graph.push(`${base}format=yuv420p[v]`);
  return [
    ...QUIET,
    ...opened.args,
    "-filter_complex",
    graph.join(";"),
    "-map",
    "[v]",
    ...RAW_VIDEO,
    "pipe:1",
  ];
}

/**
 * A layer's picture, clocked and framed into `box`, as graph lines and the link they end in: one
 * chain from the source, or, where the layer's framing cuts to another crop size, to or from a
 * split screen, or to another scale (framingCuts()), one chain for each stretch between its cuts,
 * each with its own crop, joined end to end. FFmpeg's crop keeps one size per chain.
 */
function framed(
  opened: ReturnType<typeof inputs>,
  layer: {
    clip: Pick<TimelineClip, "in" | "source"> & { clip: { framing?: Framing } };
    fromFrame: number;
    frames: number;
  },
  box: { width: number; height: number },
  timeline: Timeline,
  label: string,
): { lines: string[]; out: string } {
  const { frameTicks, output } = timeline;
  const { clip } = layer;
  const { framing } = clip.clip;
  const late = ON_SCREEN_TOLERANCE * TICKS_PER_SECOND;
  // The first frame of the layer that shows each cut.
  const cuts = framingCuts(framing)
    .map((t) => Math.ceil((t - late - clip.in) / frameTicks - 1e-9) - layer.fromFrame)
    .filter((n) => n > 0 && n < layer.frames);
  const edges = [0, ...new Set(cuts), layer.frames];
  const stretches = edges.slice(1).map((end, k) => {
    const from = edges[k] as number;
    const start = clip.in + (layer.fromFrame + from) * frameTicks;
    const span = { start, frames: end - from, frameTicks };
    const { index, offset } = opened.open(clip.source, start);
    const chain = [
      ...clock(offset, output.fps, end - from),
      ...fill(framing, box, clip.source, span, `${label}_${k}`),
      ...push(framing, span, box),
    ];
    return `[${index}:v]${chain.join(",")}[${label}_${k}]`;
  });
  if (stretches.length === 1) return { lines: stretches, out: `[${label}_0]` };
  const parts = stretches.map((_, k) => `[${label}_${k}]`).join("");
  const { num, den } = output.fps;
  return {
    // concat keeps the frame rate but counts time in microseconds; a dissolve's xfade needs the
    // frame rate's own time base, as the other clip has.
    lines: [
      ...stretches,
      `${parts}concat=n=${stretches.length}:v=1:a=0,settb=${den}/${num}[${label}_all]`,
    ],
    out: `[${label}_all]`,
  };
}

/** The piece's sound, written to stdout as raw samples. */
export function pieceAudio(piece: Piece, timeline: Timeline): string[] {
  const { frameTicks } = timeline;
  const opened = inputs(timeline);
  const graph: string[] = [];
  for (const [i, layer] of piece.main.entries()) {
    const { clip } = layer;
    let sound = silence(layer.samples);
    const { voice } = clip.source;
    if (clip.source.audio && voice) {
      const start = Math.max(0, clip.in - Math.round(lead(voice.chain) * TICKS_PER_SECOND));
      // vework writes the stem from the source's time zero, so its own timestamps start at 0.
      const { index, offset } = opened.open(
        voice.stem ? { ...clip.source, path: voice.stem, zero: 0 } : clip.source,
        start,
      );
      const processed = voiceSound({ input: `[${index}:a:0]`, offset }, voice.chain, `v${i}`);
      graph.push(...processed.lines);
      const from = layer.fromSample + ticksToSamples(clip.in) - ticksToSamples(start);
      sound = `${processed.out}${span(from, layer.samples).join(",")}`;
    } else if (clip.source.audio) {
      const { index, offset } = opened.open(clip.source, clip.in);
      sound = soundClock(`[${index}:a:0]`, offset, layer.fromSample, layer.samples);
    }
    const shaped = fades(layer.fadeIn, layer.fadeOut, layer.samples);
    graph.push(`${[sound, ...shaped].join(",")}[m${i}]`);
  }
  let base = "[m0]";
  if (piece.main.length === 2) {
    graph.push(`[m0][m1]${crossfade(piece.samples)}[dissolved]`);
    base = "[dissolved]";
  }
  const voiced = piece.broll.filter(
    (layer) => layer.clip.clip.gainDb !== undefined && layer.clip.source.audio,
  );
  for (const [j, layer] of voiced.entries()) {
    const { clip } = layer;
    const { index, offset } = opened.open(clip.source, clip.in);
    const samplesAt = (frame: number) => ticksToSamples(frame * frameTicks);
    const total = samplesAt(clip.end) - samplesAt(clip.start);
    const fade =
      clip.fade > 0 ? samplesAt(clip.start + clip.fade) - samplesAt(clip.start) : EDGE_FADE_SAMPLES;
    const chain = [
      soundClock(`[${index}:a:0]`, offset, layer.fromSample, layer.samples),
      ...brollSound(layer, fade, total, clip.clip.gainDb ?? 0),
    ];
    graph.push(`${chain.join(",")}[b${j}]`);
  }
  if (voiced.length > 0) {
    const labels = voiced.map((_, j) => `[b${j}]`).join("");
    graph.push(`${base}${labels}${mix(voiced.length + 1)}[a]`);
  } else {
    graph.push(`${base}anull[a]`);
  }
  return [
    ...QUIET,
    ...opened.args,
    "-filter_complex",
    graph.join(";"),
    "-map",
    "[a]",
    "-c:a",
    "pcm_f32le",
    ...RAW_AUDIO,
    "pipe:1",
  ];
}
