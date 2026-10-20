// The caption typeface: Noto Sans CJK TC (SIL Open Font License 1.1), downloaded on first use
// and checked against its SHA-256, as the FFmpeg build is. The full CJK font, not the 6 MB
// "Noto Sans TC" subset: the subset lacks a quarter of the unified ideographs (靐, 𠮷 among
// them), and a caption must never fall back to whatever the machine has or draw a box.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cacheDir, exists, pinnedFile, removeOtherPins } from "../download.ts";

const COMMIT = "f8d157532fbfaeda587e826d4cd5b21a49186f7c";
const SOURCE = `https://raw.githubusercontent.com/notofonts/noto-cjk/${COMMIT}/Sans/OTF/TraditionalChinese`;
// libass reads a style's Bold as on or off and asks for weight 700 either way, and it names a
// face it loads from a file by the file's own family name. So each weight is selected by that
// name: the Black file's is "Noto Sans CJK TC Black".
const FACES = {
  700: { family: "Noto Sans CJK TC", file: "NotoSansCJKtc-Bold.otf", sha256: "3ee160e5015106e3ec1a394301df54fa9bbbf8a251519984aec5c0abc50840c0" },
  900: { family: "Noto Sans CJK TC Black", file: "NotoSansCJKtc-Black.otf", sha256: "8d0b82a379fac186ea5ec7ebf00828a5e58c32b3a5a917298f768299707d076d" },
} as const; // biome-ignore format: one face per line

export type Weight = keyof typeof FACES;

/** The family name an ASS style selects the face of `weight` by, with Bold on. */
export function family(weight: Weight): string {
  return FACES[weight].family;
}

/** The face of `weight`, downloaded and verified on first use. */
export async function fontFile(weight: Weight): Promise<string> {
  const { family, file, sha256 } = FACES[weight];
  const path = join(cacheDir(), `fonts-${COMMIT.slice(0, 12)}`, file);
  if (await exists(path)) return path;
  await pinnedFile(`${SOURCE}/${file}`, sha256, path, family);
  await removeOtherPins(dirname(path), "fonts-");
  return path;
}

/** What layout needs from a face, in ems: the advance of each character and where libass puts
 * the line and the ideographic em box. */
export interface Metrics {
  /** The advance of a code point in ems, or undefined when the face has no glyph for it. */
  advance(codePoint: number): number | undefined;
  /** libass makes the font size the height of winAscent + winDescent, as VSFilter does, so
   * an em is `size / lineHeight` pixels. */
  lineHeight: number;
  /** libass's line box: from its top down to the baseline, and on below it. */
  ascent: number;
  descent: number;
  /** The ideographic em box above and below the baseline, which CJK glyphs fill. */
  emTop: number;
  emBottom: number;
}

const cache = new Map<string, Promise<Metrics>>();

/** The metrics of a face file, read once. */
export function metrics(path: string): Promise<Metrics> {
  let loaded = cache.get(path);
  if (!loaded) {
    loaded = readFile(path).then(parseMetrics);
    cache.set(path, loaded);
  }
  return loaded;
}

/** Reads head, hhea, hmtx, OS/2 and the format 12 cmap of an OpenType font. */
function parseMetrics(font: Buffer): Metrics {
  const tables = new Map<string, number>();
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    const record = 12 + 16 * i;
    tables.set(font.toString("latin1", record, record + 4), font.readUInt32BE(record + 8));
  }
  const table = (tag: string) => {
    const offset = tables.get(tag);
    if (offset === undefined) throw new Error(`The font has no ${tag} table`);
    return offset;
  };
  const units = font.readUInt16BE(table("head") + 18);
  const hmetrics = font.readUInt16BE(table("hhea") + 34);
  const hmtx = table("hmtx");
  const os2 = table("OS/2");
  const winAscent = font.readUInt16BE(os2 + 74);
  const winDescent = font.readUInt16BE(os2 + 76);

  // Format 12 maps every code point, supplementary planes included, in sorted groups.
  const cmap = table("cmap");
  let groups = -1;
  for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
    const subtable = cmap + font.readUInt32BE(cmap + 4 + 8 * i + 4);
    if (font.readUInt16BE(subtable) === 12) {
      groups = subtable;
      break;
    }
  }
  if (groups < 0) throw new Error("The font has no format 12 cmap");
  const count = font.readUInt32BE(groups + 12);
  const glyph = (codePoint: number): number | undefined => {
    let low = 0;
    let high = count - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const group = groups + 16 + 12 * middle;
      if (codePoint < font.readUInt32BE(group)) high = middle - 1;
      else if (codePoint > font.readUInt32BE(group + 4)) low = middle + 1;
      else return font.readUInt32BE(group + 8) + codePoint - font.readUInt32BE(group);
    }
    return undefined;
  };
  return {
    advance(codePoint) {
      const id = glyph(codePoint);
      if (id === undefined || id === 0) return undefined;
      // Glyphs past the last full metric share its advance.
      return font.readUInt16BE(hmtx + 4 * Math.min(id, hmetrics - 1)) / units;
    },
    lineHeight: (winAscent + winDescent) / units,
    ascent: font.readInt16BE(table("hhea") + 4) / units,
    descent: -font.readInt16BE(table("hhea") + 6) / units,
    emTop: font.readInt16BE(os2 + 68) / units,
    emBottom: -font.readInt16BE(os2 + 70) / units,
  };
}
