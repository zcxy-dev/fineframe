// Footage from a link: the video a public page shows, fetched with yt-dlp, kept current.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { createInterface } from "node:readline";
import {
  cacheDir,
  type DownloadProgress,
  exists,
  pinnedFile,
  removeOtherPins,
} from "./download.ts";
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
 * one. A binary is kept only once its hash matched, so none is run that did not.
 */
export async function ytDlp(options: YtDlpOptions = {}): Promise<string> {
  const asset = ytDlpAsset();
  if (!asset) {
    throw new LinkError("unsupported", `No yt-dlp for ${process.platform} on ${process.arch}`);
  }
  const dir = options.dir ?? cacheDir();
  const suffix = process.platform === "win32" ? ".exe" : "";
  const sums = await fetch(new URL("SHA2-256SUMS", options.release ?? YT_DLP_RELEASE), {
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!sums?.ok) {
    const kept = (await readdir(dir).catch(() => [])).find((name) =>
      /^yt-dlp-[0-9a-f]{12}(\.exe)?$/.test(name),
    );
    if (kept) return join(dir, kept);
    throw new LinkError(
      "offline",
      `Could not reach GitHub to download yt-dlp, which imports links${sums ? ` (HTTP ${sums.status})` : ""}`,
    );
  }
  const listed = (await sums.text())
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === asset)?.[0];
  if (!listed || !/^[0-9a-f]{64}$/.test(listed)) {
    throw new LinkError("failed", `The latest yt-dlp release lists no ${asset}`);
  }
  const path = join(dir, `yt-dlp-${listed.slice(0, 12)}${suffix}`);
  if (await exists(path)) return path;
  // The asset from the release whose sums were read, which a newer release cannot replace
  // between the two requests.
  const url = new URL(asset, sums.url).href;
  await pinnedFile(url, listed, path, "yt-dlp", 0o755, options.onDownload);
  await removeOtherPins(path, "yt-dlp-");
  return path;
}

/** What every run of yt-dlp is given: no configuration file, no cookies from a file or a
 * browser, one video rather than its playlist, the Node that runs this for YouTube's
 * JavaScript, and a cache of its own. */
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
  return {
    url,
    id: String(info.id ?? ""),
    title: String(info.title ?? info.id ?? url),
    seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null,
    site: String(info.extractor_key ?? info.extractor ?? ""),
  };
}

export interface FetchOptions extends LinkOptions {
  /** The file's name without its extension, from the video read; `<title> [<id>]` as yt-dlp
   * makes it safe, unless given. */
  stem?: (video: LinkVideo) => string;
  /** Bytes fetched so far of the video's size, as the site gives it. */
  onProgress?: (bytes: number, total: number, video: LinkVideo) => void;
}

/**
 * Fetches the video `url` shows into `dir`: the best quality up to 1080p (the shorter side), or
 * the best there is below it, as MP4 where its streams allow, else Matroska, never re-encoded.
 * It is read first, so a link readLink refuses is refused here too. The file is written in a
 * folder of its own inside `dir` and moved into place once whole, so `dir` never holds part of
 * one; the folder goes whatever happens.
 */
export async function fetchLink(
  url: string,
  dir: string,
  options: FetchOptions = {},
): Promise<{ path: string; video: LinkVideo }> {
  const program = options.program ?? [await ytDlp()];
  const video = await readLink(url, { ...options, program });
  const stem = options.stem?.(video);
  const work = join(dir, `.link-${randomUUID()}`);
  await mkdir(work, { recursive: true });
  try {
    let expected = 0;
    let done = 0;
    let format = "";
    let current = 0;
    let file = "";
    const args = [
      ...common(),
      ...["-S", "res:1080,ext"],
      ...["--merge-output-format", "mp4/mkv", "--remux-video", "mp4/mkv"],
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
    const name = stem ? `${stem}${extname(file)}` : file.slice(work.length + 1);
    const path = join(dir, name);
    await rename(file, path);
    const { size } = await stat(path);
    options.onProgress?.(size, size, video);
    return { path, video };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

const windows = process.platform === "win32";

/** Runs yt-dlp, handing each stdout line to `onLine`; a failure is a LinkError from its own
 * words. It stays in the caller's process group, so whatever stops the caller's group (Ctrl+C,
 * quitting the app, stopping an edit) stops it too; on Windows, stopping it ends its tree. */
function runYtDlp(
  program: readonly string[],
  args: string[],
  signal: AbortSignal | undefined,
  onLine: (line: string) => void,
): Promise<void> {
  const [command, ...first] = program;
  if (!command) throw new Error("No yt-dlp");
  signal?.throwIfAborted();
  const child: ChildProcess = spawn(command, [...first, ...args], {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const stop = () => {
    if (child.pid === undefined || child.exitCode !== null) return;
    if (windows) {
      spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
    } else child.kill("SIGTERM");
  };
  signal?.addEventListener("abort", stop, { once: true });
  let error = "";
  if (child.stdout) createInterface({ input: child.stdout }).on("line", onLine);
  if (child.stderr) {
    createInterface({ input: child.stderr }).on("line", (line) => {
      if (line.startsWith("ERROR:")) error = line.slice("ERROR:".length).trim();
    });
  }
  return new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => {
      signal?.removeEventListener("abort", stop);
      if (signal?.aborted) reject(signal.reason);
      else if (code === 0) resolve();
      else reject(fromYtDlp(error || `yt-dlp exited with code ${code}`));
    });
  });
}

/** yt-dlp's error, as the problem a person can act on. */
export function fromYtDlp(error: string): LinkError {
  const url = /^\[[^\]]+\] ([^:]+):/.exec(error)?.[1] ?? "The link";
  const text = error.toLowerCase();
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
