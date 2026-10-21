import assert from "node:assert/strict";
import { test } from "node:test";
import { placementOf } from "./fcpxml.ts";
import type { Picture } from "./model.ts";
import { motionOf } from "./xmeml.ts";

const portrait = { width: 1080, height: 1920 };
const landscape = { width: 1920, height: 1080 };
// The left third of a 16:9 file, its full height, filling a 9:16 frame: the file at 1920/1080 of
// its size, its centre 0.5 - 0.3 = 0.2 of its width right of the frame's.
const left: Picture = {
  view: { x: 0.3 - 0.31640625 / 2, y: 0, w: 0.31640625, h: 1 },
  box: { x: 0, y: 0, ...portrait },
  crop: false,
};
const k = 1920 / 1080;
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual}, expected ${expected}`);

test("FCPXML scales the fitted file and moves it in percent of the frame's height, up positive", () => {
  const at = placementOf(left, landscape, portrait);
  // Final Cut fits 1920 × 1080 into 1080 × 1920 at 1080/1920.
  near(at.scale, k / (1080 / 1920));
  near(at.position[0], (100 * k * 1920 * 0.2) / 1920);
  near(at.position[1], 0);
  assert.equal(at.crop, null);
});

test("Premiere scales the file in percent of its own size and centres it over its own size", () => {
  const at = motionOf(left, landscape, portrait);
  near(at.scale, 100 * k);
  near(at.center[0], k * 0.2);
  near(at.center[1], 0);
});

test("a picture in part of the frame is cropped to what it shows", () => {
  const bottom: Picture = {
    view: { x: 0.25, y: 0, w: 0.5, h: 1 },
    box: { x: 0, y: 960, width: 1080, height: 960 },
    crop: true,
  };
  assert.deepEqual(motionOf(bottom, landscape, portrait).crop, {
    left: 25,
    right: 25,
    top: 0,
    bottom: 0,
  });
  const fcp = placementOf(bottom, landscape, portrait).crop;
  // A quarter of the fitted file's width, 1080 pixels, in percent of the frame's height.
  near(fcp?.left ?? 0, (100 * 270) / 1920);
  near(fcp?.top ?? 0, 0);
  // Its centre lands half way down the box, 480 pixels below the frame's centre.
  near(placementOf(bottom, landscape, portrait).position[1], (-100 * 480) / 1920);
  near(motionOf(bottom, landscape, portrait).center[1], 480 / 1080);
});
