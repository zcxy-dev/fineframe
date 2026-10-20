import assert from "node:assert/strict";
import { test } from "node:test";
import { type Block, placeBlocks } from "./place.ts";

// A 1080 × 1920 frame: captions sit with their bottom at 1380, within 270..1500.
const BOTTOM = 1380;
const BAND: [number, number] = [270, 1500];
const block = (start: number, end: number, height = 200, shot = 0): Block => ({
  start,
  end,
  shot,
  left: 240,
  right: 840,
  height,
});
const face = (start: number, end: number, y0: number, y1: number) => ({
  start,
  end,
  boxes: [{ x0: 400, y0, x1: 680, y1 }],
});

test("captions sit at their place while no face is under them", () => {
  assert.deepEqual(placeBlocks([block(0, 30), block(30, 60, 100)], BOTTOM, BAND, []), [
    BOTTOM,
    BOTTOM,
  ]);
  // A face elsewhere on screen, or under the caption at another time, changes nothing.
  const aside = { start: 0, end: 60, boxes: [{ x0: 900, y0: 1200, x1: 1060, y1: 1400 }] };
  assert.deepEqual(placeBlocks([block(0, 30)], BOTTOM, BAND, [aside, face(30, 60, 1200, 1400)]), [
    BOTTOM,
  ]);
});

test("a caption over a face moves to the nearer clear side, and the next keeps its place", () => {
  // The face spans 1100..1360 under a caption spanning 1180..1380; above it is nearer.
  const [moved, kept, other] = placeBlocks(
    [block(0, 30), block(30, 60, 100), block(60, 90, 200, 1)],
    BOTTOM,
    BAND,
    [face(0, 90, 1100, 1360)],
  );
  assert.ok(moved !== undefined && moved <= 1100 - 260 * 0.25 - 12, `moved to ${moved}`);
  // The next caption in the same shot lines its bottom up with it rather than hopping.
  assert.equal(kept, moved);
  // A caption in another shot starts from its own place, and is moved again.
  assert.equal(other, moved);
  // A chin just over the caption's top sends it below the face, nearer than above: 1200 plus
  // 12 % of the face and a 12 px gap, and the caption's 200 px.
  const [below] = placeBlocks([block(0, 30)], BOTTOM, BAND, [face(0, 30, 1050, 1200)]);
  assert.equal(below, 1200 + 18 + 12 + 200);
  // With no room below the face inside the band, it goes above.
  const [above] = placeBlocks([block(0, 30)], BOTTOM, BAND, [face(0, 30, 1000, 1350)]);
  assert.equal(above, 1000 - 350 * 0.25 - 12);
});

test("a caption covers a face before it covers a visual", () => {
  // A panel over the top 880 rows, and the speaker's face below it filling the band: the caption
  // goes on the seam under the panel, over the top of the face, rather than over the panel.
  const panel = { start: 0, end: 30, boxes: [{ x0: 0, y0: 0, x1: 1080, y1: 880 }], hard: true };
  const [seam] = placeBlocks([block(0, 30)], BOTTOM, BAND, [panel, face(0, 30, 900, 1500)]);
  assert.equal(seam, 880 + 12 + 200);
});
