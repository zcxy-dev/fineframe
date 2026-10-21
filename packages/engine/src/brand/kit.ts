// Brand kits: a folder holding kit.json and the logo and font files it names (Q199). An edit copies
// a kit's files beside its project, named by their content, and puts the kit in the project's
// `brand`; the renderer reads them back from there, checked against their SHA-256, so an edit
// renders the same however the kit changes later.

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import type { BrandLook } from "@video-editor/effects";
import { rasterizeSvg, svgProblem } from "@video-editor/effects/logo";
import {
  type Brand,
  type BrandFile,
  type BrandFont,
  loadJson,
  type Project,
  SchemaError,
  validateBrand,
} from "@video-editor/schema";
import { FaceError, MAX_FONT_BYTES, type Metrics, readFace } from "../captions/fonts.ts";
import { cacheDir, type DownloadProgress, exists, pinnedFile } from "../download.ts";
import { FACES, type FaceId } from "./faces.ts";

export { MAX_FONT_BYTES };

/** The file in a kit folder that holds the kit. */
export const KIT_FILE = "kit.json";
/** The largest PNG logo, and its largest side in pixels. */
export const MAX_LOGO_BYTES = 10 * 1024 * 1024;
const MAX_LOGO_SIDE = 4096;

/** Why a kit, or a file in it, cannot be used. */
export class BrandError extends Error {
  override name = "BrandError";
}

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG's width and height, or why it is not one a watermark can use. */
export function pngSize(data: Buffer): { width: number; height: number } | string {
  if (data.length > MAX_LOGO_BYTES) return "it is larger than 10 MB";
  if (
    data.length < 33 ||
    !data.subarray(0, 8).equals(PNG) ||
    data.toString("latin1", 12, 16) !== "IHDR"
  ) {
    return "it is not a PNG image";
  }
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width < 1 || height < 1 || width > MAX_LOGO_SIDE || height > MAX_LOGO_SIDE) {
    return `it is ${width} × ${height} pixels; a logo is at most ${MAX_LOGO_SIDE} on each side`;
  }
  return { width, height };
}

/** What a logo file is: a PNG, an SVG, or neither, with why. */
export function logoKind(data: Buffer): "png" | "svg" | string {
  if (data.subarray(0, 8).equals(PNG)) {
    const size = pngSize(data);
    return typeof size === "string" ? size : "png";
  }
  const text = data.toString("utf8").replace(/^﻿/, "");
  if (!/^\s*</.test(text)) return "it is neither a PNG nor an SVG image";
  return svgProblem(text) ?? "svg";
}

/** Why a font file cannot be used, or null. */
export function fontProblem(data: Buffer): string | null {
  try {
    readFace(data);
    return null;
  } catch (error) {
    if (error instanceof FaceError) return error.message;
    throw error;
  }
}

/** The extension a font file is kept under, from what it holds. */
const fontExtension = (data: Buffer) =>
  data.toString("latin1", 0, 4) === "OTTO" ? ".otf" : ".ttf";

/** The files a kit names, each with what it is. */
function kitFiles(brand: Brand): { file: BrandFile; kind: "logo" | "font" }[] {
  const fonts = [brand.fonts?.graphics, brand.fonts?.captions].filter(
    (font): font is BrandFile => font !== undefined && "path" in font,
  );
  return [
    ...(brand.logo ? [{ file: brand.logo.file, kind: "logo" as const }] : []),
    ...fonts.map((file) => ({ file, kind: "font" as const })),
  ];
}

/** A kit file's path inside `folder`, refusing one that leads out of it. */
async function inside(folder: string, path: string): Promise<string> {
  const root = await realpath(folder);
  const full = await realpath(resolve(folder, path)).catch(() => {
    throw new BrandError(`${path}: no such file in the kit`);
  });
  if (!full.startsWith(root + sep)) throw new BrandError(`${path}: outside the kit's folder`);
  return full;
}

/** Reads a kit folder's kit.json and checks every file it names: each inside the folder, the
 * logo a PNG or a safe SVG, each font one that can be read. */
export async function loadKit(folder: string): Promise<Brand> {
  const file = join(folder, KIT_FILE);
  if (!(await exists(file))) throw new BrandError(`${folder}: no ${KIT_FILE} in it`);
  let brand: Brand;
  try {
    brand = await loadJson(file, validateBrand);
  } catch (error) {
    if (error instanceof SchemaError || error instanceof SyntaxError) {
      throw new BrandError(error.message);
    }
    throw error;
  }
  for (const { file: named, kind } of kitFiles(brand)) {
    const data = await readFile(await inside(folder, named.path));
    const problem = kind === "logo" ? logoKind(data) : fontProblem(data);
    if (problem && problem !== "png" && problem !== "svg") {
      throw new BrandError(`${named.path}: ${problem}`);
    }
    if (named.sha256 && named.sha256 !== sha256(data)) {
      throw new BrandError(`${named.path}: not the file kit.json names (its SHA-256 differs)`);
    }
  }
  return brand;
}

/**
 * Copies the files of `brand`, a kit whose paths are relative to `from`, into `into`, each named
 * by its content's hash, an SVG logo drawn to a PNG with `chrome` first, and returns the kit with
 * its paths relative to `base`, the project's folder, and their SHA-256 filled in.
 */
export async function stageBrand(
  brand: Brand,
  from: string,
  into: string,
  base: string,
  chrome: () => Promise<string>,
): Promise<Brand> {
  await mkdir(into, { recursive: true });
  const put = async (data: Buffer, extension: string): Promise<BrandFile> => {
    const hash = sha256(data);
    const path = join(into, `${hash.slice(0, 16)}${extension}`);
    if (!(await exists(path))) {
      const partial = `${path}.${process.pid}.partial`;
      await writeFile(partial, data);
      await rename(partial, path);
    }
    return { path: relative(base, path).split(sep).join("/"), sha256: hash };
  };
  const font = async (face: BrandFont | undefined) => {
    if (!face || "id" in face) return face;
    const data = await readFile(await inside(from, face.path));
    return put(data, fontExtension(data));
  };
  const staged: Brand = structuredClone(brand);
  if (brand.logo) {
    const data = await readFile(await inside(from, brand.logo.file.path));
    const kind = logoKind(data);
    const png =
      kind === "svg"
        ? await rasterizeSvg(data.toString("utf8").replace(/^﻿/, ""), await chrome())
        : data;
    (staged.logo as NonNullable<Brand["logo"]>).file = await put(png, ".png");
  }
  const graphics = await font(brand.fonts?.graphics);
  const captions = await font(brand.fonts?.captions);
  if (brand.fonts) {
    staged.fonts = {
      ...(graphics ? { graphics } : {}),
      ...(captions ? { captions } : {}),
    };
  }
  return staged;
}

/** A kit folder written from a project's `brand`, whose paths are relative to `base`: kit.json
 * and a copy of each file, as `--brand` takes it, so a plan made again keeps the edit's kit. */
export async function writeKit(brand: Brand, base: string, folder: string): Promise<void> {
  await mkdir(folder, { recursive: true });
  const kit = moveBrand(brand, (path) => basename(path));
  for (const { file } of kitFiles(brand)) {
    await copyFile(resolve(base, file.path), join(folder, basename(file.path)));
  }
  await writeFile(join(folder, KIT_FILE), `${JSON.stringify(kit, null, 2)}\n`);
}

/** The project in `brand`'s look, or the house look with null. The edit keeps its own caption
 * style, which the kit's custom captions draw over and which taking the kit off brings back. */
export function withBrand(project: Project, brand: Brand | null): Project {
  const { brand: _, ...rest } = project;
  return brand ? { ...rest, brand } : rest;
}

/** The kit with each of its files' paths changed by `move`, as when its project moves. */
export function moveBrand(brand: Brand, move: (path: string) => string): Brand {
  const moved: Brand = structuredClone(brand);
  for (const { file } of kitFiles(moved)) file.path = move(file.path);
  return moved;
}

/** The file of face `id`, downloaded and verified on first use; null for the house face. */
export async function faceFile(id: FaceId, onProgress?: DownloadProgress): Promise<string | null> {
  const { name, file } = FACES[id];
  if (!file) return null;
  const path = join(
    cacheDir(),
    "brand-fonts",
    `${file.sha256.slice(0, 12)}-${file.url.split("/").at(-1)}`,
  );
  return pinnedFile(file.url, file.sha256, path, name, 0o644, onProgress);
}

/** A caption face of a kit: the family libass selects it by, its file and its metrics. */
export interface BrandFace {
  family: string;
  path: string;
  metrics: Metrics;
}

/** What a render takes from a project's `brand`. */
export interface ResolvedBrand {
  brand: Brand;
  /** The colours and face of the graphics and templates. */
  look: BrandLook;
  /** The captions' face; null for the house face. */
  captions: BrandFace | null;
  /** The watermark: its PNG and size in pixels, and where and how it is drawn; null without one. */
  watermark:
    | (Pick<NonNullable<Brand["logo"]>, "corner" | "size" | "opacity"> & {
        path: string;
        width: number;
        height: number;
      })
    | null;
}

/** A file of the project's kit, read and checked against its SHA-256. */
async function brandFile(file: BrandFile, base: string): Promise<{ path: string; data: Buffer }> {
  const path = resolve(base, file.path);
  const data = await readFile(path).catch(() => {
    throw new BrandError(`The brand kit's file ${file.path} is missing`);
  });
  if (file.sha256 && sha256(data) !== file.sha256) {
    throw new BrandError(`The brand kit's file ${file.path} has changed since the edit was made`);
  }
  return { path, data };
}

/** Reads the files of a project's `brand`, whose paths are relative to `base`, for a render:
 * each checked, the bundled faces downloaded on first use. */
export async function resolveBrand(
  brand: Brand,
  base: string,
  onDownload?: (name: string, bytes: number, total: number) => void,
): Promise<ResolvedBrand> {
  const face = async (font: BrandFont | undefined) => {
    if (!font) return null;
    if ("id" in font) {
      const path = await faceFile(font.id, onDownload && ((b, t) => onDownload(font.id, b, t)));
      return path ? { path, data: await readFile(path) } : null;
    }
    return brandFile(font, base);
  };
  const graphics = await face(brand.fonts?.graphics);
  const captions = await face(brand.fonts?.captions);
  let watermark: ResolvedBrand["watermark"] = null;
  if (brand.logo?.show) {
    const { path, data } = await brandFile(brand.logo.file, base);
    const size = pngSize(data);
    if (typeof size === "string") throw new BrandError(`The brand kit's logo: ${size}`);
    const { corner, opacity } = brand.logo;
    watermark = { path, ...size, corner, size: brand.logo.size, opacity };
  }
  const read = (file: { path: string; data: Buffer }): BrandFace => {
    try {
      return { path: file.path, ...readFace(file.data) };
    } catch (error) {
      if (error instanceof FaceError)
        throw new BrandError(`${basename(file.path)}: ${error.message}`);
      throw error;
    }
  };
  return {
    brand,
    look: {
      colors: brand.colors,
      ...(graphics ? { font: { path: graphics.path, sha256: sha256(graphics.data) } } : {}),
    },
    captions: captions ? read(captions) : null,
    watermark,
  };
}
