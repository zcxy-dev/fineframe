// Renders overlays to transparent video with Remotion, and keeps each render in a cache keyed by
// everything that shapes it, so an unchanged overlay renders once.

import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import type { FrameRate } from "@video-editor/schema";
import { compositorDir } from "./compositor.ts";
import type { Aspect } from "./layout.ts";
import type { OverlayProps } from "./remotion/props.ts";
import type { Task, WorkerMessage } from "./worker.ts";

const PACKAGE = fileURLToPath(new URL("..", import.meta.url));

/** One overlay to render: a template with params validateOverlays accepts, at the output's
 * size and frame rate, for a whole number of output frames. */
export interface OverlayJob {
  template: string;
  params: object;
  aspect: Aspect;
  width: number;
  height: number;
  fps: FrameRate;
  frames: number;
}

export interface RenderOverlaysOptions {
  /** Called as rendering advances, with the fraction done (0 to 1) and a line to show. */
  onProgress?: (fraction: number, message: string) => void;
  /** Called while what renders the overlays downloads on its first use, Chrome Headless Shell
   * and, where it was not installed, Remotion's compositor: its name, and the bytes so far of
   * `total`. */
  onDownload?: (name: string, bytes: number, total: number) => void;
}

/** Where rendered overlays and the page they render from are kept. */
export function cacheDir(): string {
  const cache = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(cache, "video-editor", "effects");
}

let version: Promise<string> | undefined;

/** A hash of this package's source and its pinned dependencies: a change to either changes how
 * overlays may look, so it starts a fresh cache. */
export function codeVersion(): Promise<string> {
  version ??= (async () => {
    const hash = createHash("sha256");
    const entries = await readdir(join(PACKAGE, "src"), { recursive: true, withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && !entry.name.endsWith(".test.ts"))
      .map((entry) => join(entry.parentPath, entry.name))
      .sort();
    for (const file of [...files, join(PACKAGE, "package.json")]) {
      hash
        .update(`${relative(PACKAGE, file)}\0`)
        .update(await readFile(file))
        .update("\0");
    }
    return hash.digest("hex");
  })();
  return version;
}

/** The cache key of one overlay: the same params in any key order give the same key. */
export function overlayKey(job: OverlayJob, code: string): string {
  const { template, params, aspect, width, height, fps, frames } = job;
  const shape = [code, template, sorted(params), aspect, width, height, fps.num, fps.den, frames];
  return createHash("sha256").update(JSON.stringify(shape)).digest("hex").slice(0, 32);
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, inner]) => [key, sorted(inner)]),
  );
}

/**
 * Renders each overlay as VP9 with alpha in WebM, frame n of the file being frame n of the
 * overlay, and returns the files in the order of `jobs`. Reading the alpha needs FFmpeg's
 * libvpx-vp9 decoder; its built-in VP9 decoder drops it. Overlays already in the cache are not
 * rendered again. The first render downloads Chrome Headless Shell for Remotion, and Remotion's
 * compositor where it was not installed.
 */
export async function renderOverlays(
  jobs: OverlayJob[],
  options: RenderOverlaysOptions = {},
): Promise<string[]> {
  const code = await codeVersion();
  const dir = cacheDir();
  const files = jobs.map((job) => join(dir, "overlays", `${overlayKey(job, code)}.webm`));
  const missing = new Map<string, OverlayProps>();
  for (const [i, job] of jobs.entries()) {
    const file = files[i] as string;
    if (missing.has(file) || (await exists(file))) continue;
    const { fps, ...rest } = job;
    missing.set(file, { ...rest, fps: fps.num / fps.den } as OverlayProps);
  }
  if (missing.size > 0) {
    const binaries = await compositorDir(dir, (bytes, total) =>
      options.onDownload?.("Remotion's compositor", bytes, total),
    );
    const task: Task = {
      bundle: join(dir, `bundle-${code.slice(0, 16)}`),
      binaries,
      jobs: [...missing].map(([out, props]) => ({ out, props })),
    };
    await runWorker(task, options);
  }
  return files;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The folder Chrome Headless Shell is kept in, as the working directory of the renders: Remotion
 * keeps the Chrome it downloads under the node_modules of the package around its working
 * directory. The package.json there ends its search, so neither the caller's folder, such as one
 * of footage, nor this package, which an installed app cannot write to, is chosen.
 */
async function chromeDir(): Promise<string> {
  const dir = join(cacheDir(), "chrome");
  await mkdir(dir, { recursive: true });
  const manifest = join(dir, "package.json");
  if (!(await exists(manifest))) await writeFile(manifest, '{ "private": true }\n');
  return dir;
}

/** Renders in a child process, whose own output goes to stderr, so a caller's stdout stays its
 * own. */
async function runWorker(task: Task, options: RenderOverlaysOptions) {
  const cwd = await chromeDir();
  return new Promise<void>((resolve, reject) => {
    const child = fork(join(PACKAGE, "src", "worker.ts"), { cwd, stdio: ["ignore", 2, 2, "ipc"] });
    let failure: string | undefined;
    child.on("message", (message: WorkerMessage) => {
      if (message.type === "progress") options.onProgress?.(message.fraction, message.message);
      else if (message.type === "download") {
        options.onDownload?.(message.name, message.bytes, message.total);
      } else failure = message.message;
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Rendering overlays failed (${signal ?? code}): ${failure ?? ""}`));
    });
    child.send(task);
  });
}
