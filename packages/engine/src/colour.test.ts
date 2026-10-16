import assert from "node:assert/strict";
import { test } from "node:test";
import {
  chromaHue,
  deltaE2000,
  hueDifference,
  type Lab,
  labToRgb,
  protectSkin,
  type Rgb,
  rgbToLab,
  skinWeight,
} from "./colour.ts";

const close = (actual: number, expected: number, within: number, what = "") =>
  assert.ok(Math.abs(actual - expected) <= within, `${what} ${actual}, expected ${expected}`);
const rgb = (r: number, g: number, b: number): Rgb => [r / 255, g / 255, b / 255];

test("CIEDE2000 matches Sharma, Wu and Dalal's test data", () => {
  const pairs: [Lab, Lab, number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];
  for (const [one, two, expected] of pairs) {
    close(deltaE2000(one, two), expected, 1e-4, JSON.stringify([one, two]));
    close(deltaE2000(two, one), expected, 1e-4, "symmetric");
  }
});

test("R'G'B' and CIELAB convert both ways, white is L* 100 and neutral", () => {
  const [l, a, b] = rgbToLab([1, 1, 1]);
  close(l, 100, 1e-4);
  close(a, 0, 1e-3);
  close(b, 0, 1e-3);
  for (const colour of [
    rgb(194, 150, 130),
    rgb(56, 61, 150),
    rgb(8, 133, 161),
    [0.5, 0.5, 0.5] as Rgb,
  ]) {
    const back = labToRgb(rgbToLab(colour));
    for (const i of [0, 1, 2]) close(back[i] ?? 0, colour[i] ?? 0, 1e-5);
  }
  close(hueDifference(10, 350), 20, 1e-9);
  close(hueDifference(350, 10), -20, 1e-9);
});

test("skin tones count as skin; sky, foliage, saturated orange and greys do not", () => {
  // ColorChecker light and dark skin, and a deep skin tone.
  for (const skin of [rgb(194, 150, 130), rgb(115, 82, 68), rgb(92, 58, 42)]) {
    close(skinWeight(rgbToLab(skin)), 1, 1e-9, String(skin));
  }
  for (const other of [
    rgb(98, 122, 157),
    rgb(87, 108, 67),
    rgb(214, 126, 44),
    rgb(122, 122, 121),
  ]) {
    close(skinWeight(rgbToLab(other)), 0, 1e-9, String(other));
  }
});

test("skin protection limits a turn of hue and a change of chroma, not one of lightness", () => {
  const skin = rgb(194, 150, 130);
  const [c0, h0] = chromaHue(rgbToLab(skin));
  const turned = (degrees: number, ratio: number, lighter = 0): Rgb => {
    const [l] = rgbToLab(skin);
    const hue = ((h0 + degrees) * Math.PI) / 180;
    return labToRgb([l + lighter, c0 * ratio * Math.cos(hue), c0 * ratio * Math.sin(hue)]);
  };
  const limits = { hue: 3, chroma: [0.9, 1.1] as [number, number] };
  const kept = rgbToLab(protectSkin(skin, turned(12, 1.4, 5), limits));
  const [c1, h1] = chromaHue(kept);
  close(hueDifference(h1, h0), 3, 1e-3, "hue");
  close(c1 / c0, 1.1, 1e-4, "chroma");
  close(kept[0], rgbToLab(skin)[0] + 5, 1e-3, "lightness");
  // Within the limits nothing changes, and a colour that is not skin is never limited.
  const small = turned(2, 1.05);
  const same = protectSkin(skin, small, limits);
  for (const i of [0, 1, 2]) close(same[i] ?? 0, small[i] ?? 0, 1e-5);
  const sky = rgb(98, 122, 157);
  const bluer: Rgb = [0.2, 0.4, 0.9];
  assert.deepEqual(protectSkin(sky, bluer, limits), bluer);
});
