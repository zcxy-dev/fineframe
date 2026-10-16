// Remotion's compositor: the native programs Remotion renders with, its own FFmpeg among them.
// Installed from a clone, it comes with @remotion/renderer. The desktop app's installer leaves it
// out, as that FFmpeg is GPL with non-free parts that may not be passed on, and it is downloaded
// here from npm on the first render instead, checked against the lockfile.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

/** Remotion's package for this system, as @remotion/renderer names it (glibc on Linux). */
export function compositorPackage(platform = process.platform, arch = process.arch): string {
  const names: Record<string, string> = {
    "darwin-arm64": "darwin-arm64",
    "darwin-x64": "darwin-x64",
    "linux-x64": "linux-x64-gnu",
    "linux-arm64": "linux-arm64-gnu",
    "win32-x64": "win32-x64-msvc",
  };
  const name = names[`${platform}-${arch}`];
  if (!name) throw new Error(`Remotion has no compositor for ${platform} ${arch}`);
  return `@remotion/compositor-${name}`;
}

/** The SHA-512 integrity pnpm-lock.yaml holds for `name@version`, or null. */
export function lockedIntegrity(lockfile: string, name: string, version: string): string | null {
  const at = lockfile.indexOf(`\n  '${name}@${version}':\n`);
  if (at < 0) return null;
  const entry = lockfile.slice(at, at + 400).match(/integrity: (sha512-[A-Za-z0-9+/=]+)/);
  return entry ? (entry[1] as string) : null;
}

/** The lockfile of the workspace this package is in. */
async function lockfile(): Promise<string> {
  let dir = dirname(require.resolve("../package.json"));
  for (;;) {
    const path = join(dir, "pnpm-lock.yaml");
    if (existsSync(path)) return readFile(path, "utf8");
    const parent = dirname(dir);
    if (parent === dir) throw new Error("No pnpm-lock.yaml above @video-editor/effects");
    dir = parent;
  }
}

/**
 * The folder holding the compositor for Remotion's `binariesDirectory`: null when it was installed
 * with the renderer, which then finds it itself, or else the one downloaded into `cache` on first
 * use, with `onDownload` hearing the bytes as they arrive.
 */
export async function compositorDir(
  cache: string,
  onDownload?: (bytes: number, total: number) => void,
): Promise<string | null> {
  const name = compositorPackage();
  try {
    createRequire(require.resolve("@remotion/renderer")).resolve(`${name}/package.json`);
    return null;
  } catch {}
  // Each renderer pins its compositor at its own version.
  const { version } = require("@remotion/renderer/package.json") as { version: string };
  const dir = join(cache, `compositor-${name.split("/")[1]}-${version}`);
  if (existsSync(join(dir, "package.json"))) return dir;

  const integrity = lockedIntegrity(await lockfile(), name, version);
  if (!integrity) throw new Error(`pnpm-lock.yaml has no ${name}@${version}`);
  const file = name.split("/")[1] as string;
  const url = `https://registry.npmjs.org/${name}/-/${file}-${version}.tgz`;
  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(
      `Could not download Remotion's compositor from ${url}: HTTP ${response.status}`,
    );
  }
  const total = Number(response.headers.get("content-length")) || 0;
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    chunks.push(Buffer.from(chunk));
    bytes += chunk.length;
    onDownload?.(bytes, total);
  }
  const archive = Buffer.concat(chunks);
  const actual = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
  if (actual !== integrity)
    throw new Error(`${url} has integrity ${actual}, expected ${integrity}`);

  // Unpacked beside it and renamed into place, so a half-unpacked folder is never used.
  const partial = `${dir}.${process.pid}.partial`;
  await rm(partial, { recursive: true, force: true });
  await mkdir(partial, { recursive: true });
  try {
    await writeFile(join(partial, "package.tgz"), archive);
    const unpacked = spawnSync("tar", ["-xzf", "package.tgz", "--strip-components=1"], {
      cwd: partial,
      stdio: "inherit",
    });
    if (unpacked.status !== 0) throw new Error(`Could not unpack ${url}`);
    await rm(join(partial, "package.tgz"));
    await rename(partial, dir).catch(async (error: NodeJS.ErrnoException) => {
      // Another render unpacked it first.
      if (error.code !== "ENOTEMPTY" && error.code !== "EEXIST") throw error;
    });
  } finally {
    await rm(partial, { recursive: true, force: true });
  }
  return dir;
}
