// The brand kits the page keeps (Q190, Q191, Q198): each a folder of kit.json with its logo and
// fonts, as `pnpm edit --brand` takes it, in the app's folder (VIDEO_EDITOR_BRAND_KITS) or, run
// from a clone, beside the jobs in the engine's cache. One may be the default, which the start
// settings pick unless another is chosen. Nothing leaves this computer.
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  BrandError,
  fontProblem,
  KIT_FILE,
  loadKit,
  logoKind,
  MAX_FONT_BYTES,
  MAX_LOGO_BYTES,
} from "@video-editor/engine/brand";
import { cacheDir } from "@video-editor/engine/download";
import type { Brand, BrandFont } from "@video-editor/schema";
import { JobError } from "./jobs.ts";
import { fileTitle } from "./paths.ts";

export { MAX_FONT_BYTES, MAX_LOGO_BYTES };

export interface Kit {
  id: string;
  brand: Brand;
}

const DEFAULT_FILE = "default.json";
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Where the kits are kept: VIDEO_EDITOR_BRAND_KITS, as the desktop app sets it, or else
 * `brand-kits` in the engine's cache. */
function kitsRoot(): string {
  return process.env.VIDEO_EDITOR_BRAND_KITS ?? join(cacheDir(), "brand-kits");
}

/** A kit's folder, for `pnpm edit --brand`; a 404 for an id that is not one. */
export function kitFolder(id: string): string {
  if (!ID.test(id)) throw new JobError((t) => t.server.noKit, 404);
  return join(kitsRoot(), id);
}

/** Writes `text` to `path` whole: beside it, then renamed into place. */
async function writeWhole(path: string, text: string | Buffer): Promise<void> {
  await writeFile(`${path}.tmp`, text);
  await rename(`${path}.tmp`, path);
}

/** A kit as kit.json holds it, checked as `pnpm edit --brand` checks it. */
export async function readKit(id: string): Promise<Kit> {
  const folder = kitFolder(id);
  try {
    return { id, brand: await loadKit(folder) };
  } catch (error) {
    if (error instanceof BrandError) throw new JobError((t) => t.server.noKit, 404);
    throw error;
  }
}

/** Every kit, by name, and the default's id. */
export async function listKits(): Promise<{ kits: Kit[]; default: string | null }> {
  const names = await readdir(kitsRoot()).catch(() => []);
  // A kit changed by hand so that it no longer passes is left out, as `--brand` would refuse it.
  const found = (
    await Promise.all(
      names.filter((each) => ID.test(each)).map((name) => readKit(name).catch(() => null)),
    )
  ).filter((kit): kit is Kit => kit !== null);
  found.sort((a, b) => a.brand.name.localeCompare(b.brand.name));
  const chosen = await readFile(join(kitsRoot(), DEFAULT_FILE), "utf8")
    .then((text) => (JSON.parse(text) as { id?: unknown }).id)
    .catch(() => null);
  const fallback = found.some((kit) => kit.id === chosen) ? (chosen as string) : null;
  return { kits: found, default: fallback };
}

/** A new kit in the house colours, with no logo, fonts or custom captions. */
export async function createKit(name: string): Promise<Kit> {
  const id = randomUUID();
  const brand: Brand = { name: nameOf(name), colors: { primary: "#ffb547" } };
  await mkdir(kitFolder(id), { recursive: true });
  await writeWhole(join(kitFolder(id), KIT_FILE), `${JSON.stringify(brand, null, 2)}\n`);
  return { id, brand };
}

function nameOf(value: unknown): string {
  const name = typeof value === "string" ? value.trim().slice(0, 60) : "";
  if (!name) throw new JobError((t) => t.server.kitName, 400);
  return name;
}

/**
 * Saves what the page changed of a kit: its name, colours, fonts, logo settings and custom
 * captions. Its files stay the ones uploaded; a font left unused is deleted. Checked as
 * `pnpm edit --brand` checks a kit before it is kept.
 */
export async function saveKit(id: string, value: unknown): Promise<Kit> {
  const { brand: before } = await readKit(id);
  const asked = (value ?? {}) as Partial<Brand>;
  const files = new Set([...(before.logo ? [before.logo.file.path] : []), ...fontPaths(before)]);
  const ownFile = (path: unknown) => typeof path === "string" && files.has(path);
  // A file the kit does not hold is never named: the page names its own uploads only.
  const font = (face: BrandFont | undefined) =>
    face && "path" in face ? (ownFile(face.path) ? { path: face.path } : undefined) : face;
  const brand: Brand = {
    name: nameOf(asked.name),
    colors: asked.colors as Brand["colors"],
    ...(asked.fonts
      ? {
          fonts: Object.fromEntries(
            (["graphics", "captions"] as const).flatMap((use) => {
              const face = font(asked.fonts?.[use]);
              return face ? [[use, face]] : [];
            }),
          ),
        }
      : {}),
    ...(before.logo && asked.logo
      ? { logo: { ...asked.logo, file: { path: before.logo.file.path } } }
      : {}),
    ...(asked.captions ? { captions: asked.captions } : {}),
  };
  await writeChecked(id, brand);
  for (const path of fontPaths(before)) {
    if (!fontPaths(brand).includes(path)) await rm(join(kitFolder(id), path), { force: true });
  }
  return { id, brand };
}

const fontPaths = (brand: Brand) =>
  [brand.fonts?.graphics, brand.fonts?.captions].flatMap((face) =>
    face && "path" in face ? [face.path] : [],
  );

/** Writes kit.json, keeping the one before when the new one does not pass the kit's checks. */
async function writeChecked(id: string, brand: Brand): Promise<void> {
  const path = join(kitFolder(id), KIT_FILE);
  const before = await readFile(path, "utf8");
  await writeWhole(path, `${JSON.stringify(brand, null, 2)}\n`);
  try {
    await loadKit(kitFolder(id));
  } catch (error) {
    await writeWhole(path, before);
    if (error instanceof BrandError) throw new JobError(error.message, 400);
    throw error;
  }
}

/** Takes an uploaded logo, a PNG or an SVG, in place of the kit's; the watermark keeps its
 * settings, and a kit's first logo starts hidden (Q192). */
export async function putLogo(id: string, data: Buffer): Promise<Kit> {
  const { brand } = await readKit(id);
  const kind = logoKind(data);
  if (kind !== "png" && kind !== "svg") {
    throw new JobError((t) => t.server.badLogo(kind), 400);
  }
  const name = `logo.${kind}`;
  await writeWhole(join(kitFolder(id), name), data);
  const old = brand.logo?.file.path;
  const logo = brand.logo
    ? { ...brand.logo, file: { path: name } }
    : {
        file: { path: name },
        show: false,
        corner: "top-right" as const,
        size: 0.12,
        opacity: 0.85,
      };
  await writeChecked(id, { ...brand, logo });
  if (old && old !== name) await rm(join(kitFolder(id), old), { force: true });
  return { id, brand: { ...brand, logo } };
}

/** Takes the kit's logo out. */
export async function removeLogo(id: string): Promise<Kit> {
  const { brand } = await readKit(id);
  const { logo, ...rest } = brand;
  await writeChecked(id, rest);
  if (logo) await rm(join(kitFolder(id), logo.file.path), { force: true });
  return { id, brand: rest };
}

/** Takes an uploaded TrueType or OpenType font as the kit's face for `use`, under its own name
 * made safe as a file name. */
export async function putFont(
  id: string,
  use: "graphics" | "captions",
  name: string,
  data: Buffer,
): Promise<Kit> {
  const { brand } = await readKit(id);
  const problem = fontProblem(data);
  if (problem) throw new JobError((t) => t.server.badFont(problem), 400);
  const extension = data.toString("latin1", 0, 4) === "OTTO" ? "otf" : "ttf";
  const stem = fileTitle(name.replace(/\.(ttf|otf)$/i, ""));
  const path = `fonts/${stem}.${extension}`;
  await mkdir(join(kitFolder(id), "fonts"), { recursive: true });
  await writeWhole(join(kitFolder(id), path), data);
  return saveKit(id, { ...brand, fonts: { ...brand.fonts, [use]: { path } } });
}

/** Deletes a kit and its files; the default goes with it. */
export async function removeKit(id: string): Promise<void> {
  await rm(kitFolder(id), { recursive: true, force: true });
}

/** Makes a kit the default the start settings pick, or none. */
export async function setDefault(id: string | null): Promise<void> {
  if (id !== null) await readKit(id);
  await mkdir(kitsRoot(), { recursive: true });
  await writeWhole(join(kitsRoot(), DEFAULT_FILE), JSON.stringify({ id }));
}

/** A kit's logo or font for the page's preview, with its type. */
export async function kitFile(
  id: string,
  which: "logo" | "graphics" | "captions",
): Promise<{ path: string; type: string } | null> {
  const { brand } = await readKit(id);
  if (which === "logo") {
    if (!brand.logo) return null;
    const path = brand.logo.file.path;
    return {
      path: join(kitFolder(id), path),
      type: path.endsWith(".svg") ? "image/svg+xml" : "image/png",
    };
  }
  const face = brand.fonts?.[which];
  if (!face || !("path" in face)) return null;
  return {
    path: join(kitFolder(id), face.path),
    type: face.path.endsWith(".otf") ? "font/otf" : "font/ttf",
  };
}
