// The page's edits: each one's footage, settings, progress and outputs in a folder of its own.
// One server runs one edit at a time, as the machine's memory allows one analysis at a time.
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { loadKit, stageBrand, writeKit } from "@video-editor/engine/brand";
import { chrome } from "@video-editor/engine/chrome";
import { cacheDir } from "@video-editor/engine/download";
import { ffmpeg } from "@video-editor/engine/ffmpeg";
import {
  fetchLink,
  isLink,
  LinkError,
  type LinkVideo,
  readLink,
  ytDlp,
} from "@video-editor/engine/link";
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
  type MediaIndex,
  type Progress,
  type Project,
  type ShortNumber,
  type StageProgress,
  TICKS_PER_SECOND,
  upgradeProject,
  validateProject,
  validateShorts,
} from "@video-editor/schema";
import { Finish } from "./eta.ts";
import type { FixKind } from "./fixes.ts";
import { LOCALES } from "./i18n/locale.ts";
import { en, MESSAGES, type Messages } from "./i18n/messages.ts";
import { readKey, type Service, VARIABLES } from "./key.ts";
import { kitFolder, readKit } from "./kits.ts";
import { fileTitle, safeRelativePath } from "./paths.ts";
import { FOOTAGE_KEPT } from "./retention.ts";
import { type Run, runEdit } from "./runner.ts";
import {
  DEFAULT_CAPTIONS,
  type FileEntry,
  formatDollars,
  formatLength,
  INSTRUCTIONS_MAX,
  LENGTH_RANGE,
  type Role,
  roleOf,
  type Settings,
} from "./settings.ts";
import { REPLAN_MARGIN } from "./shorts.ts";
import { dollarsOf } from "./summary.ts";
import { type PageRevision, type Version, versionFiles, videosToPrune } from "./versions.ts";
import type { ArchiveEntry } from "./zip.ts";

export type Stage = "analyze" | "plan" | "render" | "check";

type Status = "uploading" | "running" | "done" | "error" | "cancelled";

interface JobFile extends FileEntry {
  use: Role;
  /** Bytes the server has of it. */
  received: number;
  /** The public video's link the server fetches it from, rather than receiving it; its path,
   * size and title are set once it is fetched. */
  url?: string;
  /** That video's title. */
  title?: string;
}

/** One short of a run of several, as shorts.json lists it, with its own versions. */
export interface ShortEdit {
  /** Its folder in out/: 01, 02, … in the order Claude ranked them, best first. */
  folder: string;
  title: string;
  description: string;
  hashtags: string[];
  /** The footage file it is cut from, as the edit was given it (footage/…), and its stretch of
   * that file in seconds, which a re-plan takes its material from. */
  source: string;
  start: number;
  end: number;
  /** The length Claude chose for it, and its video's as made, in seconds. */
  length: number;
  seconds: number;
  /** Epoch milliseconds. */
  finished: number;
  claude?: ClaudeCost;
  result?: Job["result"];
  versions?: Version[];
  current?: number;
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
    /** With several shorts, the one being made. */
    short?: ShortNumber;
  };
  /** When the edit will likely finish, in epoch milliseconds, at the rate it has gone so far;
   * once there is enough to go on. */
  finish?: number;
  /** A model downloading on its first use, or a link's video, while it downloads. */
  download?: {
    name: string;
    bytes: number;
    total: number;
    secondsLeft?: number;
    bytesPerSecond?: number;
    /** A link's video, rather than something downloaded only the first time it is used. */
    video?: boolean;
  };
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
  /** With several shorts, each one made so far, best first; they stay, to download, when the run
   * stops or is cancelled before it ends. */
  shorts?: ShortEdit[];
  /** With several shorts, "cost" when the run stopped at its cost limit, having made fewer. */
  stopped?: "cost";
  /** On the page only, never in job.json: the short a view of one short shows, by its folder. */
  short?: string;
  /** A version rendering, while it renders, or why it failed. */
  render?: {
    version: number;
    /** The short it is a version of, by its folder; absent for the edit itself. */
    short?: string;
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

/** A re-plan as the page sends it, or what is wrong with it. */
export function checkReplan(value: unknown): ReplanChoice | string {
  const choice = (value ?? {}) as Partial<ReplanChoice>;
  const [shortest, longest] = LENGTH_RANGE;
  if (
    typeof choice.length !== "number" ||
    !Number.isInteger(choice.length) ||
    choice.length < shortest ||
    choice.length > longest
  ) {
    return `The length is a whole number of seconds, ${shortest} s to ${longest / 3600} h`;
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

/** What the project list calls a job: its first link's title, else its first video's path, or
 * the link of one not fetched yet. */
function nameOf(job: Job): string {
  const first = job.files.find((file) => file.use === "video");
  return job.files.find((file) => file.title)?.title ?? (first?.path || first?.url || "");
}

/** Why a link cannot be imported, in `t`'s words. */
function linkProblem(error: LinkError, t: Messages = en): string {
  return t.server.link[error.problem](error.message);
}

/** A project's caption style, or "brand" when a brand kit's custom captions draw. */
function captionsOf(project: Project): string {
  const preset = project.captions?.preset ?? DEFAULT_CAPTIONS;
  return project.brand?.captions && preset !== "none" ? "brand" : preset;
}

/** The look over a project, by its first clip with one, or none. */
function lookOf(project: Project): string {
  return project.main.find((clip) => clip.grade?.look)?.grade?.look?.id ?? "none";
}

/** What one plan of an edit is for: its length, aspect, the music offered and what the user
 * asks of it. */
interface EditPlan {
  length: number;
  aspect: Settings["aspect"];
  music: JobFile[];
  instructions?: string;
  /** Several shorts instead of one edit. */
  shorts?: NonNullable<Settings["shorts"]>;
  /** The footage to cut from, when not all of it: the one file of a short. */
  footage?: JobFile[];
  /** The stretch of that file to cut from, in seconds. */
  within?: [number, number];
  /** What a short planned again is about: its title and description. */
  short?: string;
  /** The look, caption style and brand kit, when not the edit's settings', as a version changed
   * them: the kit as a folder, or null for none. */
  look?: string;
  captions?: string;
  brand?: string | null;
}

/** What the re-edit panel shows of one version, in output ticks. */
export interface EditView {
  version: number;
  /** Ticks. */
  length: number;
  /** Whether the footage is kept, which every change needs. */
  footage: boolean;
  /** Frames a second, for stepping the player one frame. */
  fps: number;
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
  /** The caption style, or "brand" for the brand kit's custom captions. */
  captions: string | null;
  /** The brand kit the version is in, by name, and whether its custom captions draw. */
  brand: { name: string; captions: boolean } | null;
  /** Made by an earlier version, whose motion-graphics cards and keyword pops this one leaves out
   * when it renders the edit again. */
  older: boolean;
}

/** A request the job cannot take in its state; the message is for the page, said in the words of
 * the language the page asks for (`say`; `message` is the English), and `code` names what its
 * owner can fix. */
export class JobError extends Error {
  readonly status: 400 | 403 | 404 | 409 | 507;
  readonly code: FixKind | undefined;
  readonly say: (t: Messages) => string;
  constructor(
    message: string | ((t: Messages) => string),
    status: 400 | 403 | 404 | 409 | 507,
    code?: FixKind,
  ) {
    const say = typeof message === "string" ? () => message : message;
    super(say(en));
    this.say = say;
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
  /** yt-dlp and its first arguments; the latest yt-dlp unless a test gives a stand-in. */
  ytDlp?: readonly string[];
}

/** A download's bytes a second since it started, and the seconds it has left at that rate;
 * undefined until it can say. */
export function secondsLeft(
  start: { at: number; bytes: number },
  now: { at: number; bytes: number },
  total: number,
): { seconds: number; bytesPerSecond: number } | undefined {
  const elapsed = now.at - start.at;
  const arrived = now.bytes - start.bytes;
  // The first seconds' rate says little: connections are still opening.
  if (elapsed < 3000 || arrived <= 0) return undefined;
  const bytesPerSecond = (arrived * 1000) / elapsed;
  return { seconds: (total - now.bytes) / bytesPerSecond, bytesPerSecond };
}

const VIDEO = versionFiles(1).video;
/** Where a run of several shorts writes shorts.json and a folder for each short. */
const OUT = "out";
/** stderr lines kept with a failed edit, for a person to read in edit.log. */
const LOG = "edit.log";

/** What the project list shows of an edit. */
export interface ProjectSummary {
  id: string;
  created: number;
  status: Status;
  length: number;
  aspect: Settings["aspect"];
  /** Its first link's title, else its first video's path or link, to tell projects apart. */
  name: string;
  /** Bytes its folder takes on disk. */
  bytes: number;
  /** Whether its footage is still kept, which editing it again needs. */
  footage: boolean;
  /** With several shorts, how many were made so far. */
  shorts?: number;
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
  readonly #ytDlp: readonly string[] | undefined;
  /** Each job fetching its links, until they are fetched: what stops it, and when it ended. */
  readonly #fetches = new Map<string, { stop: AbortController; done: Promise<void> }>();
  /** Where each running job's current download started, for its time left. */
  readonly #downloads = new Map<string, { name: string; at: number; bytes: number }>();
  /** Each running job's estimate of when it finishes. */
  readonly #finishes = new Map<string, Finish>();
  readonly #jobs = new Map<string, Job>();
  readonly #runs = new Map<string, Run>();
  /** Jobs whose render was stopped, until it exits. */
  readonly #stopped = new Set<string>();
  readonly #listeners = new Map<string, Set<(job: Job) => void>>();
  /** Each running job's latest reading of shorts.json, which its end waits for. */
  readonly #reading = new Map<string, Promise<void>>();
  /** Each job's latest write of job.json, which the next one waits for. */
  readonly #saving = new Map<string, Promise<void>>();
  readonly #loaded: Promise<void>;

  constructor(options: JobsOptions) {
    this.#root = resolve(options.root);
    this.#command = options.command;
    this.#renderCommand = options.renderCommand;
    this.#key = options.key;
    this.#ytDlp = options.ytDlp;
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
        const slot = slotOf(job, job.render.short);
        if (job.render.fresh && slot)
          slot.versions = slot.versions?.filter((v) => v.n !== job.render?.version);
        job.render.error = "The server stopped before this version finished rendering";
        await this.#save(job);
      }
      this.#jobs.set(job.id, job);
    }
  }

  /** A new edit of the files the page will send and the links' videos the server will fetch. */
  async create(
    settings: Settings,
    entries: readonly FileEntry[],
    links: readonly string[] = [],
  ): Promise<Job> {
    await this.#loaded;
    // Refused now rather than at start, before the page sends any footage.
    this.#refuseWhileRunning();
    await this.#requireKeys(settings);
    if (settings.brand) {
      const kit = await readKit(settings.brand.id);
      settings = { ...settings, brand: { id: kit.id, name: kit.brand.name } };
    }
    const files: JobFile[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
      const path = safeRelativePath(entry.path);
      if (!path) throw new JobError((t) => t.server.badName(entry.path), 400);
      if (seen.has(path)) throw new JobError((t) => t.server.twice(path), 400);
      seen.add(path);
      const use = roleOf(path);
      if (!use) {
        throw new JobError((t) => t.server.notMedia(path), 400, "file");
      }
      if (!Number.isSafeInteger(entry.size) || entry.size <= 0) {
        throw new JobError((t) => t.server.empty(path), 400);
      }
      files.push({ path, size: entry.size, use, received: 0 });
    }
    for (const url of links) {
      if (!isLink(url) || url.length > 2000 || !URL.canParse(url)) {
        throw new JobError((t) => t.server.badLink(url), 400);
      }
      if (seen.has(url)) throw new JobError((t) => t.server.twice(url), 400);
      seen.add(url);
      files.push({ path: "", size: 0, use: "video", received: 0, url });
    }
    if (!files.some((file) => file.use === "video")) {
      throw new JobError((t) => t.server.noVideo, 400);
    }
    if (files.some((file) => file.use === "music") && !settings.musicLicense) {
      throw new JobError((t) => t.server.musicLicense, 400);
    }
    await this.#prune();
    await this.#checkDisk(files.reduce((sum, file) => sum + file.size, 0));
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
    if (!job) throw new JobError((t) => t.server.noEdit, 404);
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
        name: nameOf(job),
        bytes: await diskUsage(this.#dir(job)),
        footage: existsSync(join(this.#dir(job), "footage")),
        ...(job.settings.shorts ? { shorts: job.shorts?.length ?? 0 } : {}),
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
      throw new JobError((t) => t.server.underWay, 409);
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
    if (job.status !== "uploading") throw new JobError((t) => t.server.noMoreFiles, 409);
    const file = job.files[index];
    if (!file || file.url) throw new JobError((t) => t.server.noFile, 404);
    const path = join(this.#dir(job), "footage", file.path);
    await mkdir(dirname(path), { recursive: true });
    file.received = 0;
    const count = new Transform({
      transform: (chunk: Buffer, _encoding, done) => {
        file.received += chunk.length;
        if (file.received > file.size) done(new JobError((t) => t.server.larger(file.path), 400));
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
        throw new JobError((t) => t.server.incomplete(file.path), 400);
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

  /** Refuses footage of `bytes` that does not fit the free disk space with room to spare: the
   * edit's work files and outputs need room too, and footage the size of what is left would fail
   * halfway through the render instead of now. */
  async #checkDisk(bytes: number): Promise<void> {
    const { bavail, bsize } = await statfs(this.#root);
    if (bytes * 1.2 > bavail * bsize) {
      throw new JobError(
        (t) => t.server.disk(gigabytes(bytes * 1.2), gigabytes(bavail * bsize)),
        507,
        "disk",
      );
    }
  }

  /** Starts the edit once every file has arrived; a link that cannot be imported fails it, said
   * in `t`'s words, the page's. */
  async start(id: string, t: Messages = en): Promise<Job> {
    const job = await this.get(id);
    const keys = await this.#requireKeys(job.settings);
    if (job.status !== "uploading") throw new JobError((t) => t.server.started, 409);
    const missing = job.files.find((file) => !file.url && file.received !== file.size);
    if (missing) throw new JobError((t) => t.server.notArrived(missing.path), 409);
    this.#refuseWhileRunning();
    // Running from here, before the next await, so a second start at the same moment is refused.
    job.status = "running";
    job.started = Date.now();
    await this.#save(job);
    void this.#run(job, keys, t);
    return job;
  }

  /** Fetches the edit's links into its footage, then runs the edit. */
  async #run(job: Job, keys: Record<string, string>, t: Messages): Promise<void> {
    try {
      const stop = new AbortController();
      const done = this.#fetchLinks(job, stop.signal);
      this.#fetches.set(job.id, { stop, done });
      await done.finally(() => this.#fetches.delete(job.id));
    } catch (error) {
      if (job.status === "cancelled") return;
      job.error =
        error instanceof LinkError
          ? linkProblem(error, t)
          : error instanceof JobError
            ? error.say(t)
            : (error as Error).message;
      await this.#finish(job, null, [(error as Error).message]);
      return;
    }
    if (job.status === "cancelled") return;
    const dir = this.#dir(job);
    const { length, aspect, instructions, shorts } = job.settings;
    const music = job.files.filter((file) => file.use === "music");
    let args: string[];
    try {
      args = await this.#editArgs(
        job,
        {
          length,
          aspect,
          music,
          ...(instructions ? { instructions } : {}),
          ...(shorts ? { shorts } : {}),
        },
        shorts ? OUT : VIDEO,
      );
      await this.#save(job);
    } catch (error) {
      job.error = "The server could not prepare this edit";
      await this.#finish(job, null, [(error as Error).message]);
      return;
    }
    // Cancelled while its arguments were written.
    if ((job.status as Status) === "cancelled") return;
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
  }

  /** Fetches each link's video into the job's footage, named after its title, with its progress
   * as the job's download; FFmpeg, which joins the video and the sound, and the latest yt-dlp
   * first, which the job runs throughout. A video too big for the free disk space, as the site
   * gives its size, is refused before it is fetched. `signal` stops it. */
  async #fetchLinks(job: Job, signal: AbortSignal): Promise<void> {
    const links = job.files.filter((file) => file.url && file.received === 0);
    if (links.length === 0) return;
    try {
      const program = this.#ytDlp ?? [
        await ytDlp({
          onDownload: (bytes, total) => this.#downloaded(job, "yt-dlp", bytes, total),
        }),
      ];
      await ffmpeg((bytes, total) => this.#downloaded(job, "FFmpeg", bytes, total));
      const footage = join(this.#dir(job), "footage");
      for (const file of links) {
        signal.throwIfAborted();
        const { path, video } = await fetchLink(file.url as string, footage, {
          program,
          signal,
          check: async (linked) => {
            if (linked.bytes) await this.#checkDisk(linked.bytes);
          },
          stem: (linked) => fileTitle(linked.title),
          onProgress: (bytes, total, linked) => {
            this.#downloaded(job, linked.title, bytes, total, true);
          },
        });
        const { size } = await stat(path);
        Object.assign(file, {
          path: relative(footage, path),
          size,
          received: size,
          title: video.title,
        });
        await this.#save(job);
      }
    } finally {
      this.#downloads.delete(job.id);
      delete job.download;
    }
  }

  /** A download's progress as the job's, with its rate and time left. */
  #downloaded(job: Job, name: string, bytes: number, total: number, video = false): void {
    const now = Date.now();
    let start = this.#downloads.get(job.id);
    if (start?.name !== name) {
      start = { name, at: now, bytes };
      this.#downloads.set(job.id, start);
    }
    const rate = secondsLeft(start, { at: now, bytes }, total);
    job.download = {
      name,
      bytes,
      total,
      ...(rate ? { secondsLeft: rate.seconds, bytesPerSecond: rate.bytesPerSecond } : {}),
      ...(video ? { video } : {}),
    };
    this.#emit(job);
  }

  /** What a link shows, for the page to list it, or why it cannot be imported. */
  async readLink(url: string): Promise<LinkVideo> {
    if (!isLink(url) || url.length > 2000 || !URL.canParse(url)) {
      throw new JobError((t) => t.server.badLink(url), 400);
    }
    try {
      return await readLink(url, this.#ytDlp ? { program: this.#ytDlp } : {});
    } catch (error) {
      if (error instanceof LinkError) throw new JobError((t) => linkProblem(error, t), 400);
      throw error;
    }
  }

  /** `pnpm edit`'s arguments for `job` planned as `plan` says, writing to `output`, and the
   * names and terms files they name, written into the job's folder. */
  async #editArgs(job: Job, plan: EditPlan, output: string): Promise<string[]> {
    const { style, names, terms = [], musicLicense, visuals } = job.settings;
    const footage = (file: JobFile) => join("footage", file.path);
    const cut = plan.footage ?? job.files.filter((file) => file.use === "video");
    const captions = plan.captions ?? job.settings.captions ?? DEFAULT_CAPTIONS;
    // The kit as it is now; one deleted since the edit was asked for is refused.
    let kit = plan.brand ?? null;
    if (plan.brand === undefined && job.settings.brand) {
      kit = kitFolder((await readKit(job.settings.brand.id)).id);
    }
    const args = [
      ...job.files.filter((file) => cut.includes(file) || file.use === "image").map(footage),
      "--length",
      plan.shorts ? `${plan.shorts.min}-${plan.shorts.max}` : String(plan.length),
      ...(plan.shorts ? ["--shorts", String(plan.shorts.count)] : []),
      ...(plan.within ? ["--within", `${plan.within[0]}-${plan.within[1]}`] : []),
      // Joined, so a title starting with "-" is not read as an option.
      ...(plan.short ? [`--short=${plan.short}`] : []),
      "--aspect",
      plan.aspect,
      "--look",
      plan.look ?? style,
      `--visuals=${visuals}`,
      ...["--quality", job.settings.quality ?? "best"],
      ...(job.settings.correct ? ["--correct"] : []),
      // The brand kit's custom captions go with --brand, and no --captions.
      ...(captions === "brand" ? [] : ["--captions", captions]),
      ...(kit ? ["--brand", kit] : []),
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
    if (!key) throw new JobError((t) => t.server.needAnthropic, 400, "key");
    const keys: Record<string, string> = { ANTHROPIC_API_KEY: key };
    if (settings.asr === "cloud") {
      const openrouter = await this.#key("openrouter");
      if (!openrouter) {
        throw new JobError((t) => t.server.needOpenRouter, 400, "openrouter");
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
      throw new JobError((t) => t.server.busy, 409);
    }
    if ([...this.#jobs.values()].some((other) => other.render && !other.render.error)) {
      throw new JobError((t) => t.server.rendering, 409);
    }
  }

  #progress(job: Job, line: Progress): void {
    const now = Date.now();
    // A short's line says what that short cost, not the run.
    if (line.claude && line.stage !== "short") job.claude = line.claude;
    if ("download" in line && line.download) {
      const { name, bytes, total } = line.download;
      let start = this.#downloads.get(job.id);
      if (start?.name !== name) {
        start = { name, at: now, bytes };
        this.#downloads.set(job.id, start);
      }
      const rate = secondsLeft(start, { at: now, bytes }, total);
      job.download = {
        name,
        bytes,
        total,
        ...(rate ? { secondsLeft: rate.seconds, bytesPerSecond: rate.bytesPerSecond } : {}),
      };
    } else {
      delete job.download;
      this.#downloads.delete(job.id);
    }
    if (line.stage === "done") {
      const { outputs } = line;
      job.result = {
        message: line.message,
        captions: "captions" in outputs && outputs.captions !== undefined,
        broll: "broll" in outputs && outputs.broll !== undefined,
      };
    } else if (line.stage === "short") {
      // Read from shorts.json, which lists it by now; the run's end waits for it.
      const read = (this.#reading.get(job.id) ?? Promise.resolve())
        .then(() => this.#readShorts(job, line.claude))
        .catch(() => {});
      this.#reading.set(job.id, read);
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
        ...(line.short ? { short: line.short } : {}),
      };
      let finish = this.#finishes.get(job.id);
      if (!finish) {
        const { shorts } = job.settings;
        finish = shorts
          ? new Finish((shorts.min + shorts.max) / 2, shorts.count)
          : new Finish(job.settings.length);
        this.#finishes.set(job.id, finish);
      }
      const estimate = finish.update(now, job.progress.fraction, stage, job.download !== undefined);
      if (estimate !== undefined) job.finish = Math.round(estimate);
    }
    this.#emit(job);
  }

  /** Takes the shorts shorts.json lists into the job, the newest with what it cost, and whether
   * the run stopped at its cost limit, and saves it, so a server that stops keeps them. */
  async #readShorts(job: Job, claude?: ClaudeCost): Promise<void> {
    const listed = await loadJson(join(this.#dir(job), OUT, "shorts.json"), validateShorts);
    if (listed.stopped) job.stopped = listed.stopped;
    const shorts = job.shorts ?? [];
    for (const short of listed.shorts) {
      if (shorts.some((each) => each.folder === short.folder)) continue;
      const made: ShortEdit = { ...short, finished: Date.now(), ...(claude ? { claude } : {}) };
      made.result = { message: "", captions: false };
      await this.#settle(job, 1, made);
      shorts.push(made);
    }
    job.shorts = shorts;
    await this.#save(job);
    this.#emit(job);
  }

  async #finish(job: Job, code: number | null, log: readonly string[]): Promise<void> {
    await this.#reading.get(job.id);
    this.#reading.delete(job.id);
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
    } else if (code === 0 && job.result && job.settings.shorts && job.shorts?.length) {
      // The run's last word: why it made fewer, written after its last short.
      await this.#readShorts(job).catch(() => {});
      job.status = "done";
    } else if (code === 0 && job.result && existsSync(join(dir, VIDEO))) {
      // The result is settled before the job reads as done, so the page never offers what is
      // not there.
      // Captions with no lines, when no speech is kept, are not worth a download.
      await this.#settle(job, 1, job);
      job.status = "done";
    } else {
      job.status = "error";
      job.error ??= `The edit stopped unexpectedly${code === null ? "" : ` (exit code ${code})`}`;
    }
    if (job.status !== "done") await writeFile(join(dir, LOG), `${log.join("\n")}\n`);
    await this.#save(job);
    this.#emit(job);
  }

  /** What the page offers of version `n` of `slot`, the edit or one of its shorts, from its
   * files: the captions, the B-roll credits and the music it plays. */
  async #settle(job: Job, n: number, slot: Slot): Promise<void> {
    const { result } = slot;
    if (!result) return;
    const dir = this.#dir(job);
    const files = versionFiles(n, folderOf(slot));
    // Captions with no lines, when no speech is kept, are not worth a download.
    const captions = await stat(join(dir, files.captions)).catch(() => null);
    result.captions = (captions?.size ?? 0) > 0;
    result.broll = existsSync(join(dir, files.broll));
    if (job.files.some((file) => file.use === "music")) {
      // Unknown, rather than none, when the project cannot be read.
      const played = await playedMusic(dir, files.project).catch(() => null);
      if (played) result.music = played;
      else delete result.music;
    }
  }

  /** The versions of a finished edit or short, oldest first. */
  #versions(job: Job, slot: Slot): Version[] {
    slot.versions ??= [
      {
        n: 1,
        created: ("folder" in slot ? slot.finished : job.finished) ?? job.created,
        summary: job.settings.instructions ? "The edit, with instructions" : "The edit",
        video: true,
      },
    ];
    return slot.versions;
  }

  /** The edit, or the short in `folder`; a short the job does not have is not found. */
  #slot(job: Job, folder: string | undefined): Slot {
    const slot = slotOf(job, folder);
    if (!slot) throw new JobError((t) => t.server.noShort, 404);
    return slot;
  }

  async #project(
    job: Job,
    n: number,
    slot: Slot,
  ): Promise<{ project: Project; path: string; older: boolean }> {
    const path = join(this.#dir(job), versionFiles(n, folderOf(slot)).project);
    let older = false;
    const project = await loadJson(path, (value) => {
      const { cards, keywords } = upgradeProject(value).dropped;
      older = cards + keywords > 0;
      return validateProject(value);
    });
    return { project, path, older };
  }

  /** A finished edit's version `n` (the one shown unless given), with what can change in it. */
  async view(id: string, n?: number, short?: string): Promise<EditView> {
    const job = await this.#finished(id);
    const slot = this.#slot(job, short);
    const version = n ?? slot.current ?? 1;
    if (!this.#versions(job, slot).some((each) => each.n === version)) {
      throw new JobError((t) => t.server.noVersion, 404);
    }
    const { project, older } = await this.#project(job, version, slot);
    return {
      version,
      length: editLength(project),
      fps: project.output.fps.num / project.output.fps.den,
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
      look: lookOf(project),
      captions: project.captions ? captionsOf(project) : null,
      brand: project.brand
        ? { name: project.brand.name, captions: project.brand.captions !== undefined }
        : null,
      older,
    };
  }

  /** What `revision` would do to the version shown, without rendering it: where its cuts land
   * and the length it leaves. */
  async preview(id: string, asked: PageRevision, short?: string) {
    const job = await this.#finished(id);
    const slot = this.#slot(job, short);
    const { project, path } = await this.#project(job, slot.current ?? 1, slot);
    // A kit changes no cut or length.
    const { kit: _, ...revision } = asked;
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
  async revise(
    id: string,
    asked: PageRevision,
    summary: string,
    summaries?: Version["summaries"],
    short?: string,
  ): Promise<Job> {
    const job = await this.#finished(id);
    const slot = this.#slot(job, short);
    this.#refuseWhileRunning();
    this.#requireFootage(job);
    const from = slot.current ?? 1;
    const versions = this.#versions(job, slot);
    const n = Math.max(...versions.map((version) => version.n)) + 1;
    // Busy from here, before the next await, so a second Apply at the same moment is refused.
    job.render = {
      version: n,
      ...(short ? { short } : {}),
      fresh: true,
      fraction: 0,
      message: "Preparing the changes",
    };
    let revised: Project;
    try {
      const { project, path } = await this.#project(job, from, slot);
      const revision = await this.#revision(job, asked, path);
      try {
        revised = revise(project, revision, await wordsFor(revision, project, path)).project;
      } catch (error) {
        throw new JobError((error as Error).message, 400);
      }
      // Beside the version it came from, so its relative paths still resolve.
      const record = join(this.#dir(job), versionFiles(n, short).project);
      await writeFile(record, `${JSON.stringify(revised, null, 2)}\n`);
    } catch (error) {
      delete job.render;
      throw error;
    }
    versions.push({
      n,
      created: Date.now(),
      summary,
      ...(summaries ? { summaries } : {}),
      from,
      video: false,
      look: lookOf(revised),
      ...(revised.captions ? { captions: captionsOf(revised) } : {}),
      brand: revised.brand?.name ?? null,
    });
    this.#render(job, n, true, slot);
    return job;
  }

  /** The engine's revision for what the page asked: a brand kit, by its id, copied into the job's
   * `brand` folder with its paths relative to the version's record at `path`. */
  async #revision(job: Job, asked: PageRevision, path: string): Promise<Revision> {
    const { kit, ...revision } = asked;
    if (kit === undefined) return revision;
    if (kit === null) return { ...revision, brand: null };
    const folder = kitFolder((await readKit(kit)).id);
    const brand = await stageBrand(
      await loadKit(folder),
      folder,
      join(this.#dir(job), "brand"),
      dirname(path),
      () => chrome(),
    );
    return { ...revision, brand };
  }

  /** Plans the edit again from the same footage, its analysis cached, as the next version: at
   * another length or aspect, with other music, or with what the user asks of it. The version
   * shown stays until the new one is done. */
  async replan(id: string, choice: ReplanChoice, short?: string): Promise<Job> {
    const job = await this.#finished(id);
    const slot = this.#slot(job, short);
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
      throw new JobError((t) => t.server.notOffered, 400);
    }
    const versions = this.#versions(job, slot);
    const n = Math.max(...versions.map((version) => version.n)) + 1;
    const from = slot.current ?? 1;
    // Busy from here, before the next await, so a second request at the same moment is refused.
    job.render = {
      version: n,
      ...(short ? { short } : {}),
      fresh: true,
      fraction: 0,
      message: "Planning again",
    };
    const files = versionFiles(n, short);
    let args: string[];
    let kept: { look: string; captions?: string; brand: string | null };
    // The version's brand kit, written as a kit folder for --brand while the plan runs.
    const kit = join(this.#dir(job), `${files.video}.kit`);
    try {
      // The look, caption style and brand kit the version shown has, which the panel may have
      // changed.
      const { project, path } = await this.#project(job, from, slot);
      kept = {
        look: lookOf(project),
        ...(project.captions ? { captions: captionsOf(project) } : {}),
        brand: project.brand?.name ?? null,
      };
      if (project.brand) await writeKit(project.brand, dirname(path), kit);
      args = await this.#editArgs(
        job,
        {
          length: choice.length,
          aspect: choice.aspect,
          music,
          ...(choice.instructions ? { instructions: choice.instructions } : {}),
          look: kept.look,
          ...(kept.captions ? { captions: kept.captions } : {}),
          brand: project.brand ? kit : null,
          ...("folder" in slot ? await this.#stretch(job, slot, project, path) : {}),
        },
        files.video,
      );
    } catch (error) {
      delete job.render;
      await rm(kit, { recursive: true, force: true });
      throw error;
    }
    const version: Version = {
      n,
      created: Date.now(),
      summary: replanned(choice, en),
      summaries: Object.fromEntries(
        LOCALES.map((locale) => [locale, replanned(choice, MESSAGES[locale])]),
      ),
      from,
      video: false,
      length: choice.length,
      aspect: choice.aspect,
      ...kept,
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
        if (line.claude) version.claude = line.claude;
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
      .then(({ code }) => this.#rendered(job, n, code, log, slot, failed))
      .catch((error: Error) => this.#rendered(job, n, null, [...log, error.message], slot, failed))
      .finally(() => rm(kit, { recursive: true, force: true }));
    return job;
  }

  /** How a re-plan of `short` is planned: from its file, and its stretch with REPLAN_MARGIN on
   * each side, inside the file as its media index, which `project` names, measures it; as a short
   * about its moment. */
  async #stretch(
    job: Job,
    short: ShortEdit,
    project: Project,
    path: string,
  ): Promise<Pick<EditPlan, "footage" | "within" | "short">> {
    const file = job.files.find((each) => join("footage", each.path) === join(short.source));
    if (!file) throw new JobError((t) => t.server.noShort, 404);
    const played = project.sources.find(
      (source) => resolve(dirname(path), source.path) === join(this.#dir(job), short.source),
    );
    const index = played?.index
      ? await loadJson(resolve(dirname(path), played.index), (value) => value as MediaIndex)
      : null;
    const duration = index?.source.duration ?? short.end;
    const start = Math.max(0, short.start - REPLAN_MARGIN);
    const end = Math.min(duration, short.end + REPLAN_MARGIN);
    const round = (seconds: number) => Math.round(seconds * 1000) / 1000;
    return {
      footage: [file],
      within: [round(start), Math.floor(end * 1000) / 1000],
      short: `${short.title}. ${short.description}`,
    };
  }

  /** Shows version `n`, rendering it again from its record when its video was not kept. */
  async show(id: string, n: number, short?: string): Promise<Job> {
    const job = await this.#finished(id);
    const slot = this.#slot(job, short);
    const version = this.#versions(job, slot).find((each) => each.n === n);
    if (!version) throw new JobError((t) => t.server.noVersion, 404);
    if (version.video && existsSync(join(this.#dir(job), versionFiles(n, short).video))) {
      slot.current = n;
      await this.#settle(job, n, slot);
      await this.#keepVideos(job, slot);
      await this.#save(job);
      this.#emit(job);
      return job;
    }
    this.#refuseWhileRunning();
    this.#requireFootage(job);
    this.#render(job, n, false, slot);
    return job;
  }

  async #finished(id: string): Promise<Job> {
    const job = await this.get(id);
    if (job.status !== "done") throw new JobError((t) => t.server.notFinished, 409);
    return job;
  }

  /** Refuses a render without the footage it plays. */
  #requireFootage(job: Job): void {
    if (!existsSync(join(this.#dir(job), "footage"))) {
      throw new JobError((t) => t.server.footageDeleted(FOOTAGE_KEPT), 409);
    }
  }

  /** Renders version `n` from its record with \`pnpm render\`, in a process of its own as an
   * edit runs, and shows it once done. */
  #render(job: Job, n: number, fresh: boolean, slot: Slot): void {
    const short = folderOf(slot);
    const files = versionFiles(n, short);
    job.render = {
      version: n,
      ...(short ? { short } : {}),
      fresh,
      fraction: 0,
      message: "Starting the render",
    };
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
      .then(({ code }) => this.#rendered(job, n, code, log, slot))
      .catch((error: Error) => this.#rendered(job, n, null, [...log, error.message], slot));
  }

  async #rendered(
    job: Job,
    n: number,
    code: number | null,
    log: readonly string[],
    slot: Slot,
    /** Why it failed, when the command said so on its own terms. */
    failed?: string,
  ) {
    this.#runs.delete(job.id);
    const stopped = this.#stopped.delete(job.id);
    const render = job.render;
    const versions = this.#versions(job, slot);
    const version = versions.find((each) => each.n === n);
    const dir = this.#dir(job);
    const files = versionFiles(n, folderOf(slot));
    // The render reads as finished only once everything it changes is settled and saved, so
    // no one sees it done with the version it made not yet shown.
    if (code === 0 && version && existsSync(join(dir, files.video))) {
      const { project } = await this.#project(job, n, slot);
      version.video = true;
      version.seconds = editLength(project) / TICKS_PER_SECOND;
      slot.current = n;
      await this.#settle(job, n, slot);
      await this.#keepVideos(job, slot);
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
        slot.versions = versions.filter((each) => each.n !== n);
        await rm(join(dir, files.project), { force: true });
      }
      await writeFile(join(dir, LOG), `${log.join("\n")}\n`);
      // What a plan cost before it failed, which its version, dropped, no longer shows.
      const told = version?.claude
        ? `${error}. Claude cost ${formatDollars(dollarsOf(version.claude))} before it stopped`
        : error;
      await this.#save({ ...job, render: { ...render, error: told } });
      render.error = told;
    } else {
      await this.#save(job);
    }
    this.#emit(job);
  }

  /** Deletes the videos of versions of `slot` no longer kept; their records stay. */
  async #keepVideos(job: Job, slot: Slot): Promise<void> {
    const versions = this.#versions(job, slot);
    for (const n of videosToPrune(versions, slot.current ?? 1)) {
      await rm(join(this.#dir(job), versionFiles(n, folderOf(slot)).video), { force: true });
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
    // A link's download ends first, so nothing writes in the footage as it is deleted.
    const fetching = this.#fetches.get(job.id);
    fetching?.stop.abort();
    await fetching?.done.catch(() => {});
    await rm(join(this.#dir(job), "footage"), { recursive: true, force: true, maxRetries: 10 });
    await this.#save(job);
    this.#emit(job);
    return job;
  }

  /** The finished video, its captions as SubRip, or the credits of its B-roll, of the edit or
   * of the short in `short`; null until it is made. A short plays as soon as it is made, while
   * the others are still being made. */
  async output(
    id: string,
    kind: "video" | "captions" | "broll",
    short?: string,
  ): Promise<string | null> {
    const job = await this.get(id);
    if (job.status !== "done" && !short) return null;
    const slot = slotOf(job, short);
    if (!slot) return null;
    const path = join(this.#dir(job), versionFiles(slot.current ?? 1, short)[kind]);
    return existsSync(path) ? path : null;
  }

  /** What "Download all" puts in its zip: each short's video and captions, named by its place
   * and title, and a text file of each one's title, description and hashtags. */
  async shortsArchive(id: string): Promise<{ name: string; entries: ArchiveEntry[] }> {
    // The shorts made so far, even of a run stopped or cancelled before it ended.
    const job = await this.get(id);
    const shorts = job.shorts ?? [];
    if (shorts.length === 0) throw new JobError((t) => t.server.noShort, 404);
    const entries: ArchiveEntry[] = [];
    const listing: string[] = [];
    for (const short of shorts) {
      const stem = `${short.folder}-${fileTitle(short.title)}`;
      const files = versionFiles(short.current ?? 1, short.folder);
      for (const [kind, extension] of [
        ["video", "mp4"],
        ["captions", "srt"],
      ] as const) {
        const path = join(this.#dir(job), files[kind]);
        if (existsSync(path)) entries.push({ name: `${stem}.${extension}`, path });
      }
      listing.push(
        [`${short.folder}. ${short.title}`, short.description, short.hashtags.join(" ")].join("\n"),
      );
    }
    entries.push({ name: "shorts.txt", text: `${listing.join("\n\n")}\n` });
    const { min, max } = job.settings.shorts ?? { min: 0, max: job.settings.length };
    const name = `shorts-${min}-${max}s-${job.settings.aspect.replace(":", "x")}.zip`;
    return { name, entries };
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

/** The edit itself, or one of its shorts: what has versions, of which one is shown. */
type Slot = Job | ShortEdit;

/** A short's folder; undefined for the edit itself. */
function folderOf(slot: Slot): string | undefined {
  return "folder" in slot ? slot.folder : undefined;
}

/** The edit, or its short in `folder`; undefined for a short it does not have. */
function slotOf(job: Job, folder: string | undefined): Slot | undefined {
  return folder === undefined ? job : job.shorts?.find((short) => short.folder === folder);
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

/** A re-plan's version as the list names it, in `t`'s words. */
function replanned(choice: ReplanChoice, t: Messages): string {
  return [
    t.versions.replanned(formatLength(choice.length, t), choice.aspect),
    ...(choice.music === "none"
      ? [t.versions.noMusic]
      : choice.music === "auto"
        ? []
        : [choice.music.split("/").at(-1) as string]),
    ...(choice.instructions ? [t.versions.withInstructions] : []),
  ].join(t.list);
}

function gigabytes(bytes: number): string {
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

/** Where jobs go unless VIDEO_EDITOR_JOBS says otherwise: beside the engine's own cache. */
export function defaultRoot(): string {
  return process.env.VIDEO_EDITOR_JOBS ?? join(cacheDir(), "jobs");
}

/** The server's one store. Each route is bundled on its own, so the store lives on globalThis
 * for every route to find the same one. */
export function jobs(): Jobs {
  const global = globalThis as { videoEditorJobs?: Jobs };
  global.videoEditorJobs ??= new Jobs({
    root: defaultRoot(),
    key: readKey,
    // A stand-in for yt-dlp, run by Node, only in tests.
    ...(process.env.VIDEO_EDITOR_YT_DLP
      ? { ytDlp: [process.execPath, process.env.VIDEO_EDITOR_YT_DLP] }
      : {}),
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
