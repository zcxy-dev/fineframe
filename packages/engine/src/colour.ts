// Colour science for matching and looks: R'G'B' as the output carries it (BT.709 primaries, on a
// BT.1886 display), CIELAB under D65 for perceptual judgements, and CIEDE2000 colour differences.

/** Normalised R'G'B', each 0 to 1. */
export type Rgb = [number, number, number];
/** CIELAB: L* 0 to 100, a* and b*. */
export type Lab = [number, number, number];

// BT.709 primaries with a D65 white, linear RGB to XYZ (IEC 61966-2-1 rounds them the same way).
const TO_XYZ = [
  [0.4124564, 0.3575761, 0.1804375],
  [0.2126729, 0.7151522, 0.072175],
  [0.0193339, 0.119192, 0.9503041],
];
const FROM_XYZ = [
  [3.2404542, -1.5371385, -0.4985314],
  [-0.969266, 1.8760108, 0.041556],
  [0.0556434, -0.2040259, 1.0572252],
];
const WHITE = [0.95047, 1, 1.08883];
/** BT.1886 with a black at zero: a pure 2.4 power. */
const GAMMA = 2.4;

const times = (m: number[][], v: readonly number[]) =>
  m.map((row) => row.reduce((sum, value, i) => sum + value * (v[i] ?? 0), 0)) as Rgb;

export function rgbToLab(rgb: Readonly<Rgb>): Lab {
  const linear = rgb.map((v) => Math.max(0, v) ** GAMMA);
  const xyz = times(TO_XYZ, linear).map((v, i) => v / (WHITE[i] as number));
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116);
  const [fx, fy, fz] = xyz.map(f) as [number, number, number];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function labToRgb([l, a, b]: Readonly<Lab>): Rgb {
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inverse = (f: number) => (f ** 3 > 216 / 24389 ? f ** 3 : (116 * f - 16) / (24389 / 27));
  const xyz = [inverse(fx), inverse(fy), inverse(fz)].map((v, i) => v * (WHITE[i] as number));
  return times(FROM_XYZ, xyz).map((v) => Math.sign(v) * Math.abs(v) ** (1 / GAMMA)) as Rgb;
}

/** Chroma and hue angle in degrees, 0 to 360. */
export function chromaHue([, a, b]: Readonly<Lab>): [number, number] {
  const hue = (Math.atan2(b, a) * 180) / Math.PI;
  return [Math.hypot(a, b), hue < 0 ? hue + 360 : hue];
}

export function fromChromaHue(l: number, chroma: number, hue: number): Lab {
  const radians = (hue * Math.PI) / 180;
  return [l, chroma * Math.cos(radians), chroma * Math.sin(radians)];
}

/** The signed difference between two hue angles, -180 to 180 degrees. */
export function hueDifference(to: number, from: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** CIEDE2000 (Sharma, Wu and Dalal 2005), with kL = kC = kH = 1. */
export function deltaE2000(one: Readonly<Lab>, two: Readonly<Lab>): number {
  const [l1, a1, b1] = one;
  const [l2, a2, b2] = two;
  const rad = Math.PI / 180;
  const meanC = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const g = 0.5 * (1 - Math.sqrt(meanC ** 7 / (meanC ** 7 + 25 ** 7)));
  const p1 = (1 + g) * a1;
  const p2 = (1 + g) * a2;
  const c1 = Math.hypot(p1, b1);
  const c2 = Math.hypot(p2, b2);
  const angle = (b: number, a: number) => {
    if (a === 0 && b === 0) return 0;
    const h = Math.atan2(b, a) / rad;
    return h < 0 ? h + 360 : h;
  };
  const h1 = angle(b1, p1);
  const h2 = angle(b2, p2);
  const dL = l2 - l1;
  const dC = c2 - c1;
  let dh = 0;
  if (c1 * c2 !== 0) {
    dh = h2 - h1;
    if (dh > 180) dh -= 360;
    else if (dh < -180) dh += 360;
  }
  const dH = 2 * Math.sqrt(c1 * c2) * Math.sin((dh / 2) * rad);
  const meanL = (l1 + l2) / 2;
  const meanCp = (c1 + c2) / 2;
  let meanH = h1 + h2;
  if (c1 * c2 !== 0) {
    if (Math.abs(h1 - h2) <= 180) meanH = (h1 + h2) / 2;
    else meanH = h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2;
  }
  const t =
    1 -
    0.17 * Math.cos((meanH - 30) * rad) +
    0.24 * Math.cos(2 * meanH * rad) +
    0.32 * Math.cos((3 * meanH + 6) * rad) -
    0.2 * Math.cos((4 * meanH - 63) * rad);
  const dTheta = 30 * Math.exp(-(((meanH - 275) / 25) ** 2));
  const rC = 2 * Math.sqrt(meanCp ** 7 / (meanCp ** 7 + 25 ** 7));
  const sL = 1 + (0.015 * (meanL - 50) ** 2) / Math.sqrt(20 + (meanL - 50) ** 2);
  const sC = 1 + 0.045 * meanCp;
  const sH = 1 + 0.015 * meanCp * t;
  const rT = -Math.sin(2 * dTheta * rad) * rC;
  return Math.sqrt((dL / sL) ** 2 + (dC / sC) ** 2 + (dH / sH) ** 2 + rT * (dC / sC) * (dH / sH));
}

/** Values from 0 to 1 by a smooth ramp from `low` to `high`. */
export function smoothstep(low: number, high: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
}

/** How much a colour counts as skin, 0 to 1: a hue near the skin tones', moderate chroma and
 * mid lightness, ranges that hold skin from very light to very deep but not saturated oranges,
 * greens, blues or greys. Ramps at the edges keep the protection from drawing contours. */
export function skinWeight(lab: Readonly<Lab>): number {
  const [chroma, hue] = chromaHue(lab);
  const off = Math.abs(hueDifference(hue, 50));
  return (
    (1 - smoothstep(20, 35, off)) *
    smoothstep(4, 10, chroma) *
    (1 - smoothstep(45, 60, chroma)) *
    smoothstep(10, 20, lab[0]) *
    (1 - smoothstep(90, 97, lab[0]))
  );
}

export interface SkinLimits {
  /** Degrees a skin tone's hue may turn. */
  hue: number;
  /** The least and most its chroma may be multiplied by. */
  chroma: [number, number];
}

/** `after` with the hue and chroma change from `before` limited where `before` is skin, in
 * proportion to how much it is; lightness changes pass through. */
export function protectSkin(before: Readonly<Rgb>, after: Readonly<Rgb>, limits: SkinLimits): Rgb {
  const from = rgbToLab(before);
  const weight = skinWeight(from);
  if (weight === 0) return [...after];
  const to = rgbToLab(after);
  const [c0, h0] = chromaHue(from);
  const [c1, h1] = chromaHue(to);
  const turn = hueDifference(h1, h0);
  const ratio = c1 / c0;
  const clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v));
  const limitedTurn = turn + weight * (clamp(turn, -limits.hue, limits.hue) - turn);
  const [low, high] = limits.chroma;
  const limitedRatio = ratio + weight * (clamp(ratio, low, high) - ratio);
  return labToRgb(fromChromaHue(to[0], c0 * limitedRatio, h0 + limitedTurn));
}
