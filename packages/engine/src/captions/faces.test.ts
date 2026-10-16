import assert from "node:assert/strict";
import { test } from "node:test";
import type { CropPath, FaceFraming, Framing } from "@video-editor/schema";
import { visible } from "../framing.ts";
import { facts, project, SECOND, sources } from "../testing.ts";
import { buildTimeline } from "../timeline.ts";
import { faceZones } from "./faces.ts";
import { buildCaptions } from "./index.ts";

const WIDE = 16 / 9;
const PORTRAIT = { width: 1080, height: 1920 };
const close = (actual: object, expected: Record<string, number>) => {
  for (const [key, value] of Object.entries(expected)) {
    const got = (actual as Record<string, number>)[key] as number;
    assert.ok(Math.abs(got - value) < 1e-6, `${key}: ${got}, expected ${value}`);
  }
};

test("the part of the source on screen follows the crop, its shape and its punch-in", () => {
  const narrow = 9 / 16 / WIDE;
  // No framing: the largest centred region of the output's shape.
  close(visible(undefined, 0, WIDE, PORTRAIT), { x: (1 - narrow) / 2, y: 0, w: narrow, h: 1 });
  // A static crop already of that shape, and the same crop punched in by 1.25 around its centre.
  const rect = { x: 0.1, y: 0, w: narrow, h: 1 };
  close(visible({ crop: { type: "static", rect } }, 0, WIDE, PORTRAIT), rect);
  close(visible({ crop: { type: "static", rect }, scale: 1.25 }, 0, WIDE, PORTRAIT), {
    x: 0.1 + (narrow - narrow / 1.25) / 2,
    y: 0.1,
    w: narrow / 1.25,
    h: 0.8,
  });
  // A path, halfway between its keyframes; a crop past the edge is kept inside the picture.
  const path: CropPath = {
    type: "path",
    keyframes: [
      { t: 0, rect: { x: 0, y: 0, w: narrow, h: 1 } },
      { t: 2 * SECOND, rect: { x: 0.9, y: 0, w: narrow, h: 1 } },
    ],
  };
  close(visible({ crop: path }, SECOND, WIDE, PORTRAIT), { x: 0.45 });
  close(visible({ crop: path }, 9 * SECOND, WIDE, PORTRAIT), { x: 1 - narrow });
  // A push-in about an anchor a quarter of the way across and 40 % down: at 1.25, the crop gives
  // up a fifth of its size, a quarter of that on the anchor's left and 40 % above it.
  const anchored: Framing = {
    crop: { type: "static", rect },
    scale: {
      type: "path",
      keyframes: [
        { t: 0, scale: 1 },
        { t: 2 * SECOND, scale: 1.25 },
      ],
    },
    anchor: { x: 0.25, y: 0.4 },
  };
  close(visible(anchored, 0, WIDE, PORTRAIT), rect);
  close(visible(anchored, 2 * SECOND, WIDE, PORTRAIT), {
    x: 0.1 + 0.25 * (narrow - narrow / 1.25),
    y: 0.4 * 0.2,
    w: narrow / 1.25,
    h: 0.8,
  });
});

/** One face low in the middle of a 16:9 picture, sampled twice a second for 10 s. */
const LOW_FACE: FaceFraming = {
  fps: 2,
  shots: [
    {
      start: 0,
      end: 10,
      layout: "talking_head",
      faces: [
        {
          id: 0,
          boxes: [
            { t: 0, x: 0.4, y: 0.7, w: 0.2, h: 0.25 },
            ...Array.from({ length: 19 }, (_, i) => ({
              t: (i + 1) / 2,
              x: 0.4,
              y: 0.7,
              w: 0.2,
              h: 0.25,
            })),
          ],
        },
      ],
      speakers: [],
    },
  ],
};

test("faces land on the output frames and pixels that show them", () => {
  const edit = project([{ source: "a", in: 2 * SECOND, out: 4 * SECOND }]);
  const timeline = buildTimeline(
    edit,
    sources(facts("a", { faces: { framing: LOW_FACE, aspect: WIDE } })),
  );
  const zones = faceZones(timeline, edit.output);
  // Source 2 s is output frame 0, and each sample holds for 15 frames at 30 fps.
  assert.deepEqual(
    zones.map((zone) => [zone.start, zone.end]),
    [
      [0, 15],
      [15, 30],
      [30, 45],
      [45, 60],
    ],
  );
  close(zones[0]?.boxes[0] ?? {}, { x0: 512, x1: 768, y0: 504, y1: 684 });
  // Under full-frame B-roll the face is hidden.
  const covered = project([{ source: "a", in: 2 * SECOND, out: 4 * SECOND }], {
    broll: [{ source: "b", in: 0, out: SECOND, start: 0 }],
  });
  const both = sources(facts("a", { faces: { framing: LOW_FACE, aspect: WIDE } }), facts("b"));
  assert.deepEqual(
    faceZones(buildTimeline(covered, both), covered.output).map((zone) => zone.start),
    [30, 45],
  );
});

test("a caption sits at its place, and above a face that would be under it", async () => {
  const line = {
    start: 0,
    end: 2 * SECOND,
    language: "zh-TW",
    text: "字幕不會蓋住臉",
    words: [{ text: "字幕不會蓋住臉", start: 0, end: 2 * SECOND }],
  };
  const edit = project([{ source: "a", in: 0, out: 3 * SECOND }], {
    captions: { preset: "bold", srt: false, lines: [line] },
  });
  const centre = async (faces: { framing: FaceFraming; aspect: number } | null) => {
    const built = await buildCaptions(edit, buildTimeline(edit, sources(facts("a", { faces }))));
    const face = built?.ass.split("\n").find((event) => event.startsWith("Dialogue: 4,"));
    return Number(/\\pos\([\d.]+,([\d.]+)\)/.exec(face ?? "")?.[1]);
  };
  // 16:9 at 720 lines: the caption's last row ends at 90 % of the height, over the face's
  // 504..684, so it moves above the face and the room kept over it.
  const placed = await centre(null);
  const moved = await centre({ framing: LOW_FACE, aspect: WIDE });
  assert.ok(placed > 600, `placed at ${placed}`);
  assert.ok(moved < 504 - 0.25 * 180, `moved to ${moved}`);
});
