// The child process renderOverlays starts: bundles the Remotion page once per code version,
// then renders each overlay in one shared browser.

import { access, mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, openBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import { COMPOSITION, type OverlayProps } from "./remotion/props.ts";

export interface Task {
  /** The folder the bundled page is kept in. */
  bundle: string;
  /** Remotion's compositor, when it was downloaded rather than installed (./compositor.ts). */
  binaries: string | null;
  jobs: { out: string; props: OverlayProps }[];
}

export type WorkerMessage =
  | { type: "progress"; fraction: number; message: string }
  | { type: "download"; name: string; bytes: number; total: number }
  | { type: "error"; message: string };

const ENTRY = fileURLToPath(new URL("./remotion/root.tsx", import.meta.url));

function send(message: WorkerMessage): void {
  process.send?.(message);
}

/** The bundled page, built into `dir` unless an earlier render built it. Built beside it and
 * renamed into place, so a concurrent render never reads a half-written bundle. */
async function page(dir: string): Promise<string> {
  try {
    await access(join(dir, "index.html"));
    return dir;
  } catch {}
  const partial = `${dir}.${process.pid}.partial`;
  await mkdir(dirname(dir), { recursive: true });
  try {
    // Webpack's own cache would add hundreds of MB under node_modules to speed up a rebuild
    // that the per-version bundle folder already avoids.
    await bundle({ entryPoint: ENTRY, outDir: partial, enableCaching: false });
    await rename(partial, dir).catch(async (error: NodeJS.ErrnoException) => {
      // Another render finished the same bundle first.
      if (error.code !== "ENOTEMPTY" && error.code !== "EEXIST") throw error;
    });
  } finally {
    await rm(partial, { recursive: true, force: true });
  }
  return dir;
}

async function main(task: Task): Promise<void> {
  send({ type: "progress", fraction: 0, message: "Preparing the effects renderer" });
  await ensureBrowser({
    logLevel: "error",
    onBrowserDownload: () => ({
      version: null,
      onProgress: ({ downloadedBytes, totalSizeInBytes }) =>
        send({
          type: "download",
          name: "Chrome Headless Shell",
          bytes: downloadedBytes,
          total: totalSizeInBytes,
        }),
    }),
  });
  const serveUrl = await page(task.bundle);
  const browser = await openBrowser("chrome", { logLevel: "error" });
  try {
    for (const [i, { out, props }] of task.jobs.entries()) {
      const message = `Rendering effect ${i + 1}/${task.jobs.length} (${props.template})`;
      const inputProps = props as unknown as Record<string, unknown>;
      const composition = await selectComposition({
        serveUrl,
        id: COMPOSITION,
        inputProps,
        puppeteerInstance: browser,
        binariesDirectory: task.binaries,
        logLevel: "error",
      });
      await mkdir(dirname(out), { recursive: true });
      const partial = `${out}.${process.pid}.partial.webm`;
      try {
        await renderMedia({
          serveUrl,
          composition,
          inputProps,
          puppeteerInstance: browser,
          binariesDirectory: task.binaries,
          // PNG frames keep the alpha channel and VP9 carries it. Chosen over ProRes 4444 for its
          // file size and decoding cost (packages/effects/README.md#format).
          codec: "vp9",
          imageFormat: "png",
          pixelFormat: "yuva420p",
          // The renderer composites in BT.709, which the output is tagged with.
          colorSpace: "bt709",
          outputLocation: partial,
          logLevel: "error",
          onProgress: ({ progress }) =>
            send({ type: "progress", fraction: (i + progress) / task.jobs.length, message }),
        });
        await rename(partial, out);
      } finally {
        await rm(partial, { force: true });
      }
    }
  } finally {
    await browser.close({ silent: true });
  }
}

process.once("message", (task: Task) => {
  main(task).then(
    () => process.disconnect(),
    (error: Error) => {
      send({ type: "error", message: error.stack ?? error.message });
      process.exitCode = 1;
      process.disconnect();
    },
  );
});
