// What the page needs to know about this computer before an edit: whether the analysis can run
// yet, and how much memory there is for the local speech model.
//
// In the desktop app (VIDEO_EDITOR_SETUP=1), the analysis's Python environment is not part of the
// installer: the server installs it on its first start with uv, from the worker's lockfile, and
// the page shows it like a model's download. From a clone, `pnpm start` has installed it already.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { totalmem } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { SETUP_DOWNLOAD } from "./i18n/en.ts";
import { secondsLeft } from "./jobs.ts";
import type { Asr } from "./settings.ts";

/** The local speech model's peak, about 9 GB, with room left for the system and the app: a
 * computer with less memory hears speech on OpenRouter unless its owner chooses otherwise. */
export const LOCAL_SPEECH_MEMORY = 12e9;

export function defaultAsr(memory = totalmem()): Asr {
  return memory < LOCAL_SPEECH_MEMORY ? "cloud" : "local";
}

export interface SetupState {
  /** "ready" once the analysis can run; "failed" says why in `error`. */
  state: "ready" | "installing" | "failed";
  /** What is downloading while it installs, as a model's download is shown. */
  download?: {
    name: string;
    bytes: number;
    total: number;
    secondsLeft?: number;
    bytesPerSecond?: number;
  };
  error?: string;
}

/** One line of uv's output: a package it starts downloading, with its size, or one it has. */
export function parseUvLine(
  line: string,
): { start: string; bytes: number } | { done: string } | null {
  const started = line.match(/^\s*Downloading (.+) \(([\d.]+)(B|KiB|MiB|GiB)\)\s*$/);
  if (started) {
    const unit = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3 }[started[3] as "B"];
    return { start: started[1] as string, bytes: Math.round(Number(started[2]) * unit) };
  }
  const done = line.match(/^\s*Downloaded (.+?)\s*$/);
  return done ? { done: done[1] as string } : null;
}

/** A hash of the worker's code and lockfile: when an update changes it, the worker is installed
 * again, as uv keeps a non-editable install of it as it is. The `fineframe` command compares it
 * with the stamp the install leaves (apps/desktop/src/server.ts). */
export async function workerVersion(worker: string): Promise<string> {
  const code = (await readdir(join(worker, "src"), { recursive: true }))
    .filter((file) => file.endsWith(".py"))
    .map((file) => join("src", file))
    .sort();
  const hash = createHash("sha256");
  for (const file of ["pyproject.toml", "uv.lock", ...code]) {
    hash.update(`${file}\0`).update(await readFile(join(worker, file)));
  }
  return hash.digest("hex");
}

export class Setup {
  #state: SetupState = { state: "installing" };
  #running: Promise<void> | null = null;
  readonly #worker: string;
  readonly #enabled: boolean;
  readonly #uv: readonly string[];

  /** `uv`: the program and its first arguments, uv on PATH unless given. */
  constructor(options: { worker: string; enabled: boolean; uv?: readonly string[] }) {
    this.#worker = options.worker;
    this.#enabled = options.enabled;
    this.#uv = options.uv ?? ["uv"];
    if (!this.#enabled) this.#state = { state: "ready" };
  }

  get state(): SetupState {
    return this.#state;
  }

  /** Installs the environment unless it is ready or installing; a failed one is tried again. */
  start(): void {
    if (!this.#enabled || this.#running || this.#state.state === "ready") return;
    this.#state = { state: "installing" };
    this.#running = this.#install()
      .then(() => {
        this.#state = { state: "ready" };
      })
      .catch((error: Error) => {
        this.#state = { state: "failed", error: error.message };
      })
      .finally(() => {
        this.#running = null;
      });
  }

  /** Settles once the environment is ready, or throws why it is not. */
  async ready(): Promise<void> {
    this.start();
    await this.#running;
    if (this.#state.state === "failed") throw new Error(this.#state.error);
  }

  async #install(): Promise<void> {
    // uv reads where the environment, its Python and its cache go from the desktop app's
    // environment (UV_PROJECT_ENVIRONMENT and the rest).
    const environment = process.env.UV_PROJECT_ENVIRONMENT;
    const stamp = environment ? join(environment, ".video-editor-worker") : null;
    const version = await workerVersion(this.#worker);
    const installed = stamp ? await readFile(stamp, "utf8").catch(() => "") : "";
    const python = (await readFile(join(this.#worker, "..", ".python-version"), "utf8")).trim();
    const args = ["sync", "--project", this.#worker, "--python", python];
    args.push("--frozen", "--no-dev", "--no-editable");
    if (installed && installed !== version) args.push("--reinstall-package", "vework");

    const sizes = new Map<string, number>();
    let bytes = 0;
    let started: { at: number; bytes: number } | null = null;
    const log: string[] = [];
    await new Promise<void>((done, fail) => {
      const [program, ...first] = this.#uv as [string, ...string[]];
      const child = spawn(program, [...first, ...args], {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true,
      });
      live.add(child.pid ?? 0);
      createInterface({ input: child.stderr }).on("line", (line) => {
        log.push(line);
        if (log.length > 40) log.shift();
        const parsed = parseUvLine(line);
        // Python itself comes first, alone: counted, it would show as the whole download until
        // the packages are announced, all at once, a moment later.
        if (!parsed || ("start" in parsed ? parsed.start : parsed.done).startsWith("cpython-")) {
          return;
        }
        if ("start" in parsed) sizes.set(parsed.start, parsed.bytes);
        else bytes += sizes.get(parsed.done) ?? 0;
        const total = [...sizes.values()].reduce((sum, size) => sum + size, 0);
        if (total === 0) return;
        const now = { at: Date.now(), bytes };
        started ??= now;
        const rate = secondsLeft(started, now, total);
        this.#state = {
          state: "installing",
          download: {
            name: SETUP_DOWNLOAD,
            bytes,
            total,
            ...(rate ? { secondsLeft: rate.seconds, bytesPerSecond: rate.bytesPerSecond } : {}),
          },
        };
      });
      child.once("error", (error) =>
        fail(new Error(`Could not run uv to set up the analysis: ${error.message}`)),
      );
      child.once("close", (code) => {
        live.delete(child.pid ?? 0);
        if (code === 0) done();
        else {
          console.error(`setup: uv exited with ${code}:\n${log.join("\n")}`);
          const offline = log.some((line) => /connect|dns|resolve|network|timed out/i.test(line));
          fail(
            new Error(
              offline
                ? "Could not download the analysis environment. Check the internet connection and try again"
                : `Setting up the analysis failed: ${log.at(-1) ?? `uv exited with ${code}`}`,
            ),
          );
        }
      });
    });
    if (stamp) await writeFile(stamp, version);
  }
}

/** Installs still running, stopped with the server, as an edit is. */
const live = new Set<number>();
process.on("exit", () => {
  for (const pid of live) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
});

/** The server's one setup, on globalThis as the job store is. It starts on the first request. */
export function setup(): Setup {
  const global = globalThis as { videoEditorSetup?: Setup };
  global.videoEditorSetup ??= new Setup({
    worker: resolve(process.cwd(), "../../worker"),
    enabled: process.env.VIDEO_EDITOR_SETUP === "1",
  });
  return global.videoEditorSetup;
}
