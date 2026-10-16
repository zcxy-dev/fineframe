import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { access, chmod, mkdir, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

/** Where pinned downloads are kept: `~/.cache/video-editor/` unless XDG_CACHE_HOME says else. */
export function cacheDir(): string {
  return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "video-editor");
}

/**
 * The file at `path`, downloaded from `url` and checked against its SHA-256 first if it is not
 * there yet. `what` names it in the message printed while it downloads.
 */
export async function pinnedFile(
  url: string,
  sha256: string,
  path: string,
  what: string,
  mode = 0o644,
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
  const hashing = new Transform({
    transform(chunk, _encoding, done) {
      hash.update(chunk);
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

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
