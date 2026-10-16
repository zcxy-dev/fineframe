import assert from "node:assert/strict";
import { test } from "node:test";
import { chromaHue, hueDifference, type Rgb, rgbToLab } from "./colour.ts";
import { applyLook, cube, gradeColour, LOOKS, lookIds, lutKey, monotone } from "./looks.ts";

const rgb = (r: number, g: number, b: number): Rgb => [r / 255, g / 255, b / 255];
const skins = [rgb(194, 150, 130), rgb(115, 82, 68), rgb(224, 172, 140), rgb(92, 58, 42)];

test("a tone curve passes through its points and never turns back", () => {
  for (const id of lookIds) {
    const curve = monotone(LOOKS[id].curve);
    for (const [x, y] of LOOKS[id].curve) assert.ok(Math.abs(curve(x) - y) < 1e-9, `${id} at ${x}`);
    for (let x = 0; x < 100; x += 0.5) assert.ok(curve(x + 0.5) >= curve(x), `${id} at ${x}`);
  }
});

test("each look keeps greys grey in the mid-tones and tints only where it says", () => {
  const mid = (id: (typeof lookIds)[number]) => rgbToLab(applyLook(id, [0.5, 0.5, 0.5]));
  for (const id of ["clean", "cool"] as const) {
    const [, a, b] = mid(id);
    assert.ok(Math.hypot(a, b) < 2, `${id}: a* ${a}, b* ${b}`);
  }
  // Warm puts amber in the light, film lifts its blacks, and both keep white off clipping;
  // clean leaves white white, as screen recordings need.
  const light = rgbToLab(applyLook("warm", [0.85, 0.85, 0.85]));
  assert.ok(light[2] > 3, `warm highlights b* ${light[2]}`);
  assert.ok(rgbToLab(applyLook("film", [0, 0, 0]))[0] > 4);
  const shadow = rgbToLab(applyLook("film", [0.15, 0.15, 0.15]));
  assert.ok(shadow[2] < -2, `film shadows b* ${shadow[2]}`);
  for (const id of ["warm", "film"] as const) {
    assert.ok(rgbToLab(applyLook(id, [1, 1, 1]))[0] < 99, id);
  }
  assert.ok(rgbToLab(applyLook("clean", [1, 1, 1]))[0] > 99.9);
});

test("skin keeps its hue within 3° and its chroma within 10 % under every look", () => {
  for (const id of lookIds) {
    for (const skin of skins) {
      const [c0, h0] = chromaHue(rgbToLab(skin));
      const [c1, h1] = chromaHue(rgbToLab(gradeColour({ look: { id, intensity: 1 } }, skin)));
      const at = `${id} on ${skin.map((v) => Math.round(v * 255))}`;
      assert.ok(Math.abs(hueDifference(h1, h0)) <= 3.01, `${at}: turned ${hueDifference(h1, h0)}°`);
      assert.ok(c1 / c0 >= 0.899 && c1 / c0 <= 1.101, `${at}: chroma × ${c1 / c0}`);
    }
  }
  // Without protection, cool's blue shadows would turn deep skin further than that, and film
  // would take a third of its colour.
  const deep = skins[3] as Rgb;
  const [c0, h0] = chromaHue(rgbToLab(deep));
  assert.ok(hueDifference(chromaHue(rgbToLab(applyLook("cool", deep)))[1], h0) < -5);
  assert.ok(chromaHue(rgbToLab(applyLook("film", deep)))[0] / c0 < 0.7);
});

test("intensity blends from none to the whole look", () => {
  const colour = rgb(98, 122, 157);
  const full = gradeColour({ look: { id: "film", intensity: 1 } }, colour);
  const half = gradeColour({ look: { id: "film", intensity: 0.5 } }, colour);
  for (const i of [0, 1, 2]) {
    assert.ok(Math.abs((half[i] ?? 0) - ((colour[i] ?? 0) + (full[i] ?? 0)) / 2) < 1e-9);
  }
  assert.deepEqual(gradeColour({ look: { id: "film", intensity: 0 } }, colour), colour);
});

test("a match is the matrix and offset on R'G'B'; a LUT is needed only for a match or a look", () => {
  const match = {
    reference: "a",
    matrix: [
      [1.1, 0, 0],
      [0, 1, 0],
      [0, 0, 0.9],
    ] as [[number, number, number], [number, number, number], [number, number, number]],
    offset: [0.01, 0, -0.01] as [number, number, number],
  };
  const sky = rgb(98, 122, 157);
  const moved = gradeColour({ match }, sky);
  assert.ok(Math.abs((moved[0] ?? 0) - (1.1 * (sky[0] ?? 0) + 0.01)) < 1e-9);
  assert.ok(Math.abs((moved[2] ?? 0) - (0.9 * (sky[2] ?? 0) - 0.01)) < 1e-9);
  assert.equal(lutKey(undefined), null);
  assert.equal(lutKey({ auto: { contrast: 1, gamma: 1, saturation: 1 } }), null);
  assert.equal(lutKey({ look: { id: "warm", intensity: 0 } }), null);
  assert.notEqual(lutKey({ match }), null);
  assert.notEqual(
    lutKey({ match }),
    lutKey({ match: { ...match, reference: "b" }, look: { id: "warm", intensity: 1 } }),
  );
  assert.equal(lutKey({ match }), lutKey({ match: { ...match, reference: "b" } }));
});

test("the LUT without a match or look is the identity, red changing fastest", () => {
  const lines = cube(undefined, 3).trim().split("\n");
  assert.deepEqual(lines.slice(0, 3), ["LUT_3D_SIZE 3", "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"]);
  assert.equal(lines.length, 3 + 27);
  assert.equal(lines[3 + 1], "0.500000 0.000000 0.000000");
  assert.equal(lines[3 + 3], "0.000000 0.500000 0.000000");
  assert.equal(lines.at(-1), "1.000000 1.000000 1.000000");
});
