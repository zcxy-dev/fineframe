// The page's edits: each one's footage, settings, progress and outputs in a folder of its own.
// One server runs one edit at a time, as the machine's memory allows one analysis at a time.
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import type { ClaudeCost, Progress } from "@video-editor/schema";
import type { FixKind } from "./fixes.ts";
import { readKey } from "./key.ts";
import { safeRelativePath } from "./paths.ts";
import { type Run, runEdit } from "./runner.ts";
import { type FileEntry, type Role, roleOf, type Settings } from "./settings.ts";

export type Stage = "analyze" | "plan" | "render" | "check";
export const STAGES: readonly Stage[] = ["analyze", "plan", "render", "check"];

export type Status = "uploading" | "running" | "done" | "error" | "cancelled";

export interface JobFile extends FileEntry {
  use: Role;
  /** Bytes the server has of it. */
  received: number;
}

/** What the page shows of an edit; it is also what job.json keeps. */
export interface Job {
  id: string;
  /** Epoch milliseconds. */
  created: number;
  settings: Settings;
  files: JobFile[];
  status: Status;
  started?: number;
  finished?: number;
  /** When each stage began and ended, in epoch milliseconds. */
  stages: Partial<Record<Stage, { start: number; end?: number }>>;
  /** The latest line of a stage. */
  progress?: { stage: Stage; fraction: number; message: string; file?: string };
  /** A model downloading on its first use, while it downloads. */
  download?: { name: string; bytes: number; total: number; secondsLeft?: number };
  /** What Claude cost, by stage, once the edit is done or failed after a request. */
  claude?: ClaudeCost;
  result?: {
    message: string;
    captions: boolean;
    /** The music files the video plays, by their paths in the job. */
    music?: string[];
  };
  error?: string;
}

/** A request the job cannot take in its state; the message is for the page, and `code` names
 * what its owner can fix. */
export class JobError extends Error {
  readonly status: 400 | 403 | 404 | 409 | 507;
  readonly code: FixKind | undefined;
  constructor(message: string, status: 400 | 403 | 404 | 409 | 507, code?: FixKind) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export interface JobsOptions {
  /** Where each job's folder goes. */
  root: string;
  /** The edit command: a program and its first arguments. */
  command: readonly string[];
  /** The Anthropic API key the edit uses, read when an edit is created and started. */
  key: () => Promise<string | undefined>;
}

/** Seconds a download has left at its rate since it started; undefined until it can say. */
export function secondsLeft(
  start: { at: number; bytes: number },
  now: { at: number; bytes: number },
  total: number,
): number | undefined {
  const elapsed = now.at - start.at;
  const arrived = now.bytes - start.bytes;
  // The first seconds' rate says little: connections are still opening.
  if (elapsed < 3000 || arrived <= 0) return undefined;
  return ((total - now.bytes) * elapsed) / arrived / 1000;
}

const VIDEO = join("out", "edit.mp4");
const CAPTIONS = join("out", "edit.srt");
const PROJECT = join("out", "edit.project.json");
/** stderr lines kept with a failed edit, for a person to read in edit.log. */
const LOG = "edit.log";

export class Jobs {
  readonly #root: string;
  readonly #command: readonly string[];
  readonly #key: () => Promise<string | undefined>;
  /** Where each running job's current download started, for its time left. */
  readonly #downloads = new Map<string, { name: string; at: number; bytes: number }>();
  readonly #jobs = new Map<string, Job>();
  readonly #runs = new Map<string, Run>();
  readonly #listeners = new Map<string, Set<(job: Job) => void>>();
  readonly #loaded: Promise<void>;

  constructor(options: JobsOptions) {
    this.#root = resolve(options.root);
    this.#command = options.command;
    this.#key = options.key;
    this.#loaded = this.#load();
  }

  /** Jobs an earlier server left; one it was running or receiving did not finish. */
  async #load(): Promise<void> {
    await mkdir(this.#root, { recursive: true });
    for (const id of await readdir(this.#root)) {
      const text = await readFile(join(this.#root, id, "job.json"), "utf8").catch(() => null);
      if (!text) continue;
      const job = JSON.parse(text) as Job;
      if (job.status === "running" || job.status === "uploading") {
        job.status = "error";
        job.error = "The server stopped before this edit finished. Start it again.";
        await this.#save(job);
      }
      this.#jobs.set(job.id, job);
    }
  }

  async create(settings: Settings, entries: readonly FileEntry[]): Promise<Job> {
    await this.#loaded;
    // Refused now rather than at start, before the page sends any footage.
    this.#refuseWhileRunning();
    await this.#requireKey();
    const files: JobFile[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      const path = safeRelativePath(entry.path);
      if (!path) throw new JobError(`${entry.path}: not a file name the page can keep`, 400);
      if (seen.has(path)) throw new JobError(`${path}: given twice`, 400);
      seen.add(path);
      const use = roleOf(path);
      if (!use) {
        throw new JobError(
          `${path}: not a video, a still image or music. Leave it out, or convert it to MP4`,
          400,
          "file",
        );
      }
      if (!Number.isSafeInteger(entry.size) || entry.size <= 0) {
        throw new JobError(`${path}: empty`, 400);
      }
      files.push({ path, size: entry.size, use, received: 0 });
    }
    if (!files.some((file) => file.use === "video")) {
      throw new JobError("An edit is cut from video: add at least one video file", 400);
    }
    if (files.some((file) => file.use === "music") && !settings.musicLicense) {
      throw new JobError("Say under which licence you use the music, such as CC0 1.0", 400);
    }
    await this.#prune();
    const { bavail, bsize } = await statfs(this.#root);
    const needed = files.reduce((sum, file) => sum + file.size, 0);
    // The edit's work files and outputs need room too; footage the size of what is left would
    // fail halfway through the render instead of now.
    if (needed * 1.2 > bavail * bsize) {
      throw new JobError(
        `Not enough free disk space for this footage: it needs about ${gigabytes(needed * 1.2)} ` +
          `and ${gigabytes(bavail * bsize)} is free. Free some space, or leave some files out`,
        507,
        "disk",
      );
    }
    const job: Job = {
      id: randomUUID(),
      created: Date.now(),
      settings,
      files,
      status: "uploading",
      stages: {},
    };
    this.#jobs.set(job.id, job);
    await mkdir(join(this.#dir(job), "footage"), { recursive: true });
    await this.#save(job);
    return job;
  }

  /** Each earlier job's footage, which only its own edit reads; its outputs stay. */
  async #prune(): Promise<void> {
    for (const job of this.#jobs.values()) {
      if (job.status === "running") continue;
      if (job.status === "uploading") {
        job.status = "cancelled";
        await this.#save(job);
      }
      await rm(join(this.#dir(job), "footage"), { recursive: true, force: true });
    }
  }

  async get(id: string): Promise<Job> {
    await this.#loaded;
    const job = this.#jobs.get(id);
    if (!job) throw new JobError("No such edit", 404);
    return job;
  }

  /** The newest job, which is the one the page shows when it opens. */
  async latest(): Promise<Job | null> {
    await this.#loaded;
    let latest: Job | null = null;
    for (const job of this.#jobs.values()) {
      if (!latest || job.created > latest.created) latest = job;
    }
    return latest;
  }

  /** Writes the request body as the job's file `index`, which must arrive whole. */
  async receive(id: string, index: number, body: ReadableStream<Uint8Array>): Promise<Job> {
    const job = await this.get(id);
    if (job.status !== "uploading") throw new JobError("This edit takes no more files", 409);
    const file = job.files[index];
    if (!file) throw new JobError("No such file in this edit", 404);
    const path = join(this.#dir(job), "footage", file.path);
    await mkdir(dirname(path), { recursive: true });
    file.received = 0;
    const count = new Transform({
      transform: (chunk: Buffer, _encoding, done) => {
        file.received += chunk.length;
        if (file.received > file.size) done(new JobError(`${file.path}: larger than said`, 400));
        else done(null, chunk);
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(body as NodeReadableStream<Uint8Array>),
        count,
        createWriteStream(`${path}.part`),
      );
      if (file.received !== file.size) {
        throw new JobError(`${file.path}: arrived incomplete; drop it again`, 400);
      }
      await rename(`${path}.part`, path);
    } catch (error) {
      file.received = 0;
      await rm(`${path}.part`, { force: true });
      throw error;
    }
    this.#emit(job);
    return job;
  }

  /** Starts the edit once every file has arrived. */
  async start(id: string): Promise<Job> {
    const job = await this.get(id);
    const key = await this.#requireKey();
    if (job.status !== "uploading") throw new JobError("This edit has already started", 409);
    const missing = job.files.find((file) => file.received !== file.size);
    if (missing) throw new JobError(`${missing.path} has not arrived yet`, 409);
    this.#refuseWhileRunning();
    // Running from here, before the next await, so a second start at the same moment is refused.
    job.status = "running";
    job.started = Date.now();
    const dir = this.#dir(job);
    const { length, aspect, style, names, musicLicense } = job.settings;
    const footage = (file: JobFile) => join("footage", file.path);
    const music = job.files.filter((file) => file.use === "music");
    const args = [
      ...job.files.filter((file) => file.use !== "music").map(footage),
      "--length",
      String(length),
      "--aspect",
      aspect,
      "--look",
      style,
      "-o",
      VIDEO,
      ...music.flatMap((file) => ["--music", footage(file)]),
      // Joined, so a licence starting with "-" is not read as an option.
      ...(music.length > 0 && musicLicense ? [`--music-license=${musicLicense}`] : []),
    ];
    try {
      if (names.length > 0) {
        await writeFile(join(dir, "names.txt"), `${names.join("\n")}\n`);
        args.push("--names", "names.txt");
      }
      await this.#save(job);
    } catch (error) {
      job.status = "error";
      job.error = "The server could not prepare this edit";
      throw error;
    }
    const log: string[] = [];
    const run = runEdit({
      command: this.#command,
      args,
      cwd: dir,
      // The key the page saved, over any the server's environment holds.
      env: { ANTHROPIC_API_KEY: key },
      onProgress: (line) => this.#progress(job, line),
      onLog: (line) => log.push(line),
    });
    this.#runs.set(job.id, run);
    this.#emit(job);
    void run.exited
      .then(({ code }) => this.#finish(job, code, log))
      .catch((error: Error) => this.#finish(job, null, [...log, error.message]));
    return job;
  }

  async #requireKey(): Promise<string> {
    const key = await this.#key();
    if (!key)
      throw new JobError("Add your Anthropic API key first: Claude plans the edit", 400, "key");
    return key;
  }

  #refuseWhileRunning(): void {
    if ([...this.#jobs.values()].some((other) => other.status === "running")) {
      throw new JobError("Another edit is running; wait for it to finish or cancel it", 409);
    }
  }

  #progress(job: Job, line: Progress): void {
    const now = Date.now();
    if (line.claude) job.claude = line.claude;
    if ("download" in line && line.download) {
      const { name, bytes, total } = line.download;
      let start = this.#downloads.get(job.id);
      if (start?.name !== name) {
        start = { name, at: now, bytes };
        this.#downloads.set(job.id, start);
      }
      const left = secondsLeft(start, { at: now, bytes }, total);
      job.download = { name, bytes, total, ...(left === undefined ? {} : { secondsLeft: left }) };
    } else {
      delete job.download;
      this.#downloads.delete(job.id);
    }
    if (line.stage === "done") {
      job.result = { message: line.message, captions: line.outputs.captions !== undefined };
    } else if (line.stage === "error") {
      job.error = line.message;
    } else {
      const stage = line.stage;
      if (!job.stages[stage]) {
        for (const other of Object.values(job.stages)) other.end ??= now;
        job.stages[stage] = { start: now };
      }
      job.progress = {
        stage,
        // The bar never goes back, whatever a stage reports.
        fraction: Math.max(job.progress?.fraction ?? 0, line.fraction),
        message: line.message,
        ...(line.file ? { file: line.file } : {}),
      };
    }
    this.#emit(job);
  }

  async #finish(job: Job, code: number | null, log: readonly string[]): Promise<void> {
    this.#runs.delete(job.id);
    this.#downloads.delete(job.id);
    delete job.download;
    const now = Date.now();
    job.finished = now;
    for (const stage of Object.values(job.stages)) stage.end ??= now;
    const dir = this.#dir(job);
    if (job.status === "cancelled") {
      // Nothing of a cancelled edit is worth keeping.
    } else if (code === 0 && job.result && existsSync(join(dir, VIDEO))) {
      // The result is settled before the job reads as done, so the page never offers what is
      // not there.
      // Captions with no lines, when no speech is kept, are not worth a download.
      const captions = await stat(join(dir, CAPTIONS)).catch(() => null);
      job.result.captions = (captions?.size ?? 0) > 0;
      if (job.files.some((file) => file.use === "music")) {
        // Unknown, rather than none, when the project cannot be read.
        const played = await playedMusic(dir).catch(() => null);
        if (played) job.result.music = played;
      }
      job.status = "done";
    } else {
      job.status = "error";
      job.error ??= `The edit stopped unexpectedly${code === null ? "" : ` (exit code ${code})`}`;
    }
    if (job.status !== "done") await writeFile(join(dir, LOG), `${log.join("\n")}\n`);
    await this.#save(job);
    this.#emit(job);
  }

  /** Stops a running edit, or drops one whose files are still arriving. */
  async cancel(id: string): Promise<Job> {
    const job = await this.get(id);
    if (job.status !== "running" && job.status !== "uploading") return job;
    const wasRunning = job.status === "running";
    job.status = "cancelled";
    job.finished = Date.now();
    if (wasRunning) this.#runs.get(job.id)?.stop();
    await rm(join(this.#dir(job), "footage"), { recursive: true, force: true });
    await this.#save(job);
    this.#emit(job);
    return job;
  }

  /** The finished video, or its captions as SubRip; null until the edit is done. */
  async output(id: string, kind: "video" | "captions"): Promise<string | null> {
    const job = await this.get(id);
    if (job.status !== "done") return null;
    const path = join(this.#dir(job), kind === "video" ? VIDEO : CAPTIONS);
    return existsSync(path) ? path : null;
  }

  /** Calls `listener` with the job after every change; returns the call that stops it. */
  subscribe(id: string, listener: (job: Job) => void): () => void {
    let set = this.#listeners.get(id);
    if (!set) {
      set = new Set();
      this.#listeners.set(id, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }

  #emit(job: Job): void {
    for (const listener of this.#listeners.get(job.id) ?? []) listener(job);
  }

  #dir(job: Job): string {
    return join(this.#root, job.id);
  }

  async #save(job: Job): Promise<void> {
    const path = join(this.#dir(job), "job.json");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(`${path}.tmp`, JSON.stringify(job));
    await rename(`${path}.tmp`, path);
  }
}

/** The music files the project in `dir` plays, in the order they first play, by their paths
 * under footage/. */
async function playedMusic(dir: string): Promise<string[]> {
  const project = JSON.parse(await readFile(join(dir, PROJECT), "utf8")) as {
    sources: { id: string; path: string }[];
    audio: { music?: { source: string; start: number }[] };
  };
  const ranges = [...(project.audio.music ?? [])].sort((a, b) => a.start - b.start);
  const paths = ranges.flatMap((range) => {
    const source = project.sources.find((each) => each.id === range.source);
    if (!source) return [];
    const path = relative(join(dir, "footage"), resolve(dir, dirname(VIDEO), source.path));
    return [path.split(sep).join("/")];
  });
  return [...new Set(paths)];
}

function gigabytes(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/** Where jobs go unless VIDEO_EDITOR_JOBS says otherwise: beside the engine's own cache. */
export function defaultRoot(): string {
  return process.env.VIDEO_EDITOR_JOBS ?? join(homedir(), ".cache", "video-editor", "jobs");
}

/** The server's one store. Each route is bundled on its own, so the store lives on globalThis
 * for every route to find the same one. */
export function jobs(): Jobs {
  const global = globalThis as { videoEditorJobs?: Jobs };
  global.videoEditorJobs ??= new Jobs({
    root: defaultRoot(),
    key: readKey,
    command: [
      process.execPath,
      process.env.VIDEO_EDITOR_EDIT_CLI ??
        resolve(process.cwd(), "../../packages/engine/src/edit/cli.ts"),
    ],
  });
  return global.videoEditorJobs;
}
