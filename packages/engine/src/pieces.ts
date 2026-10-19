import { type Framing, TICKS_PER_SECOND } from "@video-editor/schema";
import { framingCuts } from "./framing.ts";
import { ON_SCREEN_TOLERANCE } from "./graph/video.ts";
import {
  type Dip,
  type Timeline,
  type TimelineBroll,
  type TimelineCard,
  type TimelineClip,
  type TimelineOverlay,
  ticksToSamples,
} from "./timeline.ts";

/** 5 ms fades on the sound at a hard cut: twice what the click measurement needed, far too short
 * to hear (packages/engine/README.md). */
export const EDGE_FADE_SAMPLES = 240;

/** A range of one clip: `frames` output frames and `samples` output samples, starting
 * `fromFrame` frames and `fromSample` samples after the clip's own start. */
interface Span {
  fromFrame: number;
  frames: number;
  fromSample: number;
  samples: number;
}

interface MainLayer extends Span {
  clip: TimelineClip;
  /** Picture fades from and to a colour (dips) at this span's edges. */
  dipIn: Dip | null;
  dipOut: Dip | null;
  /** Sound fades in and out, in samples, where the span meets a cut or a dip. */
  fadeIn: number;
  fadeOut: number;
}

export interface BrollLayer extends Span {
  clip: TimelineBroll;
  /** Where the span starts within the piece. */
  atFrame: number;
  atSample: number;
}

/** Frames [fromFrame, fromFrame + frames) of a rendered overlay, starting `atFrame` frames into
 * the piece. */
export interface OverlayLayer {
  clip: TimelineOverlay;
  fromFrame: number;
  frames: number;
  atFrame: number;
}

/** Frames of a rendered card, taken by count as an overlay's are. */
interface CardLayer {
  clip: TimelineCard;
  fromFrame: number;
  frames: number;
  atFrame: number;
}

/** A stretch of the edit rendered by one FFmpeg process: one main clip, or the two a dissolve
 * blends, with the B-roll, cards and overlays over it. Pieces join back to back in output
 * order. */
export interface Piece {
  /** Output frames [start, end). */
  start: number;
  end: number;
  samples: number;
  main: [MainLayer] | [MainLayer, MainLayer];
  broll: BrollLayer[];
  cards: CardLayer[];
  overlays: OverlayLayer[];
}

/**
 * Splits the timeline into pieces: each clip's body, and each dissolve on its own. A piece needs
 * at most two main decoders plus its B-roll, so memory stays bounded however many cuts the edit
 * has; one FFmpeg process opening every clip at once holds frames for all of them.
 */
export function cutPieces(timeline: Timeline): Piece[] {
  const samplesAt = (frame: number) => ticksToSamples(frame * timeline.frameTicks);
  const span = (clipStart: number, start: number, end: number): Span => ({
    fromFrame: start - clipStart,
    frames: end - start,
    fromSample: samplesAt(start) - samplesAt(clipStart),
    samples: samplesAt(end) - samplesAt(start),
  });
  const piece = (start: number, end: number, main: Piece["main"]): Piece => ({
    start,
    end,
    samples: samplesAt(end) - samplesAt(start),
    main,
    broll: timeline.broll.flatMap((clip) => {
      const from = Math.max(start, clip.start);
      const to = Math.min(end, clip.end);
      if (to <= from) return [];
      const atSample = samplesAt(from) - samplesAt(start);
      return [{ ...span(clip.start, from, to), clip, atFrame: from - start, atSample }];
    }),
    cards: timeline.cards.flatMap((clip) => {
      const from = Math.max(start, clip.start);
      const to = Math.min(end, clip.end);
      if (to <= from) return [];
      return [{ clip, fromFrame: from - clip.start, frames: to - from, atFrame: from - start }];
    }),
    overlays: timeline.overlays.flatMap((clip) => {
      const from = Math.max(start, clip.start);
      const to = Math.min(end, clip.end);
      if (to <= from) return [];
      return [{ clip, fromFrame: from - clip.start, frames: to - from, atFrame: from - start }];
    }),
  });

  /** A span's dips and sound fades: at its start when it opens on a cut or a dip, and at its
   * end when it closes on one. */
  const edges = (layer: Span & Pick<MainLayer, "clip">, opens: boolean, closes: boolean) => ({
    ...layer,
    dipIn: opens ? layer.clip.dipIn : null,
    dipOut: closes ? layer.clip.dipOut : null,
    fadeIn: opens ? soundFade(layer.clip.dipIn, timeline, layer.samples) : 0,
    fadeOut: closes ? soundFade(layer.clip.dipOut, timeline, layer.samples) : 0,
  });
  const bodiless = (clip: TimelineClip) =>
    clip.dissolveIn + clip.dissolveOut === clip.end - clip.start;

  const pieces: Piece[] = [];
  for (const [i, clip] of timeline.main.entries()) {
    const start = clip.start + clip.dissolveIn;
    const end = clip.end - clip.dissolveOut;
    if (end > start) {
      const layer = { ...span(clip.start, start, end), clip };
      pieces.push(piece(start, end, [edges(layer, clip.dissolveIn === 0, clip.dissolveOut === 0)]));
    }
    const next = timeline.main[i + 1];
    if (next && clip.dissolveOut > 0) {
      const tail = { ...span(clip.start, next.start, clip.end), clip };
      const head = { ...span(next.start, next.start, clip.end), clip: next };
      // A clip that lies wholly inside a dissolve has no body piece, so the dissolve takes over
      // its edge at the cut or dip on its other side.
      pieces.push(
        piece(next.start, clip.end, [
          edges(tail, bodiless(clip) && clip.dissolveIn === 0, false),
          edges(head, false, bodiless(next) && next.dissolveOut === 0),
        ]),
      );
    }
  }
  return pieces;
}

/** A dip fades the sound with the picture; a hard cut gets a short edge fade. Never more than
 * half the span, so a fade in and a fade out cannot overlap. */
function soundFade(dip: Dip | null, timeline: Timeline, samples: number): number {
  const wanted = dip ? ticksToSamples(dip.frames * timeline.frameTicks) : EDGE_FADE_SAMPLES;
  return Math.min(Math.max(wanted, EDGE_FADE_SAMPLES), Math.floor(samples / 2));
}

/**
 * The pieces split, for the picture, wherever a clip's framing cuts to a crop of another size, to
 * or from a split screen, or to another scale (framingCuts()): FFmpeg draws each stretch with one
 * crop size. The sound keeps the pieces whole. A framing that cuts during a dissolve is refused.
 */
export function framedPieces(pieces: readonly Piece[], timeline: Timeline): Piece[] {
  const { frameTicks } = timeline;
  const late = ON_SCREEN_TOLERANCE * TICKS_PER_SECOND;
  const samplesAt = (frame: number) => ticksToSamples(frame * frameTicks);
  /** The frames into a span at which its clip's framing cuts: the first frame showing each. */
  const cutsIn = (
    clip: { in: number; clip: { framing?: Framing } },
    fromFrame: number,
    frames: number,
  ) =>
    framingCuts(clip.clip.framing)
      .map((t) => Math.ceil((t - late - clip.in) / frameTicks - 1e-9) - fromFrame)
      .filter((n) => n > 0 && n < frames);
  return pieces.flatMap((piece) => {
    const cuts = new Set<number>();
    for (const layer of piece.main) {
      for (const n of cutsIn(layer.clip, layer.fromFrame, layer.frames)) cuts.add(piece.start + n);
    }
    for (const layer of piece.broll) {
      for (const n of cutsIn(layer.clip, layer.fromFrame, layer.frames)) {
        cuts.add(piece.start + layer.atFrame + n);
      }
    }
    if (cuts.size === 0) return [piece];
    if (piece.main.length > 1) {
      throw new Error(`/main/${piece.main[1]?.clip.index}: its framing cuts during a dissolve`);
    }
    const edges = [piece.start, ...[...cuts].sort((a, b) => a - b), piece.end];
    return edges.slice(1).map((end, k) => {
      const start = edges[k] as number;
      const within = <L extends { fromFrame: number; frames: number; atFrame: number }>(
        layer: L,
      ): L[] => {
        const from = Math.max(start, piece.start + layer.atFrame);
        const to = Math.min(end, piece.start + layer.atFrame + layer.frames);
        if (to <= from) return [];
        const skipped = from - (piece.start + layer.atFrame);
        return [
          {
            ...layer,
            fromFrame: layer.fromFrame + skipped,
            frames: to - from,
            atFrame: from - start,
          },
        ];
      };
      const [main] = piece.main;
      const skipped = start - piece.start;
      const clipStart = main.clip.start;
      return {
        start,
        end,
        samples: samplesAt(end) - samplesAt(start),
        main: [
          {
            ...main,
            fromFrame: main.fromFrame + skipped,
            frames: end - start,
            fromSample: samplesAt(start) - samplesAt(clipStart),
            samples: samplesAt(end) - samplesAt(start),
            dipIn: start === piece.start ? main.dipIn : null,
            dipOut: end === piece.end ? main.dipOut : null,
            fadeIn: start === piece.start ? main.fadeIn : 0,
            fadeOut: end === piece.end ? main.fadeOut : 0,
          },
        ],
        broll: piece.broll.flatMap((layer) =>
          within(layer).map((cut) => ({
            ...cut,
            fromSample: samplesAt(layer.clip.start + cut.fromFrame) - samplesAt(layer.clip.start),
            samples: samplesAt(cut.frames) - samplesAt(0),
            atSample: samplesAt(start + cut.atFrame) - samplesAt(start),
          })),
        ),
        cards: piece.cards.flatMap(within),
        overlays: piece.overlays.flatMap(within),
      };
    });
  });
}
