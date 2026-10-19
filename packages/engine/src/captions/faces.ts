// Where the faces are in the output frame, so captions can keep off them: the media index's face
// boxes, seen through the crop of the clip that shows them, on the main track or in a B-roll rect
// such as the speaker's half of a split screen.

import { layoutFor } from "@video-editor/effects";
import { type Framing, type Project, TICKS_PER_SECOND } from "@video-editor/schema";
import { panes } from "../framing.ts";
import { panelRect, placement } from "../graph/broll.ts";
import type { SourceFacts } from "../sources.ts";
import type { Timeline } from "../timeline.ts";
import type { FaceZone } from "./place.ts";

/** Something on screen over output frames [start, end), in a box of output pixels. */
interface Layer {
  start: number;
  end: number;
  /** Source ticks at its first frame. */
  in: number;
  source: SourceFacts | null;
  framing: Framing | undefined;
  box: { x: number; y: number; width: number; height: number };
}

/**
 * Every face on screen, in output pixels, over the output frames it shows on. Each detection
 * stands for its source frames until the next sample. A face that B-roll or a card drawn over it
 * hides is left out.
 */
export function faceZones(
  timeline: Pick<Timeline, "main" | "broll" | "frameTicks"> & Partial<Pick<Timeline, "cards">>,
  output: Pick<Project["output"], "width" | "height" | "aspect">,
): FaceZone[] {
  const main: Layer[] = timeline.main.map((clip) => ({
    ...{ start: clip.start, end: clip.end, in: clip.in, source: clip.source },
    framing: clip.clip.framing,
    box: placement(undefined, output),
  }));
  const broll: Layer[] = timeline.broll.map((clip) => ({
    ...{ start: clip.start, end: clip.end, in: clip.in, source: clip.source },
    framing: clip.clip.framing,
    box: placement(clip.clip.rect, output),
  }));
  const cards: Layer[] = (timeline.cards ?? []).map((clip) => ({
    ...{ start: clip.start, end: clip.end, in: 0, source: null, framing: undefined },
    box: placement(clip.card.placement === "panel" ? panelRect(output.aspect) : undefined, output),
  }));
  // Layers bottom to top: each is covered by the ones after it.
  const layers = [
    ...main.map((layer) => [layer, 0] as const),
    ...broll.map((layer, i) => [layer, i + 1] as const),
  ];
  return layers.flatMap(([layer, above]) =>
    zonesOf(layer, [...broll.slice(above), ...cards], timeline.frameTicks, output),
  );
}

/**
 * What visuals draw, as zones captions keep off like faces: a split screen's panel of B-roll from
 * another source than the speaker's (whose own half captions may sit over), a card in its panel,
 * and a full-frame card above the bottom safe margin it leaves for captions.
 */
export function visualZones(
  timeline: Pick<Timeline, "main" | "broll"> & Partial<Pick<Timeline, "cards">>,
  output: Pick<Project["output"], "width" | "height" | "aspect">,
): FaceZone[] {
  const speakers = new Set(timeline.main.map((clip) => clip.source?.id));
  const zone = (
    start: number,
    end: number,
    box: { x: number; y: number; width: number; height: number },
  ) => ({
    start,
    end,
    boxes: [{ x0: box.x, y0: box.y, x1: box.x + box.width, y1: box.y + box.height }],
  });
  const broll = timeline.broll
    .filter((clip) => clip.clip.rect && !speakers.has(clip.source?.id))
    .map((clip) => zone(clip.start, clip.end, placement(clip.clip.rect, output)));
  const above =
    output.height - Math.round(layoutFor(output.aspect, output.width, output.height).safe.bottom);
  const cards = (timeline.cards ?? []).map((clip) =>
    clip.card.placement === "panel"
      ? zone(clip.start, clip.end, placement(panelRect(output.aspect), output))
      : zone(clip.start, clip.end, { x: 0, y: 0, width: output.width, height: above }),
  );
  return [...broll, ...cards];
}

function zonesOf(
  layer: Layer,
  covers: readonly Layer[],
  frameTicks: number,
  output: Pick<Project["output"], "width" | "height">,
): FaceZone[] {
  const faces = layer.source?.faces;
  if (!faces) return [];
  const zones: FaceZone[] = [];
  const seconds = (frames: number) => (frames * frameTicks) / TICKS_PER_SECOND;
  const from = layer.in / TICKS_PER_SECOND;
  const to = from + seconds(layer.end - layer.start);
  // The output frame that shows source time t: frame n shows from + n frames.
  const frameOf = (t: number) =>
    layer.start + Math.ceil(((t - from) * TICKS_PER_SECOND) / frameTicks - 1e-9);
  const hold = 1 / faces.framing.fps;
  for (const shot of faces.framing.shots) {
    if (shot.end <= from || shot.start >= to) continue;
    for (const face of shot.faces) {
      for (const detection of face.boxes) {
        const start = Math.max(layer.start, frameOf(detection.t));
        const end = Math.min(layer.end, frameOf(Math.min(detection.t + hold, shot.end)));
        if (end <= start) continue;
        const t = detection.t * TICKS_PER_SECOND;
        for (const { view, box } of panes(layer.framing, t, faces.aspect, layer.box)) {
          const x0 = box.x + ((detection.x - view.x) / view.w) * box.width;
          const x1 = box.x + ((detection.x + detection.w - view.x) / view.w) * box.width;
          const y0 = box.y + ((detection.y - view.y) / view.h) * box.height;
          const y1 = box.y + ((detection.y + detection.h - view.y) / view.h) * box.height;
          if (x1 <= box.x || x0 >= box.x + box.width || y1 <= box.y || y0 >= box.y + box.height) {
            continue;
          }
          if (x1 <= 0 || x0 >= output.width || y1 <= 0 || y0 >= output.height) continue;
          const cx = (x0 + x1) / 2;
          const cy = (y0 + y1) / 2;
          const hidden = covers.some(
            (cover) =>
              cover.start <= start &&
              end <= cover.end &&
              cx >= cover.box.x &&
              cx < cover.box.x + cover.box.width &&
              cy >= cover.box.y &&
              cy < cover.box.y + cover.box.height,
          );
          if (hidden) continue;
          // Only the part inside its box shows: the rest is under what is beside it.
          const inside = {
            x0: Math.max(x0, box.x),
            y0: Math.max(y0, box.y),
            x1: Math.min(x1, box.x + box.width),
            y1: Math.min(y1, box.y + box.height),
          };
          zones.push({ start, end, boxes: [inside] });
        }
      }
    }
  }
  return zones;
}
