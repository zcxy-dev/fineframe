// Icons and logos as SVG, looked up by name from three open sets: Lucide (ISC, some icons MIT),
// Tabler (MIT) and Simple Icons (CC0, a few logos under their own licence). Each set is its npm
// package's tarball, pinned by version and SHA-256, downloaded on the first lookup and kept in
// the cache with only its SVGs, names and licences.
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";
import { cacheDir, pinnedFile } from "../download.ts";
import type { Credit } from "./credits.ts";

export type IconSet = "lucide" | "tabler" | "simple-icons";

export interface Icon {
  set: IconSet;
  name: string;
  /** The brand's colour, for a logo. */
  hex: string | null;
  /** The SVG, a logo filled with its brand's colour, a symbol drawn in `currentColor`. */
  svg: string;
  credit: Credit;
}

export interface IconOptions {
  /** `logo` looks only for a brand's logo, `symbol` only for a symbol; `any` tries both, as `findIcon` says. */
  kind?: "logo" | "symbol" | "any";
  /** Where the sets are kept: `<cache>/broll/icons` unless given. */
  dir?: string;
}

interface Pinned {
  url: string;
  sha256: string;
  /** The tarball's paths to keep, under `package/`. */
  keep: RegExp;
}

/** Each set's npm tarball. */
export const ICON_SETS: Record<IconSet, Pinned & { version: string }> = {
  lucide: {
    version: "1.50.0",
    url: "https://registry.npmjs.org/lucide-static/-/lucide-static-1.50.0.tgz",
    sha256: "b23b1b4c30dbf0877eee2087275f48310b45a098e537ba83598cce1ea553dce6",
    keep: /^package\/(icons\/[\w-]+\.svg|tags\.json|LICENSE)$/,
  },
  tabler: {
    version: "3.48.0",
    url: "https://registry.npmjs.org/@tabler/icons/-/icons-3.48.0.tgz",
    sha256: "28447dcf6f0bb2b8d92c59a1b3d30900a180de2e97d7db4d267e6320dc68f449",
    keep: /^package\/(icons\/outline\/[\w-]+\.svg|icons\.json|LICENSE)$/,
  },
  "simple-icons": {
    version: "16.33.0",
    url: "https://registry.npmjs.org/simple-icons/-/simple-icons-16.33.0.tgz",
    sha256: "11e1ab7c25fd0acbf0014c4a88745c33fe0f87341e6d94c7ba1e62334b2d2375",
    keep: /^package\/(icons\/[\w-]+\.svg|data\/simple-icons\.json|LICENSE\.md|DISCLAIMER\.md)$/,
  },
};

/** The icon or logo `query` names, such as "GitHub", "rocket" or "shopping cart"; null when no
 * set has one. A symbol named exactly so comes before a brand of that name, so "rocket" is the
 * symbol; then the brand; then a symbol whose name starts with it; then the symbol tagged with
 * it most plainly: earliest in its tags, then shortest. Lucide comes before Tabler. */
export async function findIcon(query: string, options: IconOptions = {}): Promise<Icon | null> {
  const kind = options.kind ?? "any";
  const dir = options.dir ?? join(cacheDir(), "broll", "icons");
  if (kind === "logo") return findLogo(query, dir);
  const name = kebab(query);
  const all = (await Promise.all([symbols("lucide", dir), symbols("tabler", dir)])).flat();
  const exact = name ? all.find((icon) => icon.name === name) : undefined;
  if (exact) return symbolIcon(exact, dir);
  if (kind === "any") {
    const logo = await findLogo(query, dir);
    if (logo) return logo;
  }
  if (!name) return null;
  const prefixed = all.find((icon) => icon.name.startsWith(`${name}-`));
  if (prefixed) return symbolIcon(prefixed, dir);
  const tag = name.replaceAll("-", " ");
  const tagged = all
    .filter((icon) => icon.tags.includes(tag))
    .sort((a, b) => a.tags.indexOf(tag) - b.tags.indexOf(tag) || a.name.length - b.name.length);
  return tagged[0] ? symbolIcon(tagged[0], dir) : null;
}

interface Glyph {
  set: "lucide" | "tabler";
  name: string;
  tags: string[];
  license: "ISC" | "MIT";
}

interface Brand {
  title: string;
  slug: string;
  hex: string;
  source: string;
  guidelines?: string;
  license?: { type: string; url?: string };
  aliases?: { aka?: string[]; dup?: { title: string }[]; loc?: Record<string, string> };
}

const loaded = new Map<string, Promise<unknown>>();

function once<T>(key: string, load: () => Promise<T>): Promise<T> {
  let value = loaded.get(key) as Promise<T> | undefined;
  if (!value) {
    value = load();
    loaded.set(key, value);
    value.catch(() => loaded.delete(key));
  }
  return value;
}

/** A set's names, tags and licences. */
function symbols(set: "lucide" | "tabler", dir: string): Promise<Glyph[]> {
  return once(`${dir}:${set}`, async () => {
    const root = await unpacked(set, dir);
    if (set === "lucide") {
      const tags = JSON.parse(await readFile(join(root, "tags.json"), "utf8")) as Record<
        string,
        string[]
      >;
      // The license file lists the icons drawn from Feather, which stay MIT.
      const notice = await readFile(join(root, "LICENSE"), "utf8");
      const listed = /derived from the Feather project:\s*\n([^\n]+)/.exec(notice)?.[1] ?? "";
      const feather = new Set(listed.split(",").map((name) => name.trim()));
      const names = (await readdir(join(root, "icons"))).map((file) => file.replace(/\.svg$/, ""));
      return names.map((name) => ({
        set,
        name,
        tags: (tags[name] ?? []).map((tag) => String(tag).toLowerCase()),
        license: feather.has(name) ? "MIT" : "ISC",
      }));
    }
    const icons = JSON.parse(await readFile(join(root, "icons.json"), "utf8")) as Record<
      string,
      { tags?: unknown[]; styles?: { outline?: unknown } }
    >;
    return Object.entries(icons)
      .filter(([, icon]) => icon.styles?.outline)
      .map(([name, icon]) => ({
        set,
        name,
        tags: (icon.tags ?? []).map((tag) => String(tag).toLowerCase()),
        license: "MIT",
      }));
  });
}

async function symbolIcon(icon: Glyph, dir: string): Promise<Icon> {
  const root = await unpacked(icon.set, dir);
  const file = icon.set === "lucide" ? `icons/${icon.name}.svg` : `icons/outline/${icon.name}.svg`;
  const svg = (await readFile(join(root, file), "utf8")).replace(/<!--[\s\S]*?-->\s*/g, "").trim();
  const lucide = icon.set === "lucide";
  // Lucide's licence lists the icons drawn from Feather by their old names; an icon renamed
  // since is the same drawing under its new name, and MIT too.
  const license =
    lucide && icon.license === "ISC" && (await featherDrawings(dir)).has(drawing(svg))
      ? "MIT"
      : icon.license;
  return {
    set: icon.set,
    name: icon.name,
    hex: null,
    svg,
    credit: {
      what: `${lucide ? "Lucide" : "Tabler"} icon "${icon.name}"`,
      source: lucide
        ? `https://lucide.dev/icons/${icon.name}`
        : `https://tabler.io/icons/icon/${icon.name}`,
      license: {
        name: license,
        url: lucide
          ? "https://github.com/lucide-icons/lucide/blob/main/LICENSE"
          : "https://github.com/tabler/tabler-icons/blob/main/LICENSE",
      },
      by: null,
      ...(icon.name.startsWith("brand-")
        ? { note: "A brand's logo is a trademark of its owner: show it only to refer to them." }
        : {}),
    },
  };
}

/** The drawings of the Lucide icons its licence lists as drawn from Feather. */
function featherDrawings(dir: string): Promise<Set<string>> {
  return once(`${dir}:feather`, async () => {
    const root = await unpacked("lucide", dir);
    const listed = (await symbols("lucide", dir)).filter((icon) => icon.license === "MIT");
    const svgs = await Promise.all(
      listed.map((icon) => readFile(join(root, "icons", `${icon.name}.svg`), "utf8")),
    );
    return new Set(svgs.map(drawing));
  });
}

/** An SVG's shapes alone, without its comments, classes or spacing. */
function drawing(svg: string): string {
  return svg
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\sclass="[^"]*"/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A brand's logo by its name, its slug or one of its other names. */
async function findLogo(query: string, dir: string): Promise<Icon | null> {
  const wanted = squash(query);
  if (!wanted) return null;
  const brands = await once(`${dir}:simple-icons`, async () => {
    const root = await unpacked("simple-icons", dir);
    return JSON.parse(await readFile(join(root, "data", "simple-icons.json"), "utf8")) as Brand[];
  });
  const brand =
    brands.find((b) => b.slug === wanted || squash(b.title) === wanted) ??
    brands.find((b) =>
      [
        ...(b.aliases?.aka ?? []),
        ...(b.aliases?.dup ?? []).map((dup) => dup.title),
        ...Object.values(b.aliases?.loc ?? {}),
      ].some((name) => squash(name) === wanted),
    );
  if (!brand) return null;
  const root = await unpacked("simple-icons", dir);
  const svg = (await readFile(join(root, "icons", `${brand.slug}.svg`), "utf8"))
    .trim()
    .replace("<svg ", `<svg fill="#${brand.hex}" `);
  const type = brand.license?.type ?? "CC0-1.0";
  return {
    set: "simple-icons",
    name: brand.slug,
    hex: `#${brand.hex}`,
    svg,
    credit: {
      what: `${brand.title} logo, from Simple Icons`,
      source: brand.source,
      license: {
        name: type,
        url:
          brand.license?.url ??
          (type === "CC0-1.0"
            ? "https://creativecommons.org/publicdomain/zero/1.0/"
            : `https://spdx.org/licenses/${type}.html`),
      },
      by: null,
      note: `${brand.title} is a trademark of its owner: show it only to refer to ${brand.title}${brand.guidelines ? `, as its guidelines allow (${brand.guidelines})` : ""}.`,
    },
  };
}

/** The set's folder, unpacked from its pinned tarball on first use. */
function unpacked(set: IconSet, dir: string): Promise<string> {
  return once(`${dir}:${set}:files`, async () => {
    const pinned = ICON_SETS[set];
    const root = join(dir, `${set}-${pinned.version}`);
    try {
      await readdir(join(root, "icons"));
      return root;
    } catch {}
    const tarball = await pinnedFile(
      pinned.url,
      pinned.sha256,
      join(dir, `${set}-${pinned.version}.tgz`),
      `the ${set} icons`,
    );
    const partial = `${root}.${process.pid}.partial`;
    try {
      for (const [path, data] of untar(gunzipSync(await readFile(tarball)))) {
        if (!pinned.keep.test(path)) continue;
        const out = join(partial, path.replace(/^package\//, ""));
        await mkdir(dirname(out), { recursive: true });
        await writeFile(out, data);
      }
      await rename(partial, root).catch(async (error: NodeJS.ErrnoException) => {
        // Another lookup unpacked it first.
        if (error.code !== "ENOTEMPTY" && error.code !== "EEXIST" && error.code !== "EPERM") {
          throw error;
        }
      });
    } finally {
      await rm(partial, { recursive: true, force: true });
    }
    await rm(tarball, { force: true });
    return root;
  });
}

/** The regular files in a tar archive, by path. */
export function* untar(archive: Buffer): Generator<[string, Buffer]> {
  let offset = 0;
  let longName: string | null = null;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start: number, length: number) =>
      header.toString("utf8", start, start + length).replace(/\0[\s\S]*$/, "");
    const size = Number.parseInt(field(124, 12).trim() || "0", 8);
    const type = field(156, 1);
    const prefix = field(345, 155);
    const data = archive.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === "x") {
      // A pax header: only its path is used.
      longName = /\d+ path=([^\n]*)\n/.exec(data.toString("utf8"))?.[1] ?? null;
      continue;
    }
    const name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    longName = null;
    if (type === "0" || type === "") yield [name, data];
  }
}

/** A name as Simple Icons' slugs are made: lower case letters and digits, with + . & spelled. */
function squash(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replaceAll("+", "plus")
    .replaceAll(".", "dot")
    .replaceAll("&", "and")
    .replace(/[^a-z0-9]/g, "");
}

function kebab(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
