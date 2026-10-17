// One piece's FFmpeg run: its inputs and its filter graph, for the video pass or the audio pass.

import { type Grade, TICKS_PER_SECOND } from "@video-editor/schema";
import { lutKey } from "../looks.ts";
import type { Piece } from "../pieces.ts";
import { EDGE_FADE_SAMPLES } from "../pieces.ts";
import type { SourceFacts } from "../sources.ts";
import { type Timeline, ticksToSamples } from "../timeline.ts";
import { fades, silence, soundClock, span } from "./audio.ts";
import { brollSound, brollTiming, mix, overlay, panelRect, placement } from "./broll.ts";
import { QUIET, RAW_AUDIO, RAW_VIDEO } from "./encode.ts";
import { openSource } from "./inputs.ts";
import { overlayInput, overlayTiming } from "./overlays.ts";
import { crossfade, dissolve } from "./transitions.ts";
import { clock, colour, dips, fill, push } from "./video.ts";
import { lead, voiceSound } from "./voice.ts";

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
 * `timeline.overlays`, in its order, and `cards` those of `timeline.cards`; `luts` the .cube
 * file of each clip's match and look, by lutKey. */
export function pieceVideo(
  piece: Piece,
  timeline: Timeline,
  overlays: string[] = [],
  luts: ReadonlyMap<string, string> = new Map(),
  cards: string[] = [],
): string[] {
  const lut = (grade: Grade | undefined) => {
    const key = lutKey(grade);
    if (key === null) return undefined;
    const file = luts.get(key);
    if (!file) throw new Error("A clip's match or look has no LUT file");
    return file;
  };
  const { output, frameTicks } = timeline;
  const { fps } = output;
  const opened = inputs(timeline);
  const graph: string[] = [];
  for (const [i, layer] of piece.main.entries()) {
    const { clip } = layer;
    const start = clip.in + layer.fromFrame * frameTicks;
    const { index, offset } = opened.open(clip.source, start);
    const chain = [
      ...clock(offset, fps, layer.frames),
      ...fill(clip.clip.framing, output, clip.source, { start, frames: layer.frames, frameTicks }),
      ...push(clip.clip.framing, { start, frames: layer.frames, frameTicks }, output),
      ...colour(clip.clip.grade, lut(clip.clip.grade)),
      "format=yuv420p",
      ...dips(layer.dipIn, layer.dipOut, layer.frames),
    ];
    graph.push(`[${index}:v]${chain.join(",")}[m${i}]`);
  }
  let base = "[m0]";
  if (piece.main.length === 2) {
    graph.push(`[m0][m1]${dissolve(piece.end - piece.start, fps)}[dissolved]`);
    base = "[dissolved]";
  }
  for (const [j, layer] of piece.broll.entries()) {
    const { clip } = layer;
    const at = placement(clip.clip.rect, output);
    const start = clip.in + layer.fromFrame * frameTicks;
    const { index, offset } = opened.open(clip.source, start);
    const chain = [
      ...clock(offset, fps, layer.frames),
      ...fill(clip.clip.framing, at, clip.source, { start, frames: layer.frames, frameTicks }),
      ...push(clip.clip.framing, { start, frames: layer.frames, frameTicks }, at),
      ...colour(clip.clip.grade, lut(clip.clip.grade)),
      ...brollTiming(layer, fps),
    ];
    graph.push(`[${index}:v]${chain.join(",")}[b${j}]`, `${base}[b${j}]${overlay(at)}[o${j}]`);
    base = `[o${j}]`;
  }
  for (const [k, layer] of piece.cards.entries()) {
    const file = cards[layer.clip.index];
    if (!file) throw new Error(`/cards/${layer.clip.index}: has no rendered file`);
    const index = opened.add(["-i", file]);
    const { card } = layer.clip;
    const at = placement(card.placement === "panel" ? panelRect(output.aspect) : undefined, output);
    graph.push(
      `[${index}:v]${overlayTiming(layer, fps).slice(0, -1).join(",")},format=yuv420p[c${k}]`,
      `${base}[c${k}]${overlay(at)}[d${k}]`,
    );
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
