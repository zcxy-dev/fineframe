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
    loaded = readFile(path).then((font) => readFace(font).metrics);
    cache.set(path, loaded);
  }
  return loaded;
}

/** The largest face file read: a full CJK face is about 30 MB. */
export const MAX_FONT_BYTES = 64 * 1024 * 1024;
const REQUIRED = ["cmap", "head", "hhea", "hmtx", "OS/2", "name", "maxp"];

/**
 * A TrueType or OpenType face's family name, the one libass selects it by, and its metrics, or a
 * FaceError saying why it cannot be used. It reads only the tables it needs, each checked to lie
 * inside the file, so a file someone uploaded is read without trusting its offsets.
 */
export function readFace(font: Buffer): { family: string; metrics: Metrics } {
  if (font.length > MAX_FONT_BYTES) throw new FaceError("it is larger than 64 MB");
  if (font.length < 12) throw new FaceError("it is not a font");
  const version = font.readUInt32BE(0);
  // 1.0 and "true" outline TrueType, "OTTO" CFF; collections and web fonts are not read.
  if (version !== 0x00010000 && version !== 0x74727565 && version !== 0x4f54544f) {
    throw new FaceError("it is not a TrueType or OpenType font (.ttf or .otf)");
  }
  const count = font.readUInt16BE(4);
  if (count === 0 || count > 200 || 12 + 16 * count > font.length) {
    throw new FaceError("its table directory is damaged");
  }
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < count; i++) {
    const record = 12 + 16 * i;
    const offset = font.readUInt32BE(record + 8);
    const length = font.readUInt32BE(record + 12);
    if (offset + length > font.length) throw new FaceError("a table runs past its end");
    tables.set(font.toString("latin1", record, record + 4), { offset, length });
  }
  const missing = REQUIRED.filter((tag) => !tables.has(tag));
  if (missing.length > 0) throw new FaceError(`it has no ${missing.join(", ")} table`);
  // Every read below is inside the file, or Buffer throws a RangeError: the file is damaged.
  try {
    const parsed = {
      family: familyName(font, tables.get("name")?.offset as number),
      metrics: parseMetrics(font, tables),
    };
    if (!parsed.family) throw new FaceError("it has no family name");
    // The family goes into the ASS script, where these would end its field or a tag.
    if (/[,{}\\\p{Cc}]/u.test(parsed.family)) {
      throw new FaceError(`its family name ${JSON.stringify(parsed.family)} cannot be used`);
    }
    const draws = [..."A中"].some((char) => parsed.metrics.advance(char.codePointAt(0) as number));
    if (!draws) throw new FaceError("it has neither Latin letters nor Chinese characters");
    return parsed;
  } catch (error) {
    if (error instanceof RangeError) throw new FaceError("its tables are damaged");
    throw error;
  }
}

/** Why a face file cannot be used. */
export class FaceError extends Error {
  override name = "FaceError";
}

/** The family name in a name table: Windows English, else any Windows one, else Macintosh. */
function familyName(font: Buffer, name: number): string {
  const count = font.readUInt16BE(name + 2);
  const strings = name + font.readUInt16BE(name + 4);
  let found: { rank: number; text: string } | null = null;
  for (let i = 0; i < count; i++) {
    const record = name + 6 + 12 * i;
    const [platform, encoding, language, id, length, offset] = [0, 2, 4, 6, 8, 10].map((at) =>
      font.readUInt16BE(record + at),
    ) as [number, number, number, number, number, number];
    if (id !== 1) continue;
    const start = strings + offset;
    const bytes = font.subarray(start, start + length);
    if (bytes.length !== length) throw new RangeError("name");
    const windows = platform === 3 && (encoding === 1 || encoding === 0 || encoding === 10);
    const rank = windows ? (language === 0x409 ? 0 : 1) : platform === 1 && encoding === 0 ? 2 : -1;
    if (rank < 0 || (found && found.rank <= rank)) continue;
    // UTF-16 big-endian, swapped in a copy to Node's little-endian.
    const text = windows
      ? Buffer.from(bytes).swap16().toString("utf16le")
      : bytes.toString("latin1");
    found = { rank, text: text.trim() };
  }
  return found?.text ?? "";
}

/** Reads head, hhea, hmtx, OS/2 and a format 12 or 4 Unicode cmap of an OpenType font. */
function parseMetrics(font: Buffer, tables: Map<string, { offset: number }>): Metrics {
  const table = (tag: string) => tables.get(tag)?.offset as number;
  const units = font.readUInt16BE(table("head") + 18);
  if (units < 16 || units > 16384) throw new FaceError("its units per em are out of range");
  const hmetrics = font.readUInt16BE(table("hhea") + 34);
  if (hmetrics === 0) throw new FaceError("it has no glyph widths");
  const hmtx = table("hmtx");
  const os2 = table("OS/2");
  const winAscent = font.readUInt16BE(os2 + 74);
  const winDescent = font.readUInt16BE(os2 + 76);
  const glyph = cmapLookup(font, table("cmap"));
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

/** A code point's glyph by the cmap's Unicode subtable: format 12, which maps every plane, or
 * else format 4, the Basic Multilingual Plane's. */
function cmapLookup(font: Buffer, cmap: number): (codePoint: number) => number | undefined {
  const subtables: number[] = [];
  for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
    const record = cmap + 4 + 8 * i;
    const platform = font.readUInt16BE(record);
    const encoding = font.readUInt16BE(record + 2);
    if (platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10))) {
      subtables.push(cmap + font.readUInt32BE(record + 4));
    }
  }
  const twelve = subtables.find((at) => font.readUInt16BE(at) === 12);
  if (twelve !== undefined) {
    const count = font.readUInt32BE(twelve + 12);
    if (twelve + 16 + 12 * count > font.length) throw new RangeError("cmap");
    return (codePoint) => {
      let low = 0;
      let high = count - 1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        const group = twelve + 16 + 12 * middle;
        if (codePoint < font.readUInt32BE(group)) high = middle - 1;
        else if (codePoint > font.readUInt32BE(group + 4)) low = middle + 1;
        else return font.readUInt32BE(group + 8) + codePoint - font.readUInt32BE(group);
      }
      return undefined;
    };
  }
  const four = subtables.find((at) => font.readUInt16BE(at) === 4);
  if (four === undefined) throw new FaceError("it has no Unicode character map");
  const segments = font.readUInt16BE(four + 6) / 2;
  const ends = four + 14;
  const starts = ends + 2 * segments + 2;
  const deltas = starts + 2 * segments;
  const ranges = deltas + 2 * segments;
  if (ranges + 2 * segments > font.length) throw new RangeError("cmap");
  return (codePoint) => {
    if (codePoint > 0xffff) return undefined;
    let low = 0;
    let high = segments - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (codePoint > font.readUInt16BE(ends + 2 * middle)) low = middle + 1;
      else if (middle > 0 && codePoint <= font.readUInt16BE(ends + 2 * (middle - 1)))
        high = middle - 1;
      else {
        const start = font.readUInt16BE(starts + 2 * middle);
        if (codePoint < start) return undefined;
        const delta = font.readUInt16BE(deltas + 2 * middle);
        const range = font.readUInt16BE(ranges + 2 * middle);
        if (range === 0) return (codePoint + delta) & 0xffff;
        const id = font.readUInt16BE(ranges + 2 * middle + range + 2 * (codePoint - start));
        return id === 0 ? 0 : (id + delta) & 0xffff;
      }
    }
    return undefined;
  };
}
