import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Writable } from "node:stream";
import { gunzipSync } from "node:zlib";
import { cacheDir, type DownloadProgress, exists, pinnedFile, untar } from "./download.ts";

/** Flags every FFmpeg run shares: quiet unless something fails, and never reading the terminal. */
export const QUIET = ["-hide_banner", "-nostdin", "-nostats", "-loglevel", "error"];

/** Overrides the pinned build, e.g. with a system FFmpeg; it must pass the same feature check. */
export const FFMPEG_ENV = "VIDEO_EDITOR_FFMPEG";

// The static builds imageio-ffmpeg 0.6.0 ships to bench/ and worker/, from the repository it
// builds its wheels from, at a fixed commit.
const IMAGEIO =
  "https://raw.githubusercontent.com/imageio/imageio-binaries/f8f64710ea88e7e4a352c0f7d8c0deac9f5fd685/ffmpeg";
const PINNED: Record<string, { url: string; sha256: string }> = {
  "linux-x64": {
    url: `${IMAGEIO}/ffmpeg-linux-x86_64-v7.0.2`,
    sha256: "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99",
  },
  "linux-arm64": {
    url: `${IMAGEIO}/ffmpeg-linux-aarch64-v7.0.2`,
    sha256: "6bb182d0d75d23028db82e9e4f723ca69b853d055698486e6984ddb2c06fb8ce",
  },
  "darwin-arm64": {
    url: `${IMAGEIO}/ffmpeg-macos-aarch64-v7.1`,
    sha256: "6d175a4743ca50256e89a8cdd731100f9cee33bd79aeea46894d209410dc6617",
  },
  "win32-x64": {
    url: `${IMAGEIO}/ffmpeg-win-x86_64-v7.1.exe`,
    sha256: "2ce797a0f88d7f067180338fb227f7b1928ea727bd9a4d7a1d022f7c52af71a3",
  },
};

/** Overrides the pinned ffprobe, which the effects renderer runs to check what it wrote. */
const FFPROBE_ENV = "VIDEO_EDITOR_FFPROBE";

// ffprobe for each system, from the npm packages @ffprobe-installer publishes: the static builds
// of johnvansickle.com (Linux), gyan.dev (Windows) and Homebrew (macOS, linking only the
// system's own libraries), each a tarball pinned by SHA-256.
const NPM = "https://registry.npmjs.org/@ffprobe-installer";
const PINNED_FFPROBE: Record<string, { url: string; sha256: string }> = {
  "linux-x64": {
    url: `${NPM}/linux-x64/-/linux-x64-5.2.0.tgz`,
    sha256: "8b6b2e34bad5ea7cfbe1914185145f514f620f24203a1a421e8d00a698bf8e61",
  },
  "linux-arm64": {
    url: `${NPM}/linux-arm64/-/linux-arm64-5.2.0.tgz`,
    sha256: "369ec8159c5a347e460fe5e2cc9a7e3ed9c53acecb8f29e2a6491e756103c060",
  },
  "darwin-arm64": {
    url: `${NPM}/darwin-arm64/-/darwin-arm64-5.0.1.tgz`,
    sha256: "27069fc32879761968823c3ce5353d3c6573f5df7d83d40b60bc2d878e886d39",
  },
  "win32-x64": {
    url: `${NPM}/win32-x64/-/win32-x64-5.1.0.tgz`,
    sha256: "97992b5e3b651c7df625831fd369eecc5ec0e9532ac98921138b1c4fbc8de96e",
  },
};

let probe: Promise<string> | undefined;

/** The ffprobe binary: `VIDEO_EDITOR_FFPROBE`, or the pinned build, unpacked from its tarball
 * on first use with `onDownload` hearing the download's progress. */
export function ffprobe(onDownload?: DownloadProgress): Promise<string> {
  probe ??= (async () => process.env[FFPROBE_ENV] || (await pinnedProbe(onDownload)))();
  probe.catch(() => {
    probe = undefined;
  });
  return probe;
}

async function pinnedProbe(onDownload?: DownloadProgress): Promise<string> {
  const platform = `${process.platform}-${process.arch}`;
  const build = PINNED_FFPROBE[platform];
  if (!build) throw new Error(`No pinned ffprobe build for ${platform}; set ${FFPROBE_ENV}.`);
  const name = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
  const dir = join(cacheDir(), `ffprobe-${build.sha256.slice(0, 12)}`);
  const path = join(dir, name);
  if (await exists(path)) return path;
  const tarball = await pinnedFile(
    build.url,
    build.sha256,
    `${dir}.tgz`,
    "the pinned ffprobe build",
    0o644,
    onDownload,
  );
  const entry = [...untar(gunzipSync(await readFile(tarball)))].find(
    ([file]) => file === `package/${name}`,
  );
  if (!entry) throw new Error(`${tarball} holds no package/${name}`);
  await mkdir(dir, { recursive: true });
  // Written beside the target and renamed into place, so a concurrent render never runs half of it.
  const partial = `${path}.${process.pid}.partial`;
  try {
    await writeFile(partial, entry[1]);
    await chmod(partial, 0o755);
    await rename(partial, path).catch(async (error: unknown) => {
      if (!(await exists(path))) throw error;
    });
  } finally {
    await rm(partial, { force: true });
  }
  await rm(tarball, { force: true });
  return path;
}

/** Every filter the render graphs and the colour measurements use, plus libass for captions. */
export const REQUIRED_FILTERS = [
  "acompressor",
  "acrossfade",
  "acrossover",
  "adelay",
  "afade",
  "aformat",
  "agate",
  "alimiter",
  "amix",
  "amultiply",
  "anullsrc",
  "apad",
  "aresample",
  "asetpts",
  "asettb",
  "ass",
  "atrim",
  "crop",
  "dynaudnorm",
  "eq",
  "equalizer",
  "fade",
  "format",
  "fps",
  "highpass",
  "highshelf",
  "loudnorm",
  "lowshelf",
  "lut3d",
  "metadata",
  "overlay",
  "pan",
  "perspective",
  "scale",
  "setparams",
  "setpts",
  "setsar",
  "settb",
  "signalstats",
  "tonemap",
  "tpad",
  "trim",
  "volume",
  "xfade",
  "zscale",
];
export const REQUIRED_ENCODERS = ["libx264", "aac"];
/** libvpx reads the alpha of the effect overlays (VP9 in WebM). */
export const REQUIRED_DECODERS = ["libvpx-vp9"];

let resolved: Promise<string> | undefined;

/** The FFmpeg binary to run: `VIDEO_EDITOR_FFMPEG`, or the pinned build, downloaded and checked
 * against its SHA-256 on first use, with `onDownload` hearing its progress. Either way it is
 * checked for every filter and encoder the renderer needs, so a build without one fails here
 * instead of halfway through a render. */
export function ffmpeg(onDownload?: DownloadProgress): Promise<string> {
  resolved ??= (async () => {
    const path = process.env[FFMPEG_ENV] || (await pinned(onDownload));
    await checkFeatures(path);
    return path;
  })();
  // A failed download or check is not cached, so the next call tries again.
  resolved.catch(() => {
    resolved = undefined;
  });
  return resolved;
}

async function pinned(onDownload?: DownloadProgress): Promise<string> {
  const platform = `${process.platform}-${process.arch}`;
  const build = PINNED[platform];
  if (!build) {
    throw new Error(
      `No pinned FFmpeg build for ${platform}; set ${FFMPEG_ENV} to an FFmpeg with ` +
        `libass, libx264, libvpx and zimg (zscale).`,
    );
  }
  const name = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const path = join(cacheDir(), `ffmpeg-${build.sha256.slice(0, 12)}`, name);
  return pinnedFile(build.url, build.sha256, path, "the pinned FFmpeg build", 0o755, onDownload);
}

/** Names in `ffmpeg -filters` output. */
export function parseFilters(listing: string): Set<string> {
  // " T.C afade             A->A       Fade in/out input audio."
  const names = listing.matchAll(/^ [T.][S.][C.] (\S+)\s+\S*->\S*\s/gm);
  return new Set([...names].map((match) => match[1] as string));
}

/** Names in `ffmpeg -encoders` or `ffmpeg -decoders` output. */
export function parseCodecs(listing: string): Set<string> {
  // " V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10"
  const names = listing.matchAll(/^ [VAS][F.][S.][X.][B.][D.] (\w\S*)/gm);
  return new Set([...names].map((match) => match[1] as string));
}

/** Fails naming every filter, encoder and decoder the build lacks, and whether it reads a filter
 * graph from a file. */
export async function checkFeatures(path: string): Promise<void> {
  const [filters, encoders, decoders, graphFiles] = await Promise.all([
    run(path, ["-hide_banner", "-filters"]).then((out) => parseFilters(out.stdout)),
    run(path, ["-hide_banner", "-encoders"]).then((out) => parseCodecs(out.stdout)),
    run(path, ["-hide_banner", "-decoders"]).then((out) => parseCodecs(out.stdout)),
    readsGraphFiles(path),
  ]);
  const lacking = (kind: string, names: string[], found: Set<string>) =>
    names.filter((name) => !found.has(name)).map((name) => `${kind} ${name}`);
  const missing = [
    ...lacking("filter", REQUIRED_FILTERS, filters),
    ...lacking("encoder", REQUIRED_ENCODERS, encoders),
    ...lacking("decoder", REQUIRED_DECODERS, decoders),
    ...(graphFiles ? [] : ["-/filter_complex (FFmpeg 7.0 or later)"]),
  ];
  if (missing.length > 0) {
    throw new Error(
      `${path} lacks ${missing.join(", ")}. The renderer needs an FFmpeg built with libass, ` +
        `libx264, libvpx and zimg; unset ${FFMPEG_ENV} to use the pinned build.`,
    );
  }
}

/** Every render reads its filter graphs from files, since a crop path's can outgrow one
 * command-line argument; FFmpeg before 7.0 knows no `-/` option prefix and would fail only once
 * the sound is done. */
async function readsGraphFiles(path: string): Promise<boolean> {
  const dir = await mkdtemp(join(tmpdir(), "video-editor-graph-"));
  try {
    const graph = join(dir, "graph.txt");
    await writeFile(graph, "color=s=16x16[v]");
    const args = ["-/filter_complex", graph, "-map", "[v]", "-frames:v", "1", "-f", "null", "-"];
    await run(path, ["-hide_banner", "-v", "error", ...args]);
    return true;
  } catch {
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export interface RunResult {
  stdout: string;
  stderr: string;
}

/** Runs FFmpeg to completion and returns what it printed; a non-zero exit throws with the end
 * of its log. `stdout` may instead be where FFmpeg writes directly: a pipe such as the
 * encoder's stdin, or a file descriptor. */
export function run(path: string, args: string[], stdout?: Writable | number): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(path, args, { stdio: ["ignore", stdout ?? "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => {
      const stderr = Buffer.concat(err).toString();
      if (code === 0) {
        resolve({ stdout: Buffer.concat(out).toString(), stderr });
        return;
      }
      const tail = stderr.trim().split("\n").slice(-8).join("\n");
      reject(new Error(`ffmpeg exited with ${signal ?? code}:\n${tail}`));
    });
  });
}
