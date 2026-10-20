import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, chmod, mkdir, readdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Where pinned downloads are kept: `~/.cache/video-editor/` unless XDG_CACHE_HOME says else. */
export function cacheDir(): string {
  return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "video-editor");
}

/** Bytes downloaded so far, of `total` (0 when the server does not say). */
export type DownloadProgress = (bytes: number, total: number) => void;

/**
 * The file at `path`, downloaded from `url` and checked against its SHA-256 first if it is not
 * there yet. `what` names it in the message printed while it downloads; `onProgress` hears each
 * chunk as it arrives.
 */
export async function pinnedFile(
  url: string,
  sha256: string,
  path: string,
  what: string,
  mode = 0o644,
  onProgress?: DownloadProgress,
): Promise<string> {
  if (await exists(path)) return path;
  process.stderr.write(`Downloading ${what} to ${path}\n`);
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Could not download ${what} from ${url}: HTTP ${response.status}`);
  }
  await mkdir(dirname(path), { recursive: true });
  // Written beside the target and renamed into place once verified, so a concurrent render
  // never reads a half-written or unverified file.
  const partial = `${path}.${process.pid}.partial`;
  const hash = createHash("sha256");
  const total = Number(response.headers.get("content-length")) || 0;
  let bytes = 0;
  const hashing = new Transform({
    transform(chunk, _encoding, done) {
      hash.update(chunk);
      bytes += chunk.length;
      onProgress?.(bytes, total);
      done(null, chunk);
    },
  });
  try {
    await pipeline(response.body, hashing, createWriteStream(partial));
    const actual = hash.digest("hex");
    if (actual !== sha256) {
      throw new Error(`${what} from ${url} has SHA-256 ${actual}, expected ${sha256}`);
    }
    await chmod(partial, mode);
    await rename(partial, path).catch(async (error: unknown) => {
      // Another download put it in place first; Windows will not replace it while it runs.
      if (!(await exists(path))) throw error;
    });
  } finally {
    await rm(partial, { force: true });
  }
  return path;
}

/**
 * Deletes what earlier pins left beside `kept`, a pinned download's file or folder: everything in
 * its folder whose name starts with `prefix`, such as `ffmpeg-` for `ffmpeg-e7e7fb30477f`, and
 * not with `kept`'s own name. Called after a new pin is downloaded, so each pin's old download
 * goes once; one that cannot be deleted, such as a program still running on Windows, stays.
 */
export async function removeOtherPins(kept: string, prefix: string): Promise<void> {
  const dir = dirname(kept);
  for (const name of await readdir(dir).catch(() => [])) {
    if (!name.startsWith(prefix) || name.startsWith(basename(kept))) continue;
    await rm(join(dir, name), { recursive: true, force: true }).catch(() => {});
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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
