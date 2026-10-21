// The house palette and the colour arithmetic a brand kit's look needs: which colours are in the
// house amber's family, the kit's tones in place of its three, and black or white where a colour
// would not read. No Node module, so the web page's previews use it too.

/** The palette, from the app's own colours. */
export const PALETTE = {
  ink: "#0b0c0f",
  text: "#f5f6f8",
  muted: "#a9adb5",
  accent: "#ffb547",
  accentDeep: "#e8941f",
  accentSoft: "#ffd48a",
  good: "#7bc29a",
  bad: "#e0807a",
} as const;

/** A kit's colours, `#rrggbb`: primary replaces the amber accent, secondary and accent its deeper
 * and lighter tones. */
export interface BrandColors {
  primary: string;
  secondary?: string;
  accent?: string;
}

export type Rgb = [number, number, number];

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];

/** Text this far from its backdrop in contrast, or more, reads at the sizes effects use. */
export const READABLE = 3;

export function hex(value: string): Rgb {
  const n = Number.parseInt(value.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const toHex = ([r, g, b]: Rgb) =>
  `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;

/** Hue in degrees, saturation and lightness from 0 to 1. */
export function hsl([r, g, b]: Rgb): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rr
      ? ((gg - bb) / d + (gg < bb ? 6 : 0)) * 60
      : max === gg
        ? ((bb - rr) / d + 2) * 60
        : ((rr - gg) / d + 4) * 60;
  return [h, s, l];
}

export function fromHsl(h: number, s: number, l: number): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/** Whether a colour is in the house amber's family: warm orange to gold, saturated, neither near
 * black nor near white. Every amber the house, the templates and the captions use is, and so are
 * the near ambers a graphic may be written with. */
export function isAmber(rgb: Rgb): boolean {
  const [h, s, l] = hsl(rgb);
  return h >= 20 && h <= 55 && s >= 0.45 && l >= 0.3 && l <= 0.92;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG's contrast ratio of two colours, from 1 to 21. */
export function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `colour` where text in it reads on `backdrop`, or else black or white, whichever reads
 * better. */
export function readable(colour: string, backdrop: string): string {
  const [c, b] = [hex(colour), hex(backdrop)];
  if (contrast(c, b) >= READABLE) return colour;
  return contrast(BLACK, b) > contrast(WHITE, b) ? "#000000" : "#ffffff";
}

/** Black or white, whichever reads better on `colour`. */
export function textOn(colour: string): string {
  const c = hex(colour);
  return contrast(BLACK, c) > contrast(WHITE, c) ? "#000000" : "#ffffff";
}

/** The house's three ambers, by lightness, and the kit's colour that replaces each. */
const ROLES = [
  { house: PALETTE.accentDeep, role: "secondary" },
  { house: PALETTE.accent, role: "primary" },
  { house: PALETTE.accentSoft, role: "accent" },
] as const;

/** The kit's three tones: its own, or the primary made deeper or lighter by as much as the house
 * amber's tones are. */
export function brandTones(
  colors: BrandColors,
): Record<"primary" | "secondary" | "accent", string> {
  const [h, s, l] = hsl(hex(colors.primary));
  const shift = (house: string) => {
    const lightness = hsl(hex(house))[2] - hsl(hex(PALETTE.accent))[2];
    return toHex(fromHsl(h, s, Math.min(0.95, Math.max(0.05, l + lightness))));
  };
  return {
    primary: colors.primary.toLowerCase(),
    secondary: (colors.secondary ?? shift(PALETTE.accentDeep)).toLowerCase(),
    accent: (colors.accent ?? shift(PALETTE.accentSoft)).toLowerCase(),
  };
}

/** The kit's colour in place of an amber: the tone whose house amber is nearest in lightness. */
export function replacement(rgb: Rgb, tones: ReturnType<typeof brandTones>): Rgb {
  const l = hsl(rgb)[2];
  let best: (typeof ROLES)[number] = ROLES[1];
  for (const each of ROLES) {
    if (Math.abs(hsl(hex(each.house))[2] - l) < Math.abs(hsl(hex(best.house))[2] - l)) best = each;
  }
  return hex(tones[best.role]);
}
