// Stock footage from Pexels and Pixabay, with the user's own free keys: PEXELS_API_KEY and
// PIXABAY_API_KEY. Without either key the search finds nothing and B-roll comes from the other
// sources. Each API's terms are kept: a search is cached for 24 hours, the clip is downloaded
// rather than linked to, and its credit names the creator and links to its page.
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { cacheDir } from "../download.ts";
import type { Credit } from "./credits.ts";

export type Provider = "pexels" | "pixabay";

/** The variable each provider's key is read from. */
export const STOCK_KEYS: Record<Provider, string> = {
  pexels: "PEXELS_API_KEY",
  pixabay: "PIXABAY_API_KEY",
};

export interface StockOptions {
  /** What to show, in English, such as "city traffic at night". */
  query: string;
  orientation: "landscape" | "portrait";
  /** The shortest clip that fills the slot, in seconds. */
  minSeconds?: number;
  /** The short side wanted, in pixels: 1080 unless given. A larger file is taken only when no
   * file reaches it. */
  size?: number;
  /** Clips already used in this video, as `provider:id`, so each shows once. */
  exclude?: readonly string[];
  /** The keys; read from the environment unless given. */
  keys?: Partial<Record<Provider, string>>;
  /** Where searches and clips are kept: `<cache>/broll/stock` unless given. */
  dir?: string;
  /** Hears why a provider gave nothing, such as a rejected key or a rate limit. */
  onProblem?: (message: string) => void;
  /** For tests. */
  fetch?: typeof fetch;
  now?: () => number;
}

export interface StockClip {
  path: string;
  provider: Provider;
  id: string;
  width: number;
  height: number;
  seconds: number;
  credit: Credit;
}

/** One video a search found, with its files. */
interface Found {
  id: string;
  page: string;
  seconds: number;
  by: { name: string; url: string | null };
  files: { url: string; width: number; height: number }[];
}

/** A search's results are kept this long, as Pixabay asks. */
export const SEARCH_TTL_MS = 24 * 60 * 60 * 1000;

const PROVIDERS: Provider[] = ["pexels", "pixabay"];

const LICENSES: Record<Provider, { name: string; url: string }> = {
  pexels: { name: "Pexels License", url: "https://www.pexels.com/license/" },
  pixabay: { name: "Pixabay Content License", url: "https://pixabay.com/service/license-summary/" },
};

const NAMES: Record<Provider, string> = { pexels: "Pexels", pixabay: "Pixabay" };

/** The providers that have a key. */
export function stockProviders(keys: Partial<Record<Provider, string>> = envKeys()): Provider[] {
  return PROVIDERS.filter((provider) => keys[provider]);
}

function envKeys(): Partial<Record<Provider, string>> {
  return {
    pexels: process.env[STOCK_KEYS.pexels] || undefined,
    pixabay: process.env[STOCK_KEYS.pixabay] || undefined,
  };
}

/** The best clip for `options.query`: Pexels first, then Pixabay, the first result in each
 * one's order that fits the orientation and length, downloaded into the cache. Null when no
 * provider has a key or none found one. */
export async function findStock(options: StockOptions): Promise<StockClip | null> {
  const keys = options.keys ?? envKeys();
  const dir = options.dir ?? join(cacheDir(), "broll", "stock");
  const problem = options.onProblem ?? ((message) => process.stderr.write(`${message}\n`));
  const exclude = new Set(options.exclude ?? []);
  for (const provider of stockProviders(keys)) {
    const key = keys[provider] ?? "";
    let found: Found[];
    try {
      found = await search(provider, key, options, dir);
    } catch (error) {
      problem((error as Error).message);
      continue;
    }
    for (const video of found) {
      if (exclude.has(`${provider}:${video.id}`)) continue;
      if (video.seconds < (options.minSeconds ?? 0)) continue;
      const file = pickFile(video.files, options.orientation, options.size ?? 1080);
      if (!file) continue;
      const path = join(dir, `${provider}-${video.id}-${file.width}x${file.height}.mp4`);
      try {
        await download(file.url, path, options.fetch ?? fetch);
      } catch (error) {
        problem((error as Error).message);
        continue;
      }
      return {
        path,
        provider,
        id: video.id,
        width: file.width,
        height: file.height,
        seconds: video.seconds,
        credit: {
          what: `Video by ${video.by.name} on ${NAMES[provider]}`,
          source: video.page,
          license: LICENSES[provider],
          by: video.by,
        },
      };
    }
  }
  return null;
}

/** The smallest file in the orientation whose short side reaches `size`, else the largest. */
export function pickFile<T extends { width: number; height: number }>(
  files: readonly T[],
  orientation: "landscape" | "portrait",
  size: number,
): T | null {
  const fitting = files
    .filter((file) =>
      orientation === "landscape" ? file.width > file.height : file.height > file.width,
    )
    .sort((a, b) => a.width * a.height - b.width * b.height);
  return (
    fitting.find((file) => Math.min(file.width, file.height) >= size) ?? fitting.at(-1) ?? null
  );
}

/** A provider's results for the query, from the cache when it searched within 24 hours. */
async function search(
  provider: Provider,
  key: string,
  options: StockOptions,
  dir: string,
): Promise<Found[]> {
  const query = options.query.trim().slice(0, 100);
  // The cache is named by what was asked, never by the key.
  const asked = JSON.stringify([provider, query, options.orientation]);
  const cached = join(dir, "searches", `${sha256(asked).slice(0, 24)}.json`);
  const now = options.now?.() ?? Date.now();
  try {
    const kept = JSON.parse(await readFile(cached, "utf8")) as { at: number; found: Found[] };
    if (now - kept.at < SEARCH_TTL_MS) return kept.found;
  } catch {}
  const request: { url: string; headers: Record<string, string> } =
    provider === "pexels"
      ? {
          url: `https://api.pexels.com/videos/search?${new URLSearchParams({
            query,
            orientation: options.orientation,
            per_page: "15",
          })}`,
          headers: { Authorization: key },
        }
      : {
          url: `https://pixabay.com/api/videos/?${new URLSearchParams({
            key,
            q: query,
            video_type: "film",
            safesearch: "true",
            per_page: "20",
          })}`,
          headers: {},
        };
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(request.url, {
      headers: request.headers,
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error(`Could not reach ${NAMES[provider]} to search for stock footage`);
  }
  if (response.status === 401 || response.status === 403 || response.status === 400) {
    // Pixabay answers a wrong key with 400.
    throw new Error(`${NAMES[provider]} did not accept ${STOCK_KEYS[provider]}; check the key`);
  }
  if (response.status === 429) {
    throw new Error(`${NAMES[provider]}'s rate limit is reached; try again later`);
  }
  if (!response.ok) {
    throw new Error(`${NAMES[provider]} could not search (HTTP ${response.status})`);
  }
  const body = (await response.json()) as unknown;
  const found = provider === "pexels" ? fromPexels(body) : fromPixabay(body);
  await mkdir(dirname(cached), { recursive: true });
  await writeFile(cached, JSON.stringify({ at: now, found }));
  return found;
}

interface PexelsBody {
  videos?: {
    id: number;
    url: string;
    duration: number;
    user: { name: string; url: string };
    video_files: { file_type: string; width: number | null; height: number | null; link: string }[];
  }[];
}

function fromPexels(body: unknown): Found[] {
  return ((body as PexelsBody).videos ?? []).map((video) => ({
    id: String(video.id),
    page: video.url,
    seconds: video.duration,
    by: { name: video.user.name, url: video.user.url },
    files: video.video_files
      .filter((file) => file.file_type === "video/mp4" && file.width && file.height)
      .map((file) => ({ url: file.link, width: file.width ?? 0, height: file.height ?? 0 })),
  }));
}

interface PixabayBody {
  hits?: {
    id: number;
    pageURL: string;
    duration: number;
    user: string;
    user_id: number;
    videos: Record<string, { url: string; width: number; height: number }>;
  }[];
}

function fromPixabay(body: unknown): Found[] {
  return ((body as PixabayBody).hits ?? []).map((hit) => ({
    id: String(hit.id),
    page: hit.pageURL,
    seconds: hit.duration,
    by: { name: hit.user, url: `https://pixabay.com/users/${hit.user}-${hit.user_id}/` },
    files: Object.values(hit.videos)
      .filter((file) => file.url && file.width && file.height)
      .map(({ url, width, height }) => ({ url, width, height })),
  }));
}

/** Downloads `url` to `path` unless it is there, beside it first and renamed into place. */
async function download(url: string, path: string, get: typeof fetch): Promise<void> {
  if (
    await stat(path).then(
      (s) => s.size > 0,
      () => false,
    )
  )
    return;
  if (!url.startsWith("https://")) throw new Error(`Not downloading stock footage over ${url}`);
  const response = await get(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) {
    throw new Error(
      `Could not download stock footage from ${new URL(url).host}: HTTP ${response.status}`,
    );
  }
  await mkdir(dirname(path), { recursive: true });
  // Named for this download alone, so two at once never write into one file.
  const partial = `${path}.${randomUUID()}.partial`;
  try {
    await pipeline(Readable.fromWeb(response.body as never), createWriteStream(partial));
    await rename(partial, path);
  } finally {
    await rm(partial, { force: true });
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
