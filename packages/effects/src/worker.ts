// The child process renderPages starts: renders each page with HyperFrames, which seeks the
// page's CSS animations to each frame and captures it.

import { createRenderJob, executeRenderJob } from "@hyperframes/producer";
import type { FrameRate } from "@video-editor/schema";
import { guardPuppeteer, hyperframesPuppeteer } from "./guard.ts";
import type { Binaries } from "./render.ts";

export interface WorkerTask {
  /** The folder the pages and what they load are in. */
  site: string;
  binaries: Binaries;
  jobs: { entry: string; out: string; fps: FrameRate; transparent: boolean }[];
}

export type WorkerMessage =
  | { type: "progress"; fraction: number; message: string }
  | { type: "error"; message: string };

function send(message: WorkerMessage): void {
  process.send?.(message);
}

const quiet = () => {};

async function main(task: WorkerTask): Promise<void> {
  // Every page HyperFrames opens reaches nothing but its own folder and runs only its scripts.
  guardPuppeteer(await hyperframesPuppeteer());
  // HyperFrames also logs each step of a render to the console; only its errors are worth a line.
  console.log = console.info = console.debug = console.warn = quiet;
  process.env.PRODUCER_HEADLESS_SHELL_PATH = task.binaries.chrome;
  process.env.HYPERFRAMES_FFMPEG_PATH = task.binaries.ffmpeg;
  process.env.HYPERFRAMES_FFPROBE_PATH = task.binaries.ffprobe;
  const total = task.jobs.length;
  for (const [i, job] of task.jobs.entries()) {
    const message = `Rendering effect ${i + 1}/${total}`;
    send({ type: "progress", fraction: i / total, message });
    const render = createRenderJob({
      fps: job.fps,
      quality: "high",
      format: job.transparent ? "webm" : "mp4",
      entryFile: job.entry,
      logger: {
        info: quiet,
        debug: quiet,
        warn: quiet,
        error: (...args) => console.error(...args),
      },
    });
    // HyperFrames reports each job's progress in percent.
    await executeRenderJob(render, task.site, job.out, (progress) => {
      send({ type: "progress", fraction: (i + progress.progress / 100) / total, message });
    });
  }
  send({ type: "progress", fraction: 1, message: `Rendered ${total} effects` });
}

process.once("message", (task: WorkerTask) => {
  main(task).then(
    () => process.exit(0),
    (error: unknown) => {
      send({ type: "error", message: error instanceof Error ? error.message : String(error) });
      process.exit(1);
    },
  );
});
