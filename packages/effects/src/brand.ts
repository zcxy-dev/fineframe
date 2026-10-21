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
  type Rgb,
  readable,
  replacement,
  textOn,
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

// The named colours in or near the amber's family; isAmber decides which are in it.
const NAMED: Record<string, string> = {
  orange: "#ffa500",
  darkorange: "#ff8c00",
  gold: "#ffd700",
  goldenrod: "#daa520",
  darkgoldenrod: "#b8860b",
  sandybrown: "#f4a460",
  peru: "#cd853f",
  burlywood: "#deb887",
  wheat: "#f5deb3",
  navajowhite: "#ffdead",
  moccasin: "#ffe4b5",
  orangered: "#ff4500",
  coral: "#ff7f50",
  tomato: "#ff6347",
  khaki: "#f0e68c",
};

/** Every colour a CSS value can name outright: hex, rgb(), hsl() and the names above. */
const COLOUR = new RegExp(
  `#[0-9a-fA-F]{3,8}(?![\\w-])|(?<![\\w-])(?:rgba?|hsla?)\\([^()]*\\)|(?<![\\w-])(?:${Object.keys(NAMED).join("|")})(?![\\w-])`,
  "gi",
);

function channel(value: string, scale: number): number {
  const v = value.trim();
  return v.endsWith("%") ? (Number.parseFloat(v) / 100) * scale : Number.parseFloat(v);
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
  if (parts.length < 3 || parts.some((part) => !/^[-+.\d]+(%|deg)?$/.test(part))) return null;
  const alpha = parts[3] === undefined ? 1 : channel(parts[3], 1);
  if (lower.startsWith("rgb")) {
    const rgb = parts.slice(0, 3).map((part) => channel(part, 255)) as Rgb;
    return { rgb, alpha };
  }
  const [h, s, l] = [
    Number.parseFloat(parts[0] as string),
    channel(parts[1] as string, 1),
    channel(parts[2] as string, 1),
  ];
  return { rgb: fromHsl(((h % 360) + 360) % 360, s, l), alpha };
}

const format = ({ rgb, alpha }: Colour) =>
  alpha >= 1
    ? toHex(rgb)
    : `rgba(${rgb.map((c) => Math.round(c)).join(", ")}, ${Number(alpha.toFixed(3))})`;

/** The accent variables the house stylesheet defines. */
const ACCENT_VARS = /var\(\s*--accent(-deep|-soft)?\s*\)/g;

/** Properties that colour text, whose colour must read on what is behind it. */
const TEXT = new Set(["color", "-webkit-text-fill-color"]);
const BACKGROUND = new Set(["background", "background-color"]);

/** The family a kit's face is set in, in the pages effects render as. */
const FAMILY = "Fineframe Brand";

/** A kit's colours and face over a page: each amber in its CSS replaced by the kit's tone, text
 * in or on the accent kept readable, every font family set to the kit's face when it has one, and
 * icons and logos drawn in the accent drawn in the kit's. */
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

  /** A colour token in the kit's look: an amber replaced, alpha kept. Text in an amber is in the
   * kit's primary, the accent text takes in the house look, or black or white where that would
   * not read on the dark stage. */
  #token(token: string, text: boolean): string {
    const parsed = parseColour(token);
    if (!parsed || !isAmber(parsed.rgb)) return token;
    const rgb = text
      ? hex(readable(this.tones.primary, PALETTE.ink))
      : replacement(parsed.rgb, this.tones);
    return format({ rgb, alpha: parsed.alpha });
  }

  #tone(variant: string | undefined): string {
    return variant === "-deep"
      ? this.tones.secondary
      : variant === "-soft"
        ? this.tones.accent
        : this.tones.primary;
  }

  /** The kit's tone a rule fills its box with, when its background is an accent variable or a
   * solid amber; text in that box is set against it. */
  #fill(rule: Rule): string | null {
    let fill: string | null = null;
    rule.each((node) => {
      if (fill || node.type !== "decl" || !BACKGROUND.has(node.prop.toLowerCase())) return;
      const named = /var\(\s*--accent(-deep|-soft)?\s*\)/.exec(node.value);
      if (named) {
        fill = this.#tone(named[1]);
        return;
      }
      for (const token of node.value.match(COLOUR) ?? []) {
        const parsed = parseColour(token);
        if (parsed && isAmber(parsed.rgb) && parsed.alpha >= 0.6) {
          fill = toHex(replacement(parsed.rgb, this.tones));
          return;
        }
      }
    });
    return fill;
  }

  #declaration(declaration: Declaration, fill: string | null): void {
    const property = declaration.prop.toLowerCase();
    if (property === "font-family") {
      if (this.font) declaration.value = `"${FAMILY}", "Noto Sans TC", sans-serif`;
      return;
    }
    const text = TEXT.has(property);
    if (text && fill) {
      declaration.value = textOn(fill);
      return;
    }
    const value = text
      ? declaration.value.replace(ACCENT_VARS, (_, variant?: string) =>
          readable(this.#tone(variant), PALETTE.ink),
        )
      : declaration.value;
    declaration.value = value.replace(COLOUR, (token) => this.#token(token, text));
  }

  #rules(root: Root): Root {
    root.walkRules((rule) => {
      const fill = this.#fill(rule);
      rule.each((node) => {
        if (node.type === "decl") this.#declaration(node, fill);
      });
    });
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
.ff, .ff * { font-family: "${FAMILY}", "Noto Sans TC", sans-serif; }
`;
  }
}
