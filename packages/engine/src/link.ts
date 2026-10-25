// Footage from a link: the video a public page shows, fetched with yt-dlp, kept current.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { link, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { createInterface } from "node:readline";
import { cacheDir, type DownloadProgress, exists, pinnedFile, REMOVE_HELD } from "./download.ts";
import { ffmpeg } from "./ffmpeg.ts";

/** Where the latest yt-dlp release's files are; each asset's URL redirects to its tagged one. */
export const YT_DLP_RELEASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/";

/** The standalone yt-dlp for each platform, as its release names it. */
const ASSETS: Record<string, string> = {
  "linux-x64": "yt-dlp_linux",
  "linux-arm64": "yt-dlp_linux_aarch64",
  "darwin-arm64": "yt-dlp_macos",
  "darwin-x64": "yt-dlp_macos",
  "win32-x64": "yt-dlp.exe",
  "win32-arm64": "yt-dlp_arm64.exe",
};

/** This computer's standalone yt-dlp, as its release names it; undefined when there is none. */
export function ytDlpAsset(): string | undefined {
  return ASSETS[`${process.platform}-${process.arch}`];
}

/** Seconds a link may take to be read before it is given up. */
const READ_TIMEOUT = 60;

/** Why a link cannot be imported; the message says it in English for a person. */
export type LinkProblem =
  | "playlist"
  | "private"
  | "members"
  | "age"
  | "live"
  | "blocked"
  | "unavailable"
  | "unsupported"
  | "offline"
  | "failed";

export class LinkError extends Error {
  override name = "LinkError";
  readonly problem: LinkProblem;
  constructor(problem: LinkProblem, message: string) {
    super(message);
    this.problem = problem;
  }
}

/** The video a link shows. */
export interface LinkVideo {
  url: string;
  id: string;
  title: string;
  /** Seconds; null when the site does not say. */
  seconds: number | null;
  /** The site, as yt-dlp names it: Youtube, Vimeo, … */
  site: string;
  /** About how many bytes the video fetched would take, when the site says. */
  bytes?: number;
}

/** Whether a footage argument is a link rather than a file or folder. */
export function isLink(input: string): boolean {
  return /^https?:\/\/[^\s/]+/i.test(input);
}

export interface YtDlpOptions {
  /** The release's folder of assets, YT_DLP_RELEASE unless a test serves its own. */
  release?: string;
  /** Where yt-dlp is kept, cacheDir() unless given. */
  dir?: string;
  onDownload?: DownloadProgress;
}

/**
 * The latest standalone yt-dlp, run as it is: sites change often, and an old yt-dlp stops
 * reading them. Each call reads the latest release's SHA2-256SUMS; the binary it lists for this
 * computer is downloaded the first time and checked against it before it is kept, and an older
 * one is removed. When GitHub cannot be reached, the one kept from before is used, if there is
 * one. A binary is kept only once its hash matched, so none is run that did not. Calls while one
 * is under way, such as for several links pasted at once, share it.
 */
export function ytDlp(options: YtDlpOptions = {}): Promise<string> {
  const key = `${options.release ?? YT_DLP_RELEASE}\0${options.dir ?? cacheDir()}`;
  let checking = checks.get(key);
  if (!checking) {
    checking = latestYtDlp(options).finally(() => checks.delete(key));
    checks.set(key, checking);
  }
  return checking;
}

/** Each check of yt-dlp under way, by its release and folder. */
const checks = new Map<string, Promise<string>>();

async function latestYtDlp(options: YtDlpOptions): Promise<string> {
  const asset = ytDlpAsset();
  if (!asset) {
    throw new LinkError("unsupported", `No yt-dlp for ${process.platform} on ${process.arch}`);
  }
  const dir = options.dir ?? cacheDir();
  const suffix = process.platform === "win32" ? ".exe" : "";
  // The latest release's sums redirect to its tagged ones, the folder its assets are in, so an
  // asset fetched from there is of the release whose sums were read, whatever is released
  // meanwhile. The tagged URL redirects again, to a storage host whose URL names no asset.
  const read = async (): Promise<{ sums: string; tagged: URL } | number | null> => {
    const signal = AbortSignal.timeout(30_000);
    const latest = new URL("SHA2-256SUMS", options.release ?? YT_DLP_RELEASE);
    const hop = await fetch(latest, { redirect: "manual", signal });
    const location = hop.headers.get("location");
    if (!location) return hop.status;
    const tagged = new URL(location, latest);
    const response = await fetch(tagged, { signal });
    return response.ok ? { sums: await response.text(), tagged } : response.status;
  };
  const release = await read().catch(() => null);
  if (release === null || typeof release === "number") {
    const [newest] = await keptYtDlps(dir);
    if (newest) return newest;
    throw new LinkError(
      "offline",
      `Could not reach GitHub to download yt-dlp, which imports links${release ? ` (HTTP ${release})` : ""}`,
    );
  }
  const listed = release.sums
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === asset)?.[0];
  if (!listed || !/^[0-9a-f]{64}$/.test(listed)) {
    throw new LinkError("failed", `The latest yt-dlp release lists no ${asset}`);
  }
  const path = join(dir, `yt-dlp-${listed.slice(0, 12)}${suffix}`);
  if (await exists(path)) return path;
  const url = new URL(asset, release.tagged).href;
  await pinnedFile(url, listed, path, "yt-dlp", 0o755, options.onDownload);
  // The one before stays, as an import that started with it may still run it; older ones go.
  for (const older of (await keptYtDlps(dir)).slice(2)) {
    await rm(older, { force: true }).catch(() => {});
  }
  return path;
}

/** The yt-dlp binaries kept in `dir`, each checked when it was downloaded, newest first. */
async function keptYtDlps(dir: string): Promise<string[]> {
  const names = (await readdir(dir).catch(() => [])).filter((name) =>
    /^yt-dlp-[0-9a-f]{12}(\.exe)?$/.test(name),
  );
  const dated = await Promise.all(
    names.map(async (name) => {
      const path = join(dir, name);
      return { path, at: (await stat(path)).mtimeMs };
    }),
  );
  return dated.sort((a, b) => b.at - a.at).map(({ path }) => path);
}

/** What every run of yt-dlp is given: no configuration file, no cookies from a file or a
 * browser, one video rather than its playlist, the Node that runs this for YouTube's
 * JavaScript, a cache of its own, and the best quality up to 1080p on the shorter side, or the
 * best there is below it, preferring MP4. */
function common(): string[] {
  return [
    "--ignore-config",
    "--no-cookies",
    "--no-cookies-from-browser",
    "--no-playlist",
    "--no-js-runtimes",
    "--js-runtimes",
    `node:${process.execPath}`,
    "--cache-dir",
    join(cacheDir(), "yt-dlp.cache"),
    ...["-S", "res:1080,ext"],
  ];
}

export interface LinkOptions {
  /** yt-dlp and its first arguments; the latest yt-dlp unless a test gives another. */
  program?: readonly string[];
  /** Stops the work, as a cancelled import does. */
  signal?: AbortSignal;
}

/** What `url` shows, or a LinkError saying why it cannot be imported: a playlist or channel, a
 * private, members-only, age-restricted or live video, or one the site refuses. */
export async function readLink(url: string, options: LinkOptions = {}): Promise<LinkVideo> {
  const program = options.program ?? [await ytDlp()];
  const timeout = AbortSignal.timeout(READ_TIMEOUT * 1000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let json = "";
  await runYtDlp(program, [...common(), "-J", "--flat-playlist", "--", url], signal, (line) => {
    json += line;
  }).catch((error: unknown) => {
    if (timeout.aborted && !options.signal?.aborted) {
      throw new LinkError("offline", `${url} did not answer within ${READ_TIMEOUT} s`);
    }
    throw error;
  });
  const info = JSON.parse(json) as Record<string, unknown>;
  if (info._type === "playlist" || info._type === "multi_video") {
    throw new LinkError(
      "playlist",
      `${url} is a playlist or channel; give the link of one video in it`,
    );
  }
  const live = info.live_status;
  if (info.is_live === true || live === "is_live" || live === "is_upcoming") {
    throw new LinkError("live", `${url} is a live stream; live videos cannot be imported yet`);
  }
  const availability = info.availability;
  if (availability === "private") throw problem(url, "private");
  if (availability === "premium_only" || availability === "subscriber_only") {
    throw problem(url, "members");
  }
  if ((Number(info.age_limit) || 0) >= 18) throw problem(url, "age");
  if (availability === "needs_auth") throw problem(url, "private");
  const seconds = Number(info.duration);
  const bytes = Number(info.filesize ?? info.filesize_approx);
  return {
    url,
    id: String(info.id ?? ""),
    title: String(info.title ?? info.id ?? url),
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    site: String(info.extractor_key ?? info.extractor ?? ""),
    ...(Number.isFinite(bytes) && bytes > 0 ? { bytes } : {}),
  };
}

export interface FetchOptions extends LinkOptions {
  /** The file's name without its extension, from the video read; `<title> [<id>]` as yt-dlp
   * makes it safe, unless given. */
  stem?: (video: LinkVideo) => string;
  /** Called with the video read, before anything is fetched; it refuses it by throwing. */
  check?: (video: LinkVideo) => void | Promise<void>;
  /** Bytes fetched so far of the video's size, as the site gives it. */
  onProgress?: (bytes: number, total: number, video: LinkVideo) => void;
}

/**
 * Fetches the video `url` shows into `dir`: the best quality up to 1080p (the shorter side), or
 * the best there is below it, never re-encoded, as MP4 when the site's streams are MP4's, else
 * Matroska, which holds any. It is read first, so a link readLink refuses is refused here too.
 * The file is written in a folder of its own inside `dir` and put in place once whole, beside
 * any file there rather than over it, even one whose name differs only in case; the folder
 * goes whatever happens, also when the program ends or is interrupted meanwhile.
 */
export async function fetchLink(
  url: string,
  dir: string,
  options: FetchOptions = {},
): Promise<{ path: string; video: LinkVideo }> {
  const program = options.program ?? [await ytDlp()];
  const video = await readLink(url, { ...options, program });
  await options.check?.(video);
  const stem = options.stem?.(video);
  const work = join(dir, `.link-${randomUUID()}`);
  await mkdir(work, { recursive: true });
  working.add(work);
  try {
    let expected = 0;
    let done = 0;
    let format = "";
    let current = 0;
    let file = "";
    const args = [
      ...common(),
      // Joined into MP4 when the streams fit it, else Matroska; a single file, MP4's own kind as
      // MP4 and any other as Matroska. "mp4/mkv" would remux everything to MP4, which some
      // codecs (VP8, Vorbis, Theora) cannot be in.
      ...["--merge-output-format", "mp4/mkv", "--remux-video", "mp4>mp4/m4v>mp4/mov>mp4/mkv"],
      ...["--ffmpeg-location", await ffmpeg()],
      ...["-P", work, "-o", stem ? "video.%(ext)s" : "%(title).150B [%(id)s].%(ext)s"],
      "--windows-filenames",
      ...["--newline", "--progress"],
      ...[
        "--progress-template",
        `download:P %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(info.format_id)s`,
      ],
      ...["-O", "video:S %(filesize,filesize_approx)s", "-O", "after_move:F %(filepath)s"],
      "--",
      url,
    ];
    await runYtDlp(program, args, options.signal, (line) => {
      const [kind, ...rest] = line.split(" ");
      if (kind === "S") expected = Number(rest[0]) || 0;
      else if (kind === "F") file = rest.join(" ");
      else if (kind === "P") {
        const [bytes, total, estimate, id = ""] = rest;
        // Video and audio come one after the other: the bytes of each so far add up.
        if (id !== format) {
          done += current;
          format = id;
        }
        current = Number(bytes) || 0;
        const size = Math.max(expected, done + (Number(total) || Number(estimate) || 0));
        if (size > 0) options.onProgress?.(done + current, size, video);
      }
    });
    if (!file) throw new LinkError("failed", `yt-dlp fetched nothing from ${url}`);
    const extension = extname(file);
    const path = await placeBeside(file, dir, stem ?? basename(file, extension), extension);
    const { size } = await stat(path);
    options.onProgress?.(size, size, video);
    return { path, video };
  } finally {
    // What yt-dlp ran, such as FFmpeg, may still be ending.
    await rm(work, REMOVE_HELD);
    working.delete(work);
  }
}

/** Links `file` into `dir` as `<stem><extension>`, or `<stem> (2)<extension>` and on when a
 * file there has that name in any case, never over one. */
async function placeBeside(
  file: string,
  dir: string,
  stem: string,
  extension: string,
): Promise<string> {
  const taken = new Set((await readdir(dir)).map((name) => name.toLowerCase()));
  for (let n = 1; ; n++) {
    const name = `${n === 1 ? stem : `${stem} (${n})`}${extension}`;
    if (taken.has(name.toLowerCase())) continue;
    try {
      // A link fails, rather than replaces, when another program made the name meanwhile.
      await link(file, join(dir, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
      // A drive without links, such as FAT or exFAT: the name was free a moment ago.
      await rename(file, join(dir, name));
    }
    return join(dir, name);
  }
}

const windows = process.platform === "win32";

/** How to stop each yt-dlp running, and the folders fetches write in. */
const running = new Set<() => void>();
const working = new Set<string>();

/** Stops every yt-dlp and what it runs, and removes the folders they wrote in, synchronously, as
 * the program ends. */
function cleanUp(): void {
  for (const stop of running) stop();
  for (const work of working) {
    rmSync(work, REMOVE_HELD);
  }
}

let hooked = false;
/** Cleans up when the program exits, or ends by Ctrl+C or a stop signal; yt-dlp runs in a process
 * group of its own, which those do not reach. A signal then ends the program as it would have,
 * unless the program listens for it itself. */
function cleanUpAtEnd(): void {
  if (hooked) return;
  hooked = true;
  process.on("exit", cleanUp);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const end = () => {
      cleanUp();
      if (process.listenerCount(signal) > 1) return;
      process.removeListener(signal, end);
      process.kill(process.pid, signal);
    };
    process.on(signal, end);
  }
}

/** Runs yt-dlp, handing each stdout line to `onLine`; a failure is a LinkError from its own
 * words. It runs in a process group of its own, so stopping it also stops what it runs, such as
 * FFmpeg joining the streams; on Windows, stopping it ends its process tree. The promise settles
 * once it has exited. */
function runYtDlp(
  program: readonly string[],
  args: string[],
  signal: AbortSignal | undefined,
  onLine: (line: string) => void,
): Promise<void> {
  const [command, ...first] = program;
  if (!command) throw new Error("No yt-dlp");
  signal?.throwIfAborted();
  cleanUpAtEnd();
  const child: ChildProcess = spawn(command, [...first, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    detached: !windows,
    windowsHide: true,
  });
  const stop = () => {
    if (child.pid === undefined || child.exitCode !== null) return;
    if (windows) {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
      return;
    }
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  };
  running.add(stop);
  signal?.addEventListener("abort", stop, { once: true });
  let error = "";
  if (child.stdout) createInterface({ input: child.stdout }).on("line", onLine);
  if (child.stderr) {
    createInterface({ input: child.stderr }).on("line", (line) => {
      if (line.startsWith("ERROR:")) error = line.slice("ERROR:".length).trim();
    });
  }
  return new Promise<void>((resolve, reject) => {
    child.once("error", (error) => {
      running.delete(stop);
      reject(error);
    });
    child.once("close", (code) => {
      running.delete(stop);
      signal?.removeEventListener("abort", stop);
      if (signal?.aborted) reject(signal.reason);
      else if (code === 0) resolve();
      else reject(fromYtDlp(error || `yt-dlp exited with code ${code}`));
    });
  });
}

/** yt-dlp's error, as the problem a person can act on, read from what yt-dlp said rather than
 * from the link or video id it names. */
export function fromYtDlp(error: string): LinkError {
  const url = /^\[[^\]]+\] ([^:]+):/.exec(error)?.[1] ?? "The link";
  const text = error
    .replace(/^\[[^\]]+\] [^:]+: /, "")
    .replace(/\bhttps?:\/\/\S+/g, "")
    .toLowerCase();
  if (text.includes("private video")) return problem(url, "private");
  if (/members|join this channel|subscriber|premium/.test(text)) return problem(url, "members");
  if (/confirm your age|age-restricted|inappropriate for some users/.test(text)) {
    return problem(url, "age");
  }
  if (/live event|is live|premieres in|this live/.test(text)) {
    return new LinkError("live", `${url} is a live stream; live videos cannot be imported yet`);
  }
  if (text.includes("not a bot")) {
    return new LinkError(
      "blocked",
      `The site asks this computer to sign in before it shares the video (${error}). ` +
        "Try again later or from another network",
    );
  }
  if (text.includes("unsupported url")) {
    return new LinkError("unsupported", `${url}: no video found at this link`);
  }
  if (
    /unavailable|not available|removed|does not exist|http error 40[34]|http error 410/.test(text)
  ) {
    return new LinkError("unavailable", `${url}: the video is not available (${error})`);
  }
  if (/unable to download|failed to resolve|getaddrinfo|timed out|connection/.test(text)) {
    return new LinkError("offline", `Could not reach the site: ${error}`);
  }
  return new LinkError("failed", error);
}

function problem(url: string, kind: "private" | "members" | "age"): LinkError {
  const what = {
    private: "is private or needs signing in",
    members: "is for the channel's members only",
    age: "is age-restricted",
  }[kind];
  return new LinkError(kind, `${url} ${what}; only public videos can be imported`);
}
