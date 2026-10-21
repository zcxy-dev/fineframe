// Caption emoji: Noto Color Emoji (SIL Open Font License 1.1), downloaded on first use and
// checked against its SHA-256, as the caption faces are. libass draws no colour glyphs, so each
// emoji is the PNG the font's CBDT table holds for it, laid over the picture by the encoder.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cacheDir, exists, pinnedFile, removeOtherPins } from "../download.ts";
import { cmapLookup } from "./fonts.ts";

// Release v2.051.
const COMMIT = "8998f5dd683424a73e2314a8c1f1e359c19e8742";
const SOURCE = `https://raw.githubusercontent.com/googlefonts/noto-emoji/${COMMIT}/fonts/NotoColorEmoji.ttf`;
const SHA256 = "72a635cb3d2f3524c51620cdde406b217204e8a6a06c6a096ff8ed4b5fd6e27b";

/** An emoji's bitmap as the font draws it: a PNG of `width` × `height` pixels at `ppem` pixels
 * to the em, its top-left corner `left` right of the pen and `top` above the baseline. */
export interface EmojiImage {
  png: Buffer;
  width: number;
  height: number;
  left: number;
  top: number;
  ppem: number;
}

/** The emoji font, downloaded and verified on first use. */
async function emojiFont(): Promise<string> {
  const path = join(cacheDir(), `emoji-${COMMIT.slice(0, 12)}`, "NotoColorEmoji.ttf");
  if (await exists(path)) return path;
  await pinnedFile(SOURCE, SHA256, path, "Noto Color Emoji");
  await removeOtherPins(dirname(path), "emoji-");
  return path;
}

let loaded: Promise<(emoji: string) => EmojiImage | undefined> | undefined;

/** The pinned font's image of an emoji, or undefined when it has none. */
export function emojiImage(emoji: string): Promise<EmojiImage | undefined> {
  loaded ??= emojiFont()
    .then((path) => readFile(path))
    .then(readImages);
  return loaded.then((image) => image(emoji));
}

/**
 * Reads the images of a CBDT colour font: the cmap, and the strike in CBLC indexed by index
 * format 1 with image format 17 (small metrics and a PNG), as Noto Color Emoji is built. An
 * emoji is one code point, with or without the emoji presentation selector U+FE0F.
 */
function readImages(font: Buffer): (emoji: string) => EmojiImage | undefined {
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    const record = 12 + 16 * i;
    tables.set(font.toString("latin1", record, record + 4), {
      offset: font.readUInt32BE(record + 8),
      length: font.readUInt32BE(record + 12),
    });
  }
  const cmap = tables.get("cmap");
  const cblc = tables.get("CBLC")?.offset;
  const cbdt = tables.get("CBDT")?.offset;
  if (!cmap || cblc === undefined || cbdt === undefined) {
    throw new Error("The emoji font has no colour bitmaps");
  }
  const glyph = cmapLookup(font, cmap.offset, cmap);
  // The first strike: Noto Color Emoji has one, at 109 pixels to the em.
  const size = cblc + 8;
  const array = cblc + font.readUInt32BE(size);
  const subtables = font.readUInt32BE(size + 8);
  const ppem = font.readUInt8(size + 45);
  return (emoji) => {
    const points = [...emoji.replace(/️$/u, "")];
    if (points.length !== 1) return undefined;
    const id = glyph((points[0] as string).codePointAt(0) as number);
    if (!id) return undefined;
    for (let i = 0; i < subtables; i++) {
      const entry = array + 8 * i;
      const first = font.readUInt16BE(entry);
      if (id < first || id > font.readUInt16BE(entry + 2)) continue;
      const header = array + font.readUInt32BE(entry + 4);
      if (font.readUInt16BE(header) !== 1 || font.readUInt16BE(header + 2) !== 17) return undefined;
      const data = cbdt + font.readUInt32BE(header + 4);
      const at = data + font.readUInt32BE(header + 8 + 4 * (id - first));
      const length = font.readUInt32BE(at + 5);
      if (length === 0) return undefined;
      return {
        png: font.subarray(at + 9, at + 9 + length),
        height: font.readUInt8(at),
        width: font.readUInt8(at + 1),
        left: font.readInt8(at + 2),
        top: font.readInt8(at + 3),
        ppem,
      };
    }
    return undefined;
  };
}
