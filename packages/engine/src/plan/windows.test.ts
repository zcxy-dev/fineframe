import assert from "node:assert/strict";
import { test } from "node:test";
import { windowsIn } from "./windows.ts";

/** A grey frame, 160 × 90, from a function of each pixel. */
function frame(at: (x: number, y: number) => number) {
  const pixels = new Uint8Array(160 * 90);
  for (let y = 0; y < 90; y++) for (let x = 0; x < 160; x++) pixels[y * 160 + x] = at(x, y);
  return { pixels, width: 160, height: 90 };
}

/** Texture, as a camera's picture has: never plain over three pixels. */
const texture = (x: number, y: number) => 60 + ((x * 37 + y * 91) % 120);

test("a video call's windows are found around each face, a caption box joined to one or not", () => {
  // A small window in the top-left corner, a tall one in the middle, and a caption box across
  // the bottom of the middle one and the black either side of it.
  const call = frame((x, y) => {
    if (x < 40 && y < 33) return texture(x, y);
    if (x >= 50 && x < 110) return texture(x, y);
    if (y >= 78 && y < 86 && x >= 34 && x < 126) return 150;
    return 0;
  });
  const faces = [
    { x: 0.1, y: 0.1, w: 0.08, h: 0.15 },
    { x: 0.45, y: 0.3, w: 0.12, h: 0.3 },
  ];
  assert.deepEqual(windowsIn(call, faces), [
    { x: 0, y: 0, w: 0.25, h: 33 / 90 },
    { x: 50 / 160, y: 0, w: 60 / 160, h: 1 },
  ]);
});

test("a person in front of a plain wall, or a picture with no plain background, is in no window", () => {
  const face = { x: 0.45, y: 0.2, w: 0.1, h: 0.25 };
  // A head and shoulders against a plain wall: the wall shows inside the top of their outline.
  const wall = frame((x, y) => {
    const head = (x - 80) ** 2 / 100 + (y - 30) ** 2 / 225 < 1;
    const body = y > 45 && Math.abs(x - 80) < 10 + (y - 45);
    return head || body ? texture(x, y) : 200;
  });
  assert.deepEqual(windowsIn(wall, [face]), [undefined]);
  assert.deepEqual(windowsIn(frame(texture), [face]), [undefined]);
});
