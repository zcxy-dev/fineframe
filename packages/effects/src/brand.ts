// A brand kit's look over the effects, applied as they render: every colour in the house amber's
// family, whether the house stylesheet's, a template's or one Claude wrote into a graphic, becomes
// the kit's colour of the same tone, with its alpha kept, and the type is set in the kit's face.
// Graphics are planned in the house look alone, so a kit changes with a render and no new plan.

import { extname } from "node:path";
import postcss, { type Declaration, type Root, type Rule } from "postcss";
import {
  type BrandColors,
  brandTones,
  fromHsl,
  hex,
  isAmber,
  PALETTE,
  READABLE,
  type Rgb,
  readable,
  replacement,
  toHex,
} from "./colour.ts";
import { markFiles } from "./icons.ts";
import type { Restyle } from "./markup.ts";
import { HOUSE_CSS } from "./style.ts";

/** What the effects take from a kit: its colours and, unless the house faces stay, the file of
 * the face graphics and templates are set in, with its SHA-256. */
export interface BrandLook {
  colors: BrandColors;
  font?: { path: string; sha256: string };
}

/** A colour as CSS names it: RGB from 0 to 255 and an alpha. */
interface Colour {
  rgb: Rgb;
  alpha: number;
}

/** Every CSS named colour (CSS Color 4). */
const NAMED: Record<string, string> = {
  aliceblue: "#f0f8ff", antiquewhite: "#faebd7", aqua: "#00ffff", aquamarine: "#7fffd4",
  azure: "#f0ffff", beige: "#f5f5dc", bisque: "#ffe4c4", black: "#000000",
  blanchedalmond: "#ffebcd", blue: "#0000ff", blueviolet: "#8a2be2", brown: "#a52a2a",
  burlywood: "#deb887", cadetblue: "#5f9ea0", chartreuse: "#7fff00", chocolate: "#d2691e",
  coral: "#ff7f50", cornflowerblue: "#6495ed", cornsilk: "#fff8dc", crimson: "#dc143c",
  cyan: "#00ffff", darkblue: "#00008b", darkcyan: "#008b8b", darkgoldenrod: "#b8860b",
  darkgray: "#a9a9a9", darkgreen: "#006400", darkgrey: "#a9a9a9", darkkhaki: "#bdb76b",
  darkmagenta: "#8b008b", darkolivegreen: "#556b2f", darkorange: "#ff8c00",
  darkorchid: "#9932cc", darkred: "#8b0000", darksalmon: "#e9967a", darkseagreen: "#8fbc8f",
  darkslateblue: "#483d8b", darkslategray: "#2f4f4f", darkslategrey: "#2f4f4f",
  darkturquoise: "#00ced1", darkviolet: "#9400d3", deeppink: "#ff1493", deepskyblue: "#00bfff",
  dimgray: "#696969", dimgrey: "#696969", dodgerblue: "#1e90ff", firebrick: "#b22222",
  floralwhite: "#fffaf0", forestgreen: "#228b22", fuchsia: "#ff00ff", gainsboro: "#dcdcdc",
  ghostwhite: "#f8f8ff", gold: "#ffd700", goldenrod: "#daa520", gray: "#808080",
  green: "#008000", greenyellow: "#adff2f", grey: "#808080", honeydew: "#f0fff0",
  hotpink: "#ff69b4", indianred: "#cd5c5c", indigo: "#4b0082", ivory: "#fffff0",
  khaki: "#f0e68c", lavender: "#e6e6fa", lavenderblush: "#fff0f5", lawngreen: "#7cfc00",
  lemonchiffon: "#fffacd", lightblue: "#add8e6", lightcoral: "#f08080", lightcyan: "#e0ffff",
  lightgoldenrodyellow: "#fafad2", lightgray: "#d3d3d3", lightgreen: "#90ee90",
  lightgrey: "#d3d3d3", lightpink: "#ffb6c1", lightsalmon: "#ffa07a", lightseagreen: "#20b2aa",
  lightskyblue: "#87cefa", lightslategray: "#778899", lightslategrey: "#778899",
  lightsteelblue: "#b0c4de", lightyellow: "#ffffe0", lime: "#00ff00", limegreen: "#32cd32",
  linen: "#faf0e6", magenta: "#ff00ff", maroon: "#800000", mediumaquamarine: "#66cdaa",
  mediumblue: "#0000cd", mediumorchid: "#ba55d3", mediumpurple: "#9370db",
  mediumseagreen: "#3cb371", mediumslateblue: "#7b68ee", mediumspringgreen: "#00fa9a",
  mediumturquoise: "#48d1cc", mediumvioletred: "#c71585", midnightblue: "#191970",
  mintcream: "#f5fffa", mistyrose: "#ffe4e1", moccasin: "#ffe4b5", navajowhite: "#ffdead",
  navy: "#000080", oldlace: "#fdf5e6", olive: "#808000", olivedrab: "#6b8e23", orange: "#ffa500",
  orangered: "#ff4500", orchid: "#da70d6", palegoldenrod: "#eee8aa", palegreen: "#98fb98",
  paleturquoise: "#afeeee", palevioletred: "#db7093", papayawhip: "#ffefd5",
  peachpuff: "#ffdab9", peru: "#cd853f", pink: "#ffc0cb", plum: "#dda0dd", powderblue: "#b0e0e6",
  purple: "#800080", rebeccapurple: "#663399", red: "#ff0000", rosybrown: "#bc8f8f",
  royalblue: "#4169e1", saddlebrown: "#8b4513", salmon: "#fa8072", sandybrown: "#f4a460",
  seagreen: "#2e8b57", seashell: "#fff5ee", sienna: "#a0522d", silver: "#c0c0c0",
  skyblue: "#87ceeb", slateblue: "#6a5acd", slategray: "#708090", slategrey: "#708090",
  snow: "#fffafa", springgreen: "#00ff7f", steelblue: "#4682b4", tan: "#d2b48c", teal: "#008080",
  thistle: "#d8bfd8", tomato: "#ff6347", turquoise: "#40e0d0", violet: "#ee82ee",
  wheat: "#f5deb3", white: "#ffffff", whitesmoke: "#f5f5f5", yellow: "#ffff00",
  yellowgreen: "#9acd32",
}; // biome-ignore format: one table

/** The named colours in the amber's family, as isAmber reads them. */
const AMBER_NAMES = Object.keys(NAMED).filter((name) => isAmber(hex(NAMED[name] as string)));

/** Every colour a CSS value writes out: hex, rgb() and hsl() in either syntax, and the named
 * ambers, each as a whole word. */
const COLOUR = new RegExp(
  `#[0-9a-fA-F]{3,8}(?![\\w-])|(?<![\\w-])(?:rgba?|hsla?)\\([^()]*\\)|(?<![\\w-])(?:${AMBER_NAMES.join("|")})(?![\\w-])`,
  "gi",
);
/** The same, without the names: a name in a custom property may be an animation's. */
const WRITTEN = /#[0-9a-fA-F]{3,8}(?![\w-])|(?<![\w-])(?:rgba?|hsla?)\([^()]*\)/gi;

/** Properties whose value is or holds a colour; nothing else is recoloured, so an animation,
 * a font or a grid named like a colour stays as it is. */
const COLOURED =
  /^(color|background(-color|-image)?|border(-(top|right|bottom|left|block|inline)(-(start|end))?)?(-color)?|outline(-color)?|box-shadow|text-shadow|fill|stroke|stop-color|flood-color|lighting-color|caret-color|accent-color|column-rule(-color)?|text-decoration(-color)?|text-emphasis(-color)?|-webkit-text-fill-color|-webkit-text-stroke(-color)?|filter)$/;

/** A number of a colour function: a percentage of `scale`, or as written. */
function channel(value: string, scale: number): number {
  return value.endsWith("%") ? (Number.parseFloat(value) / 100) * scale : Number.parseFloat(value);
}

/** A colour token as RGB and alpha, or null for one this does not read. */
function parseColour(token: string): Colour | null {
  const lower = token.toLowerCase();
  if (NAMED[lower]) return { rgb: hex(NAMED[lower]), alpha: 1 };
  if (lower.startsWith("#")) {
    const digits = lower.slice(1);
    const full =
      digits.length === 3 || digits.length === 4 ? [...digits].map((d) => d + d).join("") : digits;
    if (full.length !== 6 && full.length !== 8) return null;
    const alpha = full.length === 8 ? Number.parseInt(full.slice(6), 16) / 255 : 1;
    return { rgb: hex(`#${full.slice(0, 6)}`), alpha };
  }
  const inner = /\(([^()]*)\)/.exec(lower)?.[1];
  if (inner === undefined) return null;
  const parts = inner.split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.some((part) => !/^[-+.\d]+(%|deg|turn)?$/.test(part))) return null;
  const alpha = parts[3] === undefined ? 1 : channel(parts[3], 1);
  if (lower.startsWith("rgb")) {
    const rgb = parts.slice(0, 3).map((part) => channel(part, 255)) as Rgb;
    return { rgb, alpha };
  }
  // CSS Color 4 writes saturation and lightness as percentages or as numbers out of 100.
  const [hue, saturation, lightness] = parts as [string, string, string];
  const h = Number.parseFloat(hue) * (hue.endsWith("turn") ? 360 : 1);
  const [s, l] = [saturation, lightness].map((part) => Number.parseFloat(part) / 100) as [
    number,
    number,
  ];
  return { rgb: fromHsl(((h % 360) + 360) % 360, s, l), alpha };
}

const format = ({ rgb, alpha }: Colour) =>
  alpha >= 1
    ? toHex(rgb)
    : `rgba(${rgb.map((c) => Math.round(c)).join(", ")}, ${Number(alpha.toFixed(3))})`;

/** Properties that colour text: an amber there is the kit's primary, as accent text is. */
const TEXT = new Set(["color", "-webkit-text-fill-color"]);

/** A size, the token in a font shorthand the family follows (after a line height, if any). */
const SIZE =
  /^((\d*\.)?\d+(px|em|rem|%|pt|pc|vh|vw|vmin|vmax|ch|ex|cm|mm|in|q)|(calc|var|min|max|clamp)\(|(xx?-)?(small|large)\b|medium\b|smaller\b|larger\b)/i;
/^(calc\(|var\(|min\(|max\(|clamp\(|[\d.]|(xx?-)?(small|large)$|medium$|smaller$|larger$)/i;

/** The top-level tokens of a value, split at spaces outside brackets and quotes. */
function tokens(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (const char of value) {
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (/\s/.test(char) && depth === 0) {
      if (current) out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) out.push(current);
  return out;
}

/** The family a kit's face is set in, in the pages effects render as. */
const FAMILY = "Fineframe Brand";
const FAMILIES = `"${FAMILY}", "Noto Sans TC", sans-serif`;

/**
 * Run in a page in a kit's look as it loads: text whose colour falls under 3:1 contrast against
 * what fills the box behind it, the nearest box up the page with a fill of at least half
 * opacity or else the dark stage, is black or white instead, whichever reads better. It follows
 * the cascade as the browser resolved it, so text in a box filled with the kit's colour by
 * another rule is read against that colour too. The page's only script of its own.
 */
const READABLE_TEXT = `(() => {
  const parse = (value) => {
    const match = /rgba?\\(([^)]*)\\)/.exec(value || "");
    if (!match) return null;
    const parts = match[1].split(/[\\s,/]+/).filter(Boolean).map(Number);
    return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
  };
  const luminance = (rgb) => {
    const [r, g, b] = rgb.map((c) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const stage = [${hex(PALETTE.ink).join(", ")}];
  const behind = (element) => {
    for (let at = element; at && at.id !== "root"; at = at.parentElement) {
      const style = getComputedStyle(at);
      const fill = parse(style.backgroundColor);
      if (fill && fill.alpha >= 0.5) return fill.rgb;
      const image = parse(style.backgroundImage);
      if (image && image.alpha >= 0.5) return image.rgb;
    }
    return stage;
  };
  for (const element of document.querySelectorAll("#frame *")) {
    const own = [...element.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());
    if (!own) continue;
    const colour = parse(getComputedStyle(element).color);
    if (!colour) continue;
    const fill = behind(element);
    if (contrast(colour.rgb, fill) >= ${READABLE}) continue;
    const black = contrast([0, 0, 0], fill) > contrast([255, 255, 255], fill);
    element.style.setProperty("color", black ? "#000000" : "#ffffff", "important");
  }
})();`;

/** A kit's colours and face over a page: each amber in its CSS replaced by the kit's tone with
 * its alpha kept, text in an amber in the kit's primary, every font family the kit's face when
 * it has one, icons and logos drawn in the accent drawn in the kit's, and text kept readable on
 * what is behind it as the page loads. */
export class Rebrand implements Restyle {
  readonly tones: ReturnType<typeof brandTones>;
  /** The kit face's file, and the name it is served under from the render's folder: its
   * content's hash and its extension, so two kits' faces never share one. */
  readonly font: { path: string; name: string } | null;

  constructor(look: BrandLook) {
    this.tones = brandTones(look.colors);
    this.font = look.font
      ? {
          path: look.font.path,
          name: `${look.font.sha256.slice(0, 16)}${extname(look.font.path).toLowerCase()}`,
        }
      : null;
  }

  /** A colour token in the kit's look: an amber replaced by the kit's tone nearest it in
   * lightness, or as text by the primary, alpha kept. */
  #token(token: string, text: boolean): string {
    const parsed = parseColour(token);
    if (!parsed || !isAmber(parsed.rgb)) return token;
    const rgb = text ? hex(this.tones.primary) : replacement(parsed.rgb, this.tones);
    return format({ rgb, alpha: parsed.alpha });
  }

  #declaration(declaration: Declaration): void {
    const property = declaration.prop.toLowerCase();
    const { value } = declaration;
    if (property === "font-family") {
      if (this.font) declaration.value = FAMILIES;
    } else if (property === "font") {
      // The family follows the size, and its line height if any.
      const parts = tokens(value);
      const size = parts.findIndex((part) => SIZE.test(part));
      if (this.font && size >= 0 && size < parts.length - 1) {
        declaration.value = [...parts.slice(0, size + 1), FAMILIES].join(" ");
      }
    } else if (COLOURED.test(property)) {
      const text = TEXT.has(property);
      declaration.value = value.replace(COLOUR, (token) => this.#token(token, text));
    } else if (property.startsWith("--")) {
      // A custom property holds a colour written out, or one named alone.
      declaration.value = AMBER_NAMES.includes(value.trim().toLowerCase())
        ? this.#token(value.trim(), false)
        : value.replace(WRITTEN, (token) => this.#token(token, false));
    }
  }

  #rules(root: Root): Root {
    root.walkDecls((declaration) => this.#declaration(declaration));
    return root;
  }

  /** A stylesheet in the kit's look. */
  css(css: string): string {
    return this.#rules(postcss.parse(css)).toString();
  }

  /** A style attribute's declarations in the kit's look. */
  style(style: string): string {
    const rule = this.#rules(postcss.parse(`x{${style}}`)).first as Rule;
    return rule.nodes.map((node) => node.toString()).join("; ");
  }

  /** The page's own script, which keeps text readable on what is behind it. */
  script(): string {
    return READABLE_TEXT;
  }

  /** The folder the icons and logos drawn in the kit's accent are served from. */
  get #marks(): string {
    return `brand/marks-${readable(this.tones.primary, PALETTE.ink).slice(1)}`;
  }

  /** An image's source: an icon or logo drawn in the accent, from the kit's copy. */
  src(src: string): string {
    return src.startsWith("icons/accent/") || src.startsWith("logos/")
      ? `${this.#marks}/${src}`
      : src;
  }

  /** The files a page in the kit's look loads besides the render's own, by their path in its
   * folder: the icons and logos in the kit's accent, and its face's file. */
  files(): Map<string, { text: string } | { copy: string }> {
    const files = new Map<string, { text: string } | { copy: string }>();
    const accent = readable(this.tones.primary, PALETTE.ink);
    for (const [path, svg] of markFiles()) {
      if (path.startsWith("icons/accent/") || path.startsWith("logos/")) {
        files.set(`${this.#marks}/${path}`, { text: svg.replaceAll(PALETTE.accent, accent) });
      }
    }
    if (this.font) files.set(`brand/${this.font.name}`, { copy: this.font.path });
    return files;
  }

  /** The house stylesheet in the kit's look, with the kit's face first where it has one. */
  house(): string {
    const css = this.css(HOUSE_CSS);
    if (!this.font) return css;
    return `${css}@font-face { font-family: "${FAMILY}"; src: url(brand/${this.font.name}); font-weight: 100 900; font-display: block; }
.ff, .ff * { font-family: ${FAMILIES}; }
`;
  }
}
