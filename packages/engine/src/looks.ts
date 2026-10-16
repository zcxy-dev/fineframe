// The designed looks a grade can put on top of the matched picture, and the 3D LUT the renderer
// applies for a clip's match and look together.
//
// Each look is a restrained grade a colourist would set for a talking-head edit: a tone curve on
// L*, a chroma trim that rolls off towards black and white, so shadows and highlights stay clean
// rather than tinted, and at most a gentle split between shadow and highlight colour. Skin is
// protected from every look's turns of hue and changes of chroma (SKIN_LOOK).

import type { Grade } from "@video-editor/schema";
import {
  chromaHue,
  fromChromaHue,
  type Lab,
  labToRgb,
  protectSkin,
  type Rgb,
  rgbToLab,
  type SkinLimits,
  smoothstep,
} from "./colour.ts";

export interface Look {
  /** What it suits, in a sentence for whoever picks the look. */
  description: string;
  /** L* in to L* out, through which a monotone curve passes; 0 and 100 must be listed. */
  curve: [number, number][];
  /** Chroma multiplier in the mid-tones. */
  chroma: number;
  /** a* and b* added in the shadows and in the highlights. */
  shadows: [number, number];
  highlights: [number, number];
}

export const LOOKS = {
  clean: {
    description:
      "Neutral and crisp: true to the footage, with a little more depth. Suits any edit.",
    curve: [
      [0, 0],
      [15, 13.5],
      [50, 50],
      [85, 86.5],
      [100, 100],
    ],
    chroma: 1.03,
    shadows: [0, 0],
    highlights: [0, 0],
  },
  warm: {
    description: "Golden and soft: friendly light for vlogs, lifestyle and people on camera.",
    curve: [
      [0, 2],
      [20, 20.5],
      [50, 51],
      [80, 81],
      [100, 98],
    ],
    chroma: 1,
    shadows: [1, 1.5],
    highlights: [1.5, 5],
  },
  cool: {
    description: "Clean and modern: cool shadows and firm contrast for tech, business and screens.",
    curve: [
      [0, 0],
      [15, 12.5],
      [50, 50],
      [85, 87.5],
      [100, 99],
    ],
    chroma: 0.95,
    shadows: [-0.5, -4],
    highlights: [0, -1],
  },
  film: {
    description: "Soft and cinematic: matte blacks, gentle highlights, teal shadows, warm light.",
    curve: [
      [0, 5],
      [20, 18.5],
      [50, 50],
      [80, 81.5],
      [100, 96],
    ],
    chroma: 0.88,
    shadows: [-3, -5],
    highlights: [1.5, 5],
  },
} as const satisfies Record<string, Look>;

export type LookId = keyof typeof LOOKS;
export const lookIds = Object.keys(LOOKS) as LookId[];
export const isLookId = (id: string): id is LookId => Object.hasOwn(LOOKS, id);

/** The look the planner puts on an edit unless asked for another. */
export const DEFAULT_LOOK = { id: "clean", intensity: 1 } as const;

/** How far a match may turn a skin tone's hue and change its chroma: as far as undoing a
 * camera's white balance turns skin (packages/engine/README.md#skin-tones), so faces agree.
 * Further, the statistics were misled by what the two sources show, and a green or magenta face
 * is where that is seen first. */
export const SKIN_MATCH: SkinLimits = { hue: 15, chroma: [0.5, 2] };
/** How far a look may: enough for its warmth to reach the face, never enough to make it orange,
 * grey or green. */
export const SKIN_LOOK: SkinLimits = { hue: 3, chroma: [0.9, 1.1] };

/** Monotone cubic interpolation (Fritsch and Butland), so a curve never overshoots its points
 * and tones never swap order. */
export function monotone(points: readonly (readonly [number, number])[]): (x: number) => number {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const n = points.length;
  const width = (i: number) => (xs[i + 1] as number) - (xs[i] as number);
  const slopes = xs.slice(1).map((_, i) => ((ys[i + 1] as number) - (ys[i] as number)) / width(i));
  const tangents = xs.map((_, i) => {
    if (i === 0) return slopes[0] as number;
    if (i === n - 1) return slopes[n - 2] as number;
    const a = slopes[i - 1] as number;
    const b = slopes[i] as number;
    if (a * b <= 0) return 0;
    // A weighted harmonic mean of the slopes on either side.
    const w1 = 2 * width(i) + width(i - 1);
    const w2 = width(i) + 2 * width(i - 1);
    return (w1 + w2) / (w1 / a + w2 / b);
  });
  return (x: number) => {
    if (x <= (xs[0] as number)) return ys[0] as number;
    if (x >= (xs[n - 1] as number)) return ys[n - 1] as number;
    let i = 0;
    while (x > (xs[i + 1] as number)) i++;
    const x0 = xs[i] as number;
    const h = (xs[i + 1] as number) - x0;
    const t = (x - x0) / h;
    const [y0, y1] = [ys[i] as number, ys[i + 1] as number];
    const [m0, m1] = [tangents[i] as number, tangents[i + 1] as number];
    return (
      (2 * t ** 3 - 3 * t ** 2 + 1) * y0 +
      (t ** 3 - 2 * t ** 2 + t) * h * m0 +
      (-2 * t ** 3 + 3 * t ** 2) * y1 +
      (t ** 3 - t ** 2) * h * m1
    );
  };
}

const curves = new Map<LookId, (x: number) => number>(
  lookIds.map((id) => [id, monotone(LOOKS[id].curve)]),
);

/** The look at full strength on one colour, before skin protection. */
export function applyLook(id: LookId, rgb: Readonly<Rgb>): Rgb {
  const look: Look = LOOKS[id];
  const [l, a, b] = rgbToLab(rgb);
  const [chroma, hue] = chromaHue([l, a, b]);
  const toned = (curves.get(id) as (x: number) => number)(l);
  // Colour thins out towards black and white, as film's does, instead of tinting them.
  const rolloff = 1 - 0.3 * (1 - smoothstep(0, 20, toned)) - 0.35 * smoothstep(85, 100, toned);
  const shade = 1 - smoothstep(10, 55, toned);
  const light = smoothstep(45, 90, toned);
  const [, a1, b1] = fromChromaHue(toned, chroma * look.chroma * rolloff, hue);
  const lab: Lab = [
    toned,
    a1 + look.shadows[0] * shade + look.highlights[0] * light,
    b1 + look.shadows[1] * shade + look.highlights[1] * light,
  ];
  return labToRgb(lab).map((v) => Math.min(1, Math.max(0, v))) as Rgb;
}

/** One colour through a clip's match and look, as the renderer's LUT applies them after the
 * auto grade. */
export function gradeColour(grade: Grade | undefined, rgb: Readonly<Rgb>): Rgb {
  let colour: Rgb = [...rgb];
  const match = grade?.match;
  if (match) {
    const moved = match.matrix.map(
      (row, i) =>
        row[0] * colour[0] + row[1] * colour[1] + row[2] * colour[2] + match.offset[i as 0 | 1 | 2],
    ) as Rgb;
    colour = protectSkin(colour, clamp(moved), SKIN_MATCH);
  }
  const look = grade?.look;
  if (look && look.intensity > 0 && isLookId(look.id)) {
    const full = protectSkin(colour, applyLook(look.id, colour), SKIN_LOOK);
    colour = colour.map((v, i) => v + look.intensity * ((full[i] as number) - v)) as Rgb;
  }
  return clamp(colour);
}

const clamp = (rgb: Rgb): Rgb => rgb.map((v) => Math.min(1, Math.max(0, v))) as Rgb;

/** What determines a clip's LUT, or null when its match and look change nothing. */
export function lutKey(grade: Grade | undefined): string | null {
  const match = grade?.match;
  const look = grade?.look && grade.look.intensity > 0 ? grade.look : undefined;
  if (!match && !look) return null;
  return JSON.stringify([match?.matrix, match?.offset, look?.id, look?.intensity]);
}

/** The LUT points per side: 33 is the common grading size, fine enough that tetrahedral
 * interpolation between points stays well under a level of 8-bit video. */
export const LUT_SIZE = 33;

/** The clip's match and look as a 3D LUT in the .cube format FFmpeg's lut3d reads. */
export function cube(grade: Grade | undefined, size = LUT_SIZE): string {
  const lines = [`LUT_3D_SIZE ${size}`, "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"];
  // Red changes fastest.
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const out = gradeColour(grade, [r / (size - 1), g / (size - 1), b / (size - 1)]);
        lines.push(out.map((v) => v.toFixed(6)).join(" "));
      }
    }
  }
  return `${lines.join("\n")}\n`;
}
