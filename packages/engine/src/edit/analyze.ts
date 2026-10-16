import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { MusicIndex, Source, StageProgress } from "@video-editor/schema";
import { EditError } from "./error.ts";
import type { MediaFile } from "./inputs.ts";

/** How to run vework, and what identifies the analysis it does. */
export interface Worker {
  /** The program, then the arguments before vework's own. */
  command: [string, ...string[]];
  /** Changes whenever the analysis code does, so an index older code wrote is not reused. */
  version: string;
}

/** What the analysis is asked to do besides the defaults. */
export interface AnalysisOptions {
  /** Claude corrects the transcript before its words are timed. */
  correct: boolean;
  /** Names and terms said in the footage, one per line: they bias the speech model and guide
   * the correction. */
  names?: { path: string; text: string };
  /** Where the speech is heard: by the local model, or on OpenRouter with the user's key. */
  asr?: "local" | "cloud";
}

const WORKER = fileURLToPath(new URL("../../../../worker/", import.meta.url));

/** vework in the repository's worker/, run by uv on the Python version the repository pins and
 * with the ml extra. uv rebuilds an environment whose Python is gone (after an upgrade) with the
 * first Python on PATH, and installs only the extras asked for; both are named so the rebuilt one
 * still runs the models. Its version is a hash of the worker's code and lockfile. */
export async function localWorker(): Promise<Worker> {
  const code = (await readdir(join(WORKER, "src"), { recursive: true }))
    .filter((file) => file.endsWith(".py"))
    .map((file) => join("src", file))
    .sort();
  const hash = createHash("sha256");
  for (const file of ["pyproject.toml", "uv.lock", ...code]) {
    hash.update(`${file}\0`).update(await readFile(join(WORKER, file)));
  }
  const python = (await readFile(join(WORKER, "..", ".python-version"), "utf8")).trim();
  return {
    command: ["uv", "run", "--project", WORKER, "--python", python, "--extra", "ml", "vework"],
    version: hash.digest("hex"),
  };
}

/** Where indexes are kept between runs, beside the renderer's FFmpeg. */
export function defaultCache(): string {
  return join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "video-editor", "indexes");
}

/** The cached index's file name: the footage's SHA-256, then a hash of everything else the
 * index depends on, so the same file analysed another way, or by other code, is analysed again. */
export function indexName(
  worker: Worker,
  fingerprint: Source["fingerprint"],
  options: AnalysisOptions,
): string {
  const settings = JSON.stringify([
    worker.version,
    options.correct,
    options.names?.text ?? null,
    options.asr ?? "local",
  ]);
  const key = createHash("sha256").update(settings).digest("hex").slice(0, 16);
  return `${fingerprint.sha256}-${key}.index.json`;
}

/** Where each of vework's steps starts, as a share of its run on an 8-core CPU, measured on 1080p
 * interviews and the synthetic corpus: shots take about a fifth, faces an eighth, and
 * transcribing and aligning the rest. */
const STEPS: [RegExp, (n: number) => number][] = [
  [/^probing/, () => 0],
  [/^detecting shots/, () => 0],
  [/^finding speech/, () => 0.2],
  [/^measuring loudness/, () => 0.2],
  [/^finding audio events/, () => 0.21],
  [/^finding faces/, () => 0.22],
  [/^removing noise from speech/, () => 0.34],
  [/^transcribing (\d+)\/(\d+)/, (n) => 0.35 + 0.42 * n],
  [/^correcting/, () => 0.77],
  [/^aligning (\d+)\/(\d+)/, (n) => 0.77 + 0.23 * n],
  // analyze-music, which takes seconds rather than minutes.
  [/^decoding/, () => 0],
  [/^finding beats/, () => 0.1],
];

/** A model vework is downloading on its first use. */
export type Download = NonNullable<StageProgress["download"]>;

/** How far vework is through a file, what it is doing and any model it is downloading. */
export type Report = (fraction: number, message: string, download?: Download) => void;

/**
 * Runs `vework analyze` on one file, writing its media index to `index`, and the denoised speech
 * vework writes beside it, only once they are whole.
 * vework's steps are reported as the fraction of the file done, with its message, and a model it
 * downloads with its bytes, at the fraction reached before; anything else it prints goes to
 * `log`. A failure throws with vework's own error, which says what to do when
 * its environment is not set up.
 */
export function analyze(
  worker: Worker,
  file: MediaFile,
  index: string,
  options: AnalysisOptions,
  report: Report,
  log: (line: string) => void,
): Promise<void> {
  const extra: string[] = [];
  if (options.correct) extra.push("--correct");
  if (options.asr === "cloud") extra.push("--asr", "cloud");
  if (options.names) {
    // OpenRouter takes no context prompt; the names still guide the correction.
    extra.push("--glossary", options.names.path);
    if (options.asr !== "cloud") extra.push("--asr-context");
  }
  return vework(worker, "analyze", file, index, extra, report, log);
}

/** The licence a track is used under, as its music index records it. */
export type License = MusicIndex["license"];

/** Runs `vework analyze-music` on one track, writing its music index to `index` once it is whole,
 * reporting and failing as analyze does. */
export function analyzeMusic(
  worker: Worker,
  file: MediaFile,
  index: string,
  license: License,
  report: Report,
  log: (line: string) => void,
): Promise<void> {
  const extra = ["--license", license.name];
  if (license.url) extra.push("--license-url", license.url);
  if (license.attribution) extra.push("--attribution", license.attribution);
  return vework(worker, "analyze-music", file, index, extra, report, log);
}

/** The cached music index's file name: the track's SHA-256, then a hash of the worker and the
 * licence, which the index records. */
export function musicIndexName(
  worker: Worker,
  fingerprint: Source["fingerprint"],
  license: License,
): string {
  const settings = JSON.stringify([worker.version, license.name, license.url, license.attribution]);
  const key = createHash("sha256").update(settings).digest("hex").slice(0, 16);
  return `${fingerprint.sha256}-${key}.music.json`;
}

async function vework(
  worker: Worker,
  command: "analyze" | "analyze-music",
  file: MediaFile,
  index: string,
  extra: readonly string[],
  report: Report,
  log: (line: string) => void,
): Promise<void> {
  // A folder of its own, since vework names the denoised speech after the index it writes.
  const partial = `${index}.${process.pid}.partial`;
  const written = join(partial, basename(index));
  await mkdir(partial, { recursive: true });
  const [program, ...before] = worker.command;
  const args = [...before, command, file.path, "-o", written, ...extra];
  return new Promise((done, fail) => {
    const child = spawn(program, args, { stdio: ["ignore", "pipe", "pipe"] });
    let error: string | undefined;
    let lastLine = "";
    let failed = false;
    let reached = 0;
    const take = (line: string) => {
      if (!line.trim()) return;
      lastLine = line;
      const said = line.match(/^vework: (.*)$/)?.[1];
      const why = said?.match(/^error: (.*)$/)?.[1];
      if (why) error = why;
      const downloading = said?.match(/^downloading (.+): (\d+) of (\d+) bytes$/);
      if (downloading) {
        const [, name = "", bytes, total] = downloading;
        const download = { name, bytes: Number(bytes), total: Number(total) };
        report(reached, `Downloading ${name}`, download);
        return;
      }
      const step = said && !why ? STEPS.find(([pattern]) => pattern.test(said)) : undefined;
      if (!said || !step) {
        log(line);
        return;
      }
      const [, n, of] = said.match(step[0]) ?? [];
      const fraction = step[1](of ? (Number(n) - 1) / Number(of) : 0);
      reached = fraction;
      report(fraction, said.charAt(0).toUpperCase() + said.slice(1));
    };
    // Each stream keeps its own unfinished line: Python buffers stdout when it is piped, so a
    // line can arrive in pieces with stderr's lines in between.
    const lines = (stream: NodeJS.ReadableStream) => {
      let rest = "";
      // Decoded as a whole, so a character split between two chunks stays one character.
      stream.setEncoding("utf8");
      stream.on("data", (chunk: string) => {
        const parts = (rest + chunk).split(/\r\n|\r|\n/);
        rest = parts.pop() ?? "";
        guard(() => parts.forEach(take));
      });
      stream.on("end", () => guard(() => take(rest)));
    };
    // A throw inside a stream's handler would end the process; it fails the analysis instead.
    const guard = (work: () => void) => {
      try {
        work();
      } catch (thrown) {
        failed = true;
        child.kill();
        fail(thrown);
      }
    };
    lines(child.stdout);
    lines(child.stderr);
    child.on("error", (spawnError: NodeJS.ErrnoException) => {
      // Not awaited: "close" can follow at once and would report the exit instead of the cause.
      void rm(partial, { recursive: true, force: true });
      fail(
        spawnError.code === "ENOENT"
          ? new EditError(
              `${program} is not installed or not on PATH; the analysis needs it. Run ` +
                "`mise install` in the repository, as its README's quick start says",
            )
          : spawnError,
      );
    });
    child.on("close", async (code, signal) => {
      if (failed) {
        await rm(partial, { recursive: true, force: true });
        return;
      }
      if (code === 0) {
        await settle(partial, written, index).then(() => done(), fail);
        return;
      }
      await rm(partial, { recursive: true, force: true });
      const why = error ?? (lastLine.trim() || `it exited with ${signal ?? code}`);
      fail(new EditError(`${file.given}: the analysis failed: ${why}`));
    });
  });
}

/** Moves what vework wrote into the cache, the index last: only a whole index is ever read. */
async function settle(partial: string, written: string, index: string): Promise<void> {
  for (const name of await readdir(partial)) {
    if (name !== basename(written)) await rename(join(partial, name), join(dirname(index), name));
  }
  await rename(written, index);
  await rm(partial, { recursive: true, force: true });
}
