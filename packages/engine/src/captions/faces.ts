// Where the faces are in the output frame, so captions can keep off them: the media index's face
// boxes, seen through the crop of the main-track clip that shows them.

import { type Project, TICKS_PER_SECOND } from "@video-editor/schema";
import { visible } from "../framing.ts";
import type { Timeline } from "../timeline.ts";
import type { FaceZone } from "./place.ts";

/**
 * Every face on screen, in output pixels, over the output frames it shows on. Each detection
 * stands for its source frames until the next sample. A face under full-frame B-roll is hidden
 * and left out.
 */
export function faceZones(
  timeline: Pick<Timeline, "main" | "broll" | "frameTicks">,
  output: Pick<Project["output"], "width" | "height">,
): FaceZone[] {
  const covers = timeline.broll.filter((broll) => !broll.clip.rect);
  const zones: FaceZone[] = [];
  for (const clip of timeline.main) {
    const faces = clip.source.faces;
    if (!faces) continue;
    const seconds = (frames: number) => (frames * timeline.frameTicks) / TICKS_PER_SECOND;
    const from = clip.in / TICKS_PER_SECOND;
    const to = from + seconds(clip.end - clip.start);
    // The output frame that shows source time t: frame n shows from + n frames.
    const frameOf = (t: number) =>
      clip.start + Math.ceil(((t - from) * TICKS_PER_SECOND) / timeline.frameTicks - 1e-9);
    const hold = 1 / faces.framing.fps;
    for (const shot of faces.framing.shots) {
      if (shot.end <= from || shot.start >= to) continue;
      for (const face of shot.faces) {
        for (const box of face.boxes) {
          const start = Math.max(clip.start, frameOf(box.t));
          const end = Math.min(clip.end, frameOf(Math.min(box.t + hold, shot.end)));
          if (end <= start) continue;
          if (covers.some((broll) => broll.start <= start && end <= broll.end)) continue;
          const view = visible(clip.clip.framing, box.t * TICKS_PER_SECOND, faces.aspect, output);
          const x0 = ((box.x - view.x) / view.w) * output.width;
          const x1 = ((box.x + box.w - view.x) / view.w) * output.width;
          const y0 = ((box.y - view.y) / view.h) * output.height;
          const y1 = ((box.y + box.h - view.y) / view.h) * output.height;
          if (x1 <= 0 || x0 >= output.width || y1 <= 0 || y0 >= output.height) continue;
          zones.push({ start, end, boxes: [{ x0, y0, x1, y1 }] });
        }
      }
    }
  }
  return zones;
}
