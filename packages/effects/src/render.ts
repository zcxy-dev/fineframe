// Renders effect pages to video with HyperFrames, in a child process, each page once: a page
// rendered before at the same size, rate and length is read back from the cache.

import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { FrameRate } from "@video-editor/schema";
import type { TemplateId, TemplateParams } from "./catalog.ts";
import { type GraphicJob, graphicPage } from "./graphics.ts";
import { markFiles } from "./icons.ts";
import type { Aspect } from "./layout.ts";
import { page } from "./page.ts";
import { fontAssets, HOUSE_CSS } from "./style.ts";
import { templateMarkup } from "./templates.ts";
import type { WorkerMessage, WorkerTask } from "./worker.ts";

const require = createRequire(import.meta.url);
const PACKAGE = dirname(require.resolve("../package.json"));

/** The programs a render runs: Chrome Headless Shell, and FFmpeg and ffprobe for the video. */
export interface Binaries {
  chrome: string;
  ffmpeg: string;
  ffprobe: string;
}

/** One page to render, for a whole number of frames at the output's rate. */
export interface PageJob {
  /** The whole document, from `page()`. */
  page: string;
  width: number;
  height: number;
  fps: FrameRate;
  frames: number;
  /** Rendered with its alpha, as VP9 in WebM, for an effect laid over the picture; otherwise
   * opaque, as H.264 in MP4, for one that fills its area. */
  transparent: boolean;
}

export interface RenderOptions {
  /** Called as rendering advances, with the fraction done (0 to 1) and a line to show. */
  onProgress?: (fraction: number, message: string) => void;
}

/** Where rendered effects and the folder they render from are kept. */
export function cacheDir(): string {
  const cache = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(cache, "video-editor", "effects");
}

let assets:
  | Promise<{ key: string; css: string; files: Map<string, string>; marks: Map<string, string> }>
  | undefined;

/** The fonts, the house stylesheet, the icons and the logos every page may load, with a hash of
 * them and of the renderer's version: a change to any of them changes how effects look, so it
 * starts a fresh cache. */
function siteAssets() {
  assets ??= (async () => {
    const fonts = await fontAssets((path) => readFile(path, "utf8"));
    const marks = markFiles();
    const producer = JSON.parse(await readFile(join(PACKAGE, "package.json"), "utf8")).dependencies[
      "@hyperframes/producer"
    ];
    const key = createHash("sha256")
      .update(JSON.stringify([producer, HOUSE_CSS, fonts.css, [...marks]]))
      .digest("hex")
      .slice(0, 16);
    return { key, ...fonts, marks };
  })();
  return assets;
}

/** The folder pages render from, with the stylesheets, fonts, icons and logos they load, made once
 * per version: built beside it and renamed into place, so a concurrent render never reads half. */
export async function site(): Promise<string> {
  const { key, css, files, marks } = await siteAssets();
  const dir = join(cacheDir(), `site-${key}`);
  if (await exists(join(dir, "house.css"))) return dir;
  const partial = `${dir}.${process.pid}.partial`;
  try {
    await mkdir(join(partial, "files"), { recursive: true });
    for (const [name, from] of files) await copyFile(from, join(partial, "files", name));
    await writeFile(join(partial, "fonts.css"), css);
    for (const [path, svg] of marks) {
      await mkdir(dirname(join(partial, path)), { recursive: true });
      await writeFile(join(partial, path), svg);
    }
    // Written last: the folder is complete once it is there.
    await writeFile(join(partial, "house.css"), HOUSE_CSS);
    await rename(partial, dir).catch(async (error: NodeJS.ErrnoException) => {
      if (!(await exists(join(dir, "house.css")))) throw error;
    });
  } finally {
    await rm(partial, { recursive: true, force: true });
  }
  return dir;
}

/** The cache key of one page. */
export async function pageKey(job: PageJob): Promise<string> {
  const { key } = await siteAssets();
  const { page, width, height, fps, frames, transparent } = job;
  const shape = [key, page, width, height, fps.num, fps.den, frames, transparent];
  return createHash("sha256").update(JSON.stringify(shape)).digest("hex").slice(0, 32);
}

/**
 * Renders each page, frame n of the file being frame n of the effect, and returns the files in
 * the order of `jobs`. A transparent page's alpha is read with FFmpeg's libvpx-vp9 decoder; its
 * built-in VP9 decoder drops it. `folder` is the cache's subfolder the files go in.
 */
async function renderPages(
  jobs: readonly PageJob[],
  folder: string,
  binaries: Binaries,
  options: RenderOptions = {},
): Promise<string[]> {
  const out = join(cacheDir(), folder);
  const files: string[] = [];
  const missing = new Map<string, PageJob>();
  for (const job of jobs) {
    const file = join(out, `${await pageKey(job)}.${job.transparent ? "webm" : "mp4"}`);
    files.push(file);
    if (!missing.has(file) && !(await exists(file))) missing.set(file, job);
  }
  if (missing.size === 0) return files;
  await mkdir(out, { recursive: true });
  const dir = await site();
  // Each page is written into the folder under its own name for the render, and removed after.
  const task: WorkerTask = { site: dir, binaries, jobs: [] };
  for (const [file, job] of missing) {
    const entry = `${createHash("sha256").update(file).digest("hex").slice(0, 16)}-${process.pid}.html`;
    await writeFile(join(dir, entry), job.page);
    task.jobs.push({ entry, out: file, fps: job.fps, transparent: job.transparent });
  }
  try {
    await runWorker(task, options);
  } finally {
    for (const job of task.jobs) await rm(join(dir, job.entry), { force: true });
  }
  return files;
}

/** Renders in a child process, whose own output goes to stderr, so a caller's stdout stays its
 * own, and whose browsers end with it. */
function runWorker(task: WorkerTask, options: RenderOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = fork(join(PACKAGE, "src", "worker.ts"), { stdio: ["ignore", 2, 2, "ipc"] });
    let failure: string | undefined;
    child.on("message", (message: WorkerMessage) => {
      if (message.type === "progress") options.onProgress?.(message.fraction, message.message);
      else failure = message.message;
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Rendering effects failed (${signal ?? code}): ${failure ?? ""}`));
    });
    child.send(task);
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** One effect template to render over the picture, at the output's size and rate. */
export interface OverlayJob {
  template: TemplateId;
  params: TemplateParams[TemplateId];
  aspect: Aspect;
  width: number;
  height: number;
  fps: FrameRate;
  frames: number;
}

/** Renders each overlay as VP9 with alpha in WebM, as renderPages does. */
export function renderOverlays(
  jobs: readonly OverlayJob[],
  binaries: Binaries,
  options: RenderOptions = {},
): Promise<string[]> {
  const pages = jobs.map((job): PageJob => {
    const { width, height, fps, frames } = job;
    // The wipe's bands are gone by the last frame, which comes a frame before its time is up.
    const last = ((frames - 1) * fps.den) / fps.num;
    const markup = templateMarkup(job.template, job.params, job.aspect, width, height, last);
    const u = Math.min(width, height) / 100;
    return {
      page: page({ width, height, u, fps, frames, ...markup }),
      width,
      height,
      fps,
      frames,
      transparent: true,
    };
  });
  return renderPages(pages, "overlays", binaries, options);
}

/** Renders each graphic: a label or a lower third at its box, with its alpha; a panel or a
 * full-frame graphic opaque at its area's size. */
export function renderGraphics(
  jobs: readonly GraphicJob[],
  binaries: Binaries,
  options: RenderOptions = {},
): Promise<string[]> {
  const pages = jobs.map(
    (job): PageJob => ({
      ...graphicPage(job),
      fps: job.output.fps,
      frames: job.frames,
    }),
  );
  return renderPages(pages, "graphics", binaries, options);
}
