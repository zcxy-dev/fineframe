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
import {
  editLength,
  OVERLAY_TEXT,
  placeSources,
  type Revision,
  removables,
  revise,
} from "@video-editor/engine/revise";
import {
  type ClaudeCost,
  loadJson,
  type Progress,
  type Project,
  type StageProgress,
  TICKS_PER_SECOND,
  validateProject,
} from "@video-editor/schema";
import { Finish } from "./eta.ts";
import type { FixKind } from "./fixes.ts";
import { readKey, type Service, VARIABLES } from "./key.ts";
import { safeRelativePath } from "./paths.ts";
import { FOOTAGE_KEPT } from "./retention.ts";
import { type Run, runEdit } from "./runner.ts";
import {
  DEFAULT_CAPTIONS,
  type FileEntry,
  formatLength,
  LENGTH_RANGE,
  type Role,
  roleOf,
  type Settings,
} from "./settings.ts";
import { type Version, versionFiles, videosToPrune } from "./versions.ts";

export type Stage = "analyze" | "plan" | "render" | "check";

type Status = "uploading" | "running" | "done" | "error" | "cancelled";

interface JobFile extends FileEntry {
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
  /** The latest line of a stage, with the analysis's step for the file it names. */
  progress?: {
    stage: Stage;
    fraction: number;
    message: string;
    file?: string;
    step?: StageProgress["step"];
  };
  /** When the edit will likely finish, in epoch milliseconds, at the rate it has gone so far;
   * once there is enough to go on. */
  finish?: number;
  /** A model downloading on its first use, while it downloads. */
  download?: { name: string; bytes: number; total: number; secondsLeft?: number };
  /** What Claude cost, by stage, once the edit is done or failed after a request. */
  claude?: ClaudeCost;
  result?: {
    message: string;
    captions: boolean;
    /** The music files the video plays, by their paths in the job. */
    music?: string[];
    /** Whether the edit wrote the credits of the B-roll it shows. */
    broll?: boolean;
  };
  error?: string;
  /** Each rendered version of a finished edit, oldest first; absent until the first Apply, when
   * there is only the edit itself. */
  versions?: Version[];
  /** The version the page shows; 1 unless another was chosen. */
  current?: number;
  /** A version rendering, while it renders, or why it failed. */
  render?: {
    version: number;
    /** A version being made, rather than an older one rendering again. */
    fresh: boolean;
    fraction: number;
    message: string;
    error?: string;
  };
}

/** What a re-plan changes, as the page asks for it. */
export interface ReplanChoice {
  length: number;
  aspect: Settings["aspect"];
  /** A track the edit was offered, by its path, "auto" for Claude to choose among them again,
   * or "none". */
  music: string;
  /** What the user asks of the new plan, in their words. */
  instructions?: string;
}

/** The longest instructions, as `pnpm edit --instructions` takes them. */
const INSTRUCTIONS_MAX = 2000;

/** A re-plan as the page sends it, or what is wrong with it. */
export function checkReplan(value: unknown): ReplanChoice | string {
  const choice = (value ?? {}) as Partial<ReplanChoice>;
  const [shortest, longest] = LENGTH_RANGE;
  if (
    typeof choice.length !== "number" ||
    !Number.isFinite(choice.length) ||
    choice.length < shortest ||
    choice.length > longest
  ) {
    return `The length is ${shortest} s to ${longest / 3600} h`;
  }
  if (!["9:16", "1:1", "16:9"].includes(choice.aspect as string)) {
    return "The aspect is 9:16, 1:1 or 16:9";
  }
  if (typeof choice.music !== "string" || !choice.music) return "Say which music to use";
  const instructions = typeof choice.instructions === "string" ? choice.instructions.trim() : "";
  if (instructions.length > INSTRUCTIONS_MAX) {
    return `Tell Claude what to change in at most ${INSTRUCTIONS_MAX} characters`;
  }
  return {
    length: choice.length,
    aspect: choice.aspect as Settings["aspect"],
    music: choice.music,
    ...(instructions ? { instructions } : {}),
  };
}

/** What one plan of an edit is for: its length, aspect, the music offered and what the user
 * asks of it. */
interface EditPlan {
  length: number;
  aspect: Settings["aspect"];
  music: JobFile[];
  instructions?: string;
}

/** What the re-edit panel shows of one version, in output ticks. */
export interface EditView {
  version: number;
  /** Ticks. */
  length: number;
  /** Whether the footage is kept, which every change needs. */
  footage: boolean;
  lines: { text: string; words: { text: string; start: number; end: number }[] }[];
  removables: ReturnType<typeof removables>;
  /** Titles and lower thirds, whose text can change, by their index in the overlays. */
  titles: {
    index: number;
    template: "title" | "lower-third";
    params: Record<string, string>;
    /** The longest each text param may be. */
    limits: Record<string, number>;
  }[];
  /** The music's level, by its first track; null without music. */
  music: { gainDb: number } | null;
  look: string;
  captions: string | null;
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
  /** The render command, `pnpm render`'s: a program and its first arguments. */
  renderCommand: readonly string[];
  /** The API key the edit uses for each service, read when an edit is created and started. */
  key: (service: Service) => Promise<string | undefined>;
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

const VIDEO = versionFiles(1).video;
/** stderr lines kept with a failed edit, for a person to read in edit.log. */
const LOG = "edit.log";

/** What the project list shows of an edit. */
export interface ProjectSummary {
  id: string;
  created: number;
  status: Status;
  length: number;
  aspect: Settings["aspect"];
  /** Its first video's path, to tell projects apart. */
  name: string;
  /** Bytes its folder takes on disk. */
  bytes: number;
  /** Whether its footage is still kept, which editing it again needs. */
  footage: boolean;
}

/** The ids of the jobs whose footage goes so that only the newest `keep` finished edits keep
 * theirs, to be edited again. A running edit reads its footage, so it keeps it and counts among
 * them; a failed or cancelled one cannot be edited again, as the page sends the footage anew. */
export function footageToPrune(
  jobs: readonly Pick<Job, "id" | "created" | "status">[],
  keep: number,
): string[] {
  const held = jobs
    .filter((job) => job.status === "running" || job.status === "done")
    .sort((a, b) => b.created - a.created);
  const kept = new Set(held.slice(0, keep).map((job) => job.id));
  for (const job of held) if (job.status === "running") kept.add(job.id);
  return jobs.filter((job) => !kept.has(job.id)).map((job) => job.id);
}

/** Bytes the files under `path` take; 0 for one that is gone. */
async function diskUsage(path: string): Promise<number> {
  const entries = await readdir(path, { withFileTypes: true, recursive: true }).catch(() => []);
  const sizes = await Promise.all(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) =>
        stat(join(entry.parentPath, entry.name)).then(
          (info) => info.size,
          () => 0,
        ),
      ),
  );
  return sizes.reduce((sum, size) => sum + size, 0);
}

export class Jobs {
  readonly #root: string;
  readonly #command: readonly string[];
  readonly #renderCommand: readonly string[];
  readonly #key: (service: Service) => Promise<string | undefined>;
  /** Where each running job's current download started, for its time left. */
  readonly #downloads = new Map<string, { name: string; at: number; bytes: number }>();
  /** Each running job's estimate of when it finishes. */
  readonly #finishes = new Map<string, Finish>();
  readonly #jobs = new Map<string, Job>();
  readonly #runs = new Map<string, Run>();
  /** Jobs whose render was stopped, until it exits. */
  readonly #stopped = new Set<string>();
  readonly #listeners = new Map<string, Set<(job: Job) => void>>();
  /** Each job's latest write of job.json, which the next one waits for. */
  readonly #saving = new Map<string, Promise<void>>();
  readonly #loaded: Promise<void>;

  constructor(options: JobsOptions) {
    this.#root = resolve(options.root);
    this.#command = options.command;
    this.#renderCommand = options.renderCommand;
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
      if (job.render && !job.render.error) {
        if (job.render.fresh)
          job.versions = job.versions?.filter((v) => v.n !== job.render?.version);
        job.render.error = "The server stopped before this version finished rendering";
        await this.#save(job);
      }
      this.#jobs.set(job.id, job);
    }
  }

  async create(settings: Settings, entries: readonly FileEntry[]): Promise<Job> {
    await this.#loaded;
    // Refused now rather than at start, before the page sends any footage.
    this.#refuseWhileRunning();
    await this.#requireKeys(settings);
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

  /** The footage of all but the newest projects, with the one about to be created making
   * FOOTAGE_KEPT; their outputs stay. One whose files were still arriving cannot go on: the
   * browser no longer has them. */
  async #prune(): Promise<void> {
    for (const job of this.#jobs.values()) {
      if (job.status !== "uploading") continue;
      job.status = "cancelled";
      await this.#save(job);
    }
    for (const id of footageToPrune([...this.#jobs.values()], FOOTAGE_KEPT - 1)) {
      await rm(join(this.#root, id, "footage"), { recursive: true, force: true });
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

  /** Every project, newest first, with the disk space its folder takes. */
  async list(): Promise<ProjectSummary[]> {
    await this.#loaded;
    const jobs = [...this.#jobs.values()].sort((a, b) => b.created - a.created);
    return Promise.all(
      jobs.map(async (job) => ({
        id: job.id,
        created: job.created,
        status: job.status,
        length: job.settings.length,
        aspect: job.settings.aspect,
        name: job.files.find((file) => file.use === "video")?.path ?? "",
        bytes: await diskUsage(this.#dir(job)),
        footage: existsSync(join(this.#dir(job), "footage")),
      })),
    );
  }

  /** Deletes a project's folder: its footage, outputs and settings. */
  async remove(id: string): Promise<void> {
    const job = await this.get(id);
    if (
      job.status === "running" ||
      job.status === "uploading" ||
      (job.render !== undefined && !job.render.error)
    ) {
      throw new JobError("This edit is under way; cancel it before deleting it", 409);
    }
    this.#jobs.delete(job.id);
    this.#listeners.delete(job.id);
    // A write still under way would put job.json back into the folder deleted.
    await this.#saving.get(job.id)?.catch(() => {});
    this.#saving.delete(job.id);
    await rm(this.#dir(job), { recursive: true, force: true });
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
    const keys = await this.#requireKeys(job.settings);
    if (job.status !== "uploading") throw new JobError("This edit has already started", 409);
    const missing = job.files.find((file) => file.received !== file.size);
    if (missing) throw new JobError(`${missing.path} has not arrived yet`, 409);
    this.#refuseWhileRunning();
    // Running from here, before the next await, so a second start at the same moment is refused.
    job.status = "running";
    job.started = Date.now();
    const dir = this.#dir(job);
    const { length, aspect } = job.settings;
    const music = job.files.filter((file) => file.use === "music");
    let args: string[];
    try {
      args = await this.#editArgs(job, { length, aspect, music }, VIDEO);
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
      // The keys the page saved, over any the server's environment holds.
      env: keys,
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

  /** `pnpm edit`'s arguments for `job` planned as `plan` says, writing to `output`, and the
   * names and terms files they name, written into the job's folder. */
  async #editArgs(job: Job, plan: EditPlan, output: string): Promise<string[]> {
    const { style, names, terms = [], musicLicense, visuals } = job.settings;
    const footage = (file: JobFile) => join("footage", file.path);
    const args = [
      ...job.files.filter((file) => file.use !== "music").map(footage),
      "--length",
      String(plan.length),
      "--aspect",
      plan.aspect,
      "--look",
      style,
      `--visuals=${visuals}`,
      ...["--quality", job.settings.quality ?? "best"],
      ...(job.settings.correct ? ["--correct"] : []),
      ...["--captions", job.settings.captions ?? DEFAULT_CAPTIONS],
      "-o",
      output,
      ...plan.music.flatMap((file) => ["--music", footage(file)]),
      // Joined, so a licence or instructions starting with "-" are not read as options.
      ...(plan.music.length > 0 && musicLicense ? [`--music-license=${musicLicense}`] : []),
      ...(plan.instructions ? [`--instructions=${plan.instructions}`] : []),
      ...(job.settings.asr === "cloud" ? ["--asr", "cloud"] : []),
    ];
    for (const [option, list] of [
      ["names", names],
      ["terms", terms],
    ] as const) {
      if (list.length === 0) continue;
      await writeFile(join(this.#dir(job), `${option}.txt`), `${list.join("\n")}\n`);
      args.push(`--${option}`, `${option}.txt`);
    }
    return args;
  }

  /** The keys an edit with `settings` needs, and the optional stock footage ones it can use, as
   * the edit's environment reads them. */
  async #requireKeys(settings: Settings): Promise<Record<string, string>> {
    const key = await this.#key("anthropic");
    if (!key)
      throw new JobError("Add your Anthropic API key first: Claude plans the edit", 400, "key");
    const keys: Record<string, string> = { ANTHROPIC_API_KEY: key };
    if (settings.asr === "cloud") {
      const openrouter = await this.#key("openrouter");
      if (!openrouter) {
        throw new JobError(
          "Add your OpenRouter API key first: it hears the speech, or choose this computer",
          400,
          "openrouter",
        );
      }
      keys.OPENROUTER_API_KEY = openrouter;
    }
    if (settings.visuals === "rich") {
      for (const service of ["pexels", "pixabay"] as const) {
        const stock = await this.#key(service);
        if (stock) keys[VARIABLES[service]] = stock;
      }
    }
    return keys;
  }

  #refuseWhileRunning(): void {
    if ([...this.#jobs.values()].some((other) => other.status === "running")) {
      throw new JobError("Another edit is running; wait for it to finish or cancel it", 409);
    }
    if ([...this.#jobs.values()].some((other) => other.render && !other.render.error)) {
      throw new JobError("A version is rendering; wait for it to finish or stop it", 409);
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
      job.result = {
        message: line.message,
        captions: line.outputs.captions !== undefined,
        broll: line.outputs.broll !== undefined,
      };
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
        ...(line.step ? { step: line.step } : {}),
      };
      let finish = this.#finishes.get(job.id);
      if (!finish) {
        finish = new Finish(job.settings.length);
        this.#finishes.set(job.id, finish);
      }
      const estimate = finish.update(now, job.progress.fraction, stage, job.download !== undefined);
      if (estimate !== undefined) job.finish = Math.round(estimate);
    }
    this.#emit(job);
  }

  async #finish(job: Job, code: number | null, log: readonly string[]): Promise<void> {
    this.#runs.delete(job.id);
    this.#downloads.delete(job.id);
    this.#finishes.delete(job.id);
    delete job.download;
    delete job.finish;
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
      await this.#settle(job, 1);
      job.status = "done";
    } else {
      job.status = "error";
      job.error ??= `The edit stopped unexpectedly${code === null ? "" : ` (exit code ${code})`}`;
    }
    if (job.status !== "done") await writeFile(join(dir, LOG), `${log.join("\n")}\n`);
    await this.#save(job);
    this.#emit(job);
  }

  /** What the page offers of version `n`, from its files: the captions, the B-roll credits and
   * the music it plays. */
  async #settle(job: Job, n: number): Promise<void> {
    if (!job.result) return;
    const dir = this.#dir(job);
    const files = versionFiles(n);
    // Captions with no lines, when no speech is kept, are not worth a download.
    const captions = await stat(join(dir, files.captions)).catch(() => null);
    job.result.captions = (captions?.size ?? 0) > 0;
    job.result.broll = existsSync(join(dir, files.broll));
    if (job.files.some((file) => file.use === "music")) {
      // Unknown, rather than none, when the project cannot be read.
      const played = await playedMusic(dir, files.project).catch(() => null);
      if (played) job.result.music = played;
      else delete job.result.music;
    }
  }

  /** The versions of a finished edit, oldest first. */
  #versions(job: Job): Version[] {
    job.versions ??= [
      { n: 1, created: job.finished ?? job.created, summary: "The edit", video: true },
    ];
    return job.versions;
  }

  async #project(job: Job, n: number): Promise<{ project: Project; path: string }> {
    const path = join(this.#dir(job), versionFiles(n).project);
    return { project: await loadJson(path, validateProject), path };
  }

  /** A finished edit's version `n` (the one shown unless given), with what can change in it. */
  async view(id: string, n?: number): Promise<EditView> {
    const job = await this.#finished(id);
    const version = n ?? job.current ?? 1;
    if (!this.#versions(job).some((each) => each.n === version)) {
      throw new JobError("No such version", 404);
    }
    const { project } = await this.#project(job, version);
    const firstLook = project.main.find((clip) => clip.grade?.look)?.grade?.look?.id;
    return {
      version,
      length: editLength(project),
      footage: existsSync(join(this.#dir(job), "footage")),
      lines: (project.captions?.lines ?? []).map((line) => ({
        text: line.text,
        words: (line.words ?? []).map(({ text, start, end }) => ({ text, start, end })),
      })),
      removables: removables(project),
      titles: (project.overlays ?? []).flatMap((overlay, index) =>
        overlay.template === "title" || overlay.template === "lower-third"
          ? [
              {
                index,
                template: overlay.template,
                params: stringParams(overlay.params),
                limits: OVERLAY_TEXT[overlay.template],
              },
            ]
          : [],
      ),
      music: project.audio.music?.[0] ? { gainDb: project.audio.music[0].gainDb ?? 0 } : null,
      look: firstLook ?? "none",
      captions: project.captions?.preset ?? null,
    };
  }

  /** What `revision` would do to the version shown, without rendering it: where its cuts land
   * and the length it leaves. */
  async preview(id: string, revision: Revision) {
    const job = await this.#finished(id);
    const { project, path } = await this.#project(job, job.current ?? 1);
    try {
      const { length, removed, notes, outside } = revise(
        project,
        revision,
        await wordsFor(revision, project, path),
      );
      return { length, removed, notes, outside };
    } catch (error) {
      throw new JobError((error as Error).message, 400);
    }
  }

  /** Makes the next version from the one shown with `revision`, and renders it; the one shown
   * stays until it is done. */
  async revise(id: string, revision: Revision, summary: string): Promise<Job> {
    const job = await this.#finished(id);
    this.#refuseWhileRunning();
    this.#requireFootage(job);
    const from = job.current ?? 1;
    const versions = this.#versions(job);
    const n = Math.max(...versions.map((version) => version.n)) + 1;
    // Busy from here, before the next await, so a second Apply at the same moment is refused.
    job.render = { version: n, fresh: true, fraction: 0, message: "Preparing the changes" };
    try {
      const { project, path } = await this.#project(job, from);
      let revised: Project;
      try {
        revised = revise(project, revision, await wordsFor(revision, project, path)).project;
      } catch (error) {
        throw new JobError((error as Error).message, 400);
      }
      // Beside the version it came from, so its relative paths still resolve.
      const record = join(this.#dir(job), versionFiles(n).project);
      await writeFile(record, `${JSON.stringify(revised, null, 2)}\n`);
    } catch (error) {
      delete job.render;
      throw error;
    }
    versions.push({ n, created: Date.now(), summary, from, video: false });
    this.#render(job, n, true);
    return job;
  }

  /** Plans the edit again from the same footage, its analysis cached, as the next version: at
   * another length or aspect, with other music, or with what the user asks of it. The version
   * shown stays until the new one is done. */
  async replan(id: string, choice: ReplanChoice): Promise<Job> {
    const job = await this.#finished(id);
    const keys = await this.#requireKeys(job.settings);
    this.#refuseWhileRunning();
    this.#requireFootage(job);
    const offered = job.files.filter((file) => file.use === "music");
    const music =
      choice.music === "auto"
        ? offered
        : choice.music === "none"
          ? []
          : offered.filter((file) => file.path === choice.music);
    if (choice.music !== "auto" && choice.music !== "none" && music.length === 0) {
      throw new JobError("That music track is not one this edit was offered", 400);
    }
    const versions = this.#versions(job);
    const n = Math.max(...versions.map((version) => version.n)) + 1;
    // Busy from here, before the next await, so a second request at the same moment is refused.
    job.render = { version: n, fresh: true, fraction: 0, message: "Planning again" };
    const files = versionFiles(n);
    let args: string[];
    try {
      args = await this.#editArgs(
        job,
        {
          length: choice.length,
          aspect: choice.aspect,
          music,
          ...(choice.instructions ? { instructions: choice.instructions } : {}),
        },
        files.video,
      );
    } catch (error) {
      delete job.render;
      throw error;
    }
    const version: Version = {
      n,
      created: Date.now(),
      summary: [
        `Planned again: ${formatLength(choice.length)}, ${choice.aspect}`,
        ...(choice.music === "none"
          ? ["no music"]
          : choice.music === "auto"
            ? []
            : [choice.music.split("/").at(-1) as string]),
        ...(choice.instructions ? ["with instructions"] : []),
      ].join(", "),
      from: job.current ?? 1,
      video: false,
      length: choice.length,
      aspect: choice.aspect,
    };
    versions.push(version);
    const log: string[] = [];
    let failed: string | undefined;
    const run = runEdit({
      command: this.#command,
      args,
      cwd: this.#dir(job),
      env: keys,
      onProgress: (line) => {
        if (line.claude) {
          const { plan, check } = line.claude;
          if (plan.dollars !== null && check.dollars !== null) {
            version.claude = plan.dollars + check.dollars;
          }
        }
        if (line.stage === "error") failed = line.message;
        if (line.stage === "done" || line.stage === "error" || !job.render) return;
        job.render.fraction = Math.max(job.render.fraction, line.fraction);
        job.render.message = line.message;
        this.#emit(job);
      },
      onLog: (line) => log.push(line),
    });
    this.#runs.set(job.id, run);
    await this.#save(job);
    this.#emit(job);
    void run.exited
      .then(({ code }) => this.#rendered(job, n, code, log, failed))
      .catch((error: Error) => this.#rendered(job, n, null, [...log, error.message], failed));
    return job;
  }

  /** Shows version `n`, rendering it again from its record when its video was not kept. */
  async show(id: string, n: number): Promise<Job> {
    const job = await this.#finished(id);
    const version = this.#versions(job).find((each) => each.n === n);
    if (!version) throw new JobError("No such version", 404);
    if (version.video && existsSync(join(this.#dir(job), versionFiles(n).video))) {
      job.current = n;
      await this.#settle(job, n);
      await this.#keepVideos(job);
      await this.#save(job);
      this.#emit(job);
      return job;
    }
    this.#refuseWhileRunning();
    this.#requireFootage(job);
    this.#render(job, n, false);
    return job;
  }

  async #finished(id: string): Promise<Job> {
    const job = await this.get(id);
    if (job.status !== "done") throw new JobError("Only a finished edit can change", 409);
    return job;
  }

  /** Refuses a render without the footage it plays. */
  #requireFootage(job: Job): void {
    if (!existsSync(join(this.#dir(job), "footage"))) {
      throw new JobError(
        `This project's footage was deleted, as only the newest ${FOOTAGE_KEPT} keep theirs; ` +
          "make a new edit from the footage instead",
        409,
      );
    }
  }

  /** Renders version `n` from its record with \`pnpm render\`, in a process of its own as an
   * edit runs, and shows it once done. */
  #render(job: Job, n: number, fresh: boolean): void {
    const files = versionFiles(n);
    job.render = { version: n, fresh, fraction: 0, message: "Starting the render" };
    const log: string[] = [];
    const run = runEdit({
      command: this.#renderCommand,
      args: [files.project, "-o", files.video],
      cwd: this.#dir(job),
      onProgress: () => {},
      onLog: (line) => {
        log.push(line);
        const match = line.match(/^(\d+)% (.*)$/);
        if (!match || !job.render) return;
        job.render.fraction = Math.max(job.render.fraction, Number(match[1]) / 100);
        job.render.message = match[2] ?? "";
        this.#emit(job);
      },
    });
    this.#runs.set(job.id, run);
    void this.#save(job);
    this.#emit(job);
    void run.exited
      .then(({ code }) => this.#rendered(job, n, code, log))
      .catch((error: Error) => this.#rendered(job, n, null, [...log, error.message]));
  }

  async #rendered(
    job: Job,
    n: number,
    code: number | null,
    log: readonly string[],
    /** Why it failed, when the command said so on its own terms. */
    failed?: string,
  ) {
    this.#runs.delete(job.id);
    const stopped = this.#stopped.delete(job.id);
    const render = job.render;
    const versions = this.#versions(job);
    const version = versions.find((each) => each.n === n);
    const dir = this.#dir(job);
    // The render reads as finished only once everything it changes is settled and saved, so
    // no one sees it done with the version it made not yet shown.
    if (code === 0 && version && existsSync(join(dir, versionFiles(n).video))) {
      const { project } = await this.#project(job, n);
      version.video = true;
      version.seconds = editLength(project) / TICKS_PER_SECOND;
      job.current = n;
      await this.#settle(job, n);
      await this.#keepVideos(job);
      const { render: _, ...done } = job;
      await this.#save(done);
      delete job.render;
    } else if (render) {
      const reason = [...log].reverse().find((line) => line.startsWith("render: error: "));
      const error = failed
        ? failed
        : reason
          ? reason.slice("render: error: ".length)
          : stopped
            ? "The render was stopped"
            : `The render stopped unexpectedly${code === null ? "" : ` (exit code ${code})`}`;
      if (render.fresh) {
        job.versions = versions.filter((each) => each.n !== n);
        await rm(join(dir, versionFiles(n).project), { force: true });
      }
      await writeFile(join(dir, LOG), `${log.join("\n")}\n`);
      await this.#save({ ...job, render: { ...render, error } });
      render.error = error;
    } else {
      await this.#save(job);
    }
    this.#emit(job);
  }

  /** Deletes the videos of versions no longer kept; their records stay. */
  async #keepVideos(job: Job): Promise<void> {
    const versions = this.#versions(job);
    for (const n of videosToPrune(versions, job.current ?? 1)) {
      await rm(join(this.#dir(job), versionFiles(n).video), { force: true });
      const version = versions.find((each) => each.n === n);
      if (version) version.video = false;
    }
  }

  /** Stops a running edit or render, or drops an edit whose files are still arriving. */
  async cancel(id: string): Promise<Job> {
    const job = await this.get(id);
    if (job.render && !job.render.error) {
      this.#stopped.add(job.id);
      this.#runs.get(job.id)?.stop();
      return job;
    }
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

  /** The finished video, its captions as SubRip, or the credits of its B-roll; null until the
   * edit is done. */
  async output(id: string, kind: "video" | "captions" | "broll"): Promise<string | null> {
    const job = await this.get(id);
    if (job.status !== "done") return null;
    const path = join(this.#dir(job), versionFiles(job.current ?? 1)[kind]);
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

  /** Writes job.json whole as `job` is now, one write at a time per job in the order asked, so
   * an older state never lands over a newer one. */
  async #save(job: Job): Promise<void> {
    const path = join(this.#dir(job), "job.json");
    const text = JSON.stringify(job);
    const write = (this.#saving.get(job.id) ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(`${path}.tmp`, text);
        await rename(`${path}.tmp`, path);
      });
    this.#saving.set(job.id, write);
    return write;
  }
}

/** The music files the project `file` in `dir` plays, in the order they first play, by their paths
 * under footage/. */
async function playedMusic(dir: string, file: string): Promise<string[]> {
  const project = JSON.parse(await readFile(join(dir, file), "utf8")) as {
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

/** The words of the sources a revision's cuts need, read only when it has cuts. */
async function wordsFor(revision: Revision, project: Project, path: string) {
  return revision.cuts?.length ? placeSources(project, path) : new Map();
}

/** An overlay's text params, the ones the panel edits. */
function stringParams(params: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(params).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
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
    renderCommand: [
      process.execPath,
      process.env.VIDEO_EDITOR_RENDER_CLI ??
        resolve(process.cwd(), "../../packages/engine/src/cli.ts"),
    ],
  });
  return global.videoEditorJobs;
}
