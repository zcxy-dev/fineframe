// Stages what the installer carries besides Electron, for electron-builder to package:
//
//   node scripts/stage.ts
//
// - build/editor/: the repository's layout as the page's server and `pnpm edit` expect it, with
//   the page built and only the packages they run (installed without symlinks between
//   dependencies, as an installer copies files; the page's own, such as its icons, are
//   devDependencies, which its build compiles in), the worker's code and lockfile, from which
//   the app installs the analysis's Python on its first start, and the agent skill its menu
//   installs. No FFmpeg, ffprobe or Chrome: the
//   renderer downloads them on first use. With FINEFRAME_SUPABASE_URL,
//   FINEFRAME_SUPABASE_PUBLISHABLE_KEY and FINEFRAME_OAUTH_CLIENT_ID, all public, also
//   supabase.json, the project and OAuth client the app signs in with (apps/web/lib/account.ts);
//   a build without them cannot sign in.
// - build/bin/: uv, pinned by version and SHA-256 for the platform this runs on.
//
// It builds for the platform it runs on: each installer is built on its own system.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { copyPage } from "./page.ts";

const desktop = fileURLToPath(new URL("..", import.meta.url));
const root = join(desktop, "..", "..");
const build = join(desktop, "build");
const editor = join(build, "editor");

/** The uv that mise.toml pins, from its release on GitHub. */
const UV_VERSION = "0.13.0";
const UV: Record<string, { target: string; sha256: string }> = {
  "darwin-arm64": {
    target: "aarch64-apple-darwin",
    sha256: "a9c1b29002cf3c83f07fa9cd8a887a3be0107d90e23189721221e7257db8e3d6",
  },
  "linux-x64": {
    target: "x86_64-unknown-linux-gnu",
    sha256: "1468ebd5a5541121837c5a2817b9972ba6090fa6caa3d142620850a47fb75154",
  },
  "linux-arm64": {
    target: "aarch64-unknown-linux-gnu",
    sha256: "3ccfb6af6e242433eb552f7d9676abd5412c6595c497e990d9c8cb7b5bd4d2c3",
  },
  "win32-x64": {
    target: "x86_64-pc-windows-msvc",
    sha256: "088962f9e7b7bd9ea740c04c650b2a21c8928c345bd99ac24350dc924dba656c",
  },
};
const windows = process.platform === "win32";

function run(program: string, args: string[], cwd: string): string {
  const result = spawnSync(program, args, {
    cwd,
    // pnpm is a .cmd script on Windows, which only a shell runs.
    shell: windows && program === "pnpm",
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`${program} ${args.join(" ")} failed`);
  return result.stdout;
}

const say = (line: string) => console.log(`stage: ${line}`);

// What the editor runs, as git has it (new files included, ignored ones never): the worker
// without its tests, and the desktop app's package.json only, so the lockfile still matches.
const PARTS = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".node-version",
  ".python-version",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "apps/web",
  "apps/desktop/package.json",
  "packages",
  "skills",
  "worker",
];
const listed = run(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard", ...PARTS],
  root,
)
  .split("\0")
  .filter((file) => file && !file.startsWith("worker/tests/"));

say("building the page");
run("pnpm", ["--filter", "@video-editor/web", "build"], root);

await rm(build, { recursive: true, force: true });
say(`copying ${listed.length} files`);
for (const file of new Set(listed)) {
  const to = join(editor, file);
  await mkdir(dirname(to), { recursive: true });
  // A file deleted but not yet committed is listed too; it is left out.
  await cp(join(root, file), to).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}
await copyPage(join(root, "apps", "web", ".next"), join(editor, "apps", "web", ".next"));

const supabase = {
  url: process.env.FINEFRAME_SUPABASE_URL,
  publishableKey: process.env.FINEFRAME_SUPABASE_PUBLISHABLE_KEY,
  clientId: process.env.FINEFRAME_OAUTH_CLIENT_ID,
};
if (supabase.url && supabase.publishableKey && supabase.clientId) {
  await writeFile(join(editor, "supabase.json"), `${JSON.stringify(supabase, null, 2)}\n`);
} else {
  say(
    "no FINEFRAME_SUPABASE_URL, FINEFRAME_SUPABASE_PUBLISHABLE_KEY and FINEFRAME_OAUTH_CLIENT_ID: this build cannot sign in",
  );
}

say("installing the packages the editor runs");
run(
  "pnpm",
  ["install", "--prod", "--frozen-lockfile", "--ignore-scripts", "--config.node-linker=hoisted"],
  editor,
);

// Not passed on in the installer: sharp and its libvips (LGPL), which come with Next.js for image
// optimisation and with HyperFrames' studio server, and neither the page nor a render uses.
const modules = join(editor, "node_modules");
await rm(join(modules, "sharp"), { recursive: true, force: true });
await rm(join(modules, "@img"), { recursive: true, force: true });
// Nor the packages' source maps, which only a debugger reads: a quarter of their files, and
// signing the macOS app opens every file it holds at once.
for (const entry of await readdir(editor, { recursive: true, withFileTypes: true })) {
  const path = join(entry.parentPath, entry.name);
  if (entry.isFile() && entry.name.endsWith(".map") && path.includes(`${sep}node_modules${sep}`))
    await rm(path);
}

// An NSIS installer keeps no links, and pnpm links the workspace's own packages, which Node runs
// as TypeScript only from outside node_modules, so a copy will not do: on Windows the links are
// listed in links.json and left out, and the app makes them again as junctions on its first start
// (src/server.ts).
if (windows) {
  const links = (await readdir(editor, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isSymbolicLink() && !entry.parentPath.includes(".bin"))
    .map((entry) => join(entry.parentPath, entry.name));
  const listed: { path: string; target: string }[] = [];
  const slashed = (path: string) => relative(editor, path).split(sep).join("/");
  for (const link of links) {
    listed.push({ path: slashed(link), target: slashed(await realpath(link)) });
    await rm(link, { recursive: true, force: true });
  }
  await writeFile(join(editor, "links.json"), `${JSON.stringify(listed, null, 2)}\n`);
}

const platform = `${process.platform}-${process.arch}`;
const uv = UV[platform];
if (!uv) throw new Error(`No pinned uv for ${platform}`);
const packed = windows ? "zip" : "tar.gz";
const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${uv.target}.${packed}`;
say(`downloading uv ${UV_VERSION} for ${platform}`);
const response = await fetch(url);
if (!response.ok) throw new Error(`Could not download ${url}: HTTP ${response.status}`);
const archive = Buffer.from(await response.arrayBuffer());
const actual = createHash("sha256").update(archive).digest("hex");
if (actual !== uv.sha256) throw new Error(`${url} has SHA-256 ${actual}, expected ${uv.sha256}`);
const bin = join(build, "bin");
await mkdir(bin, { recursive: true });
await writeFile(join(build, `uv.${packed}`), archive);
// Windows' own tar reads zip files too; Git's, which may come first on PATH, does not.
if (windows) {
  const tar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  run(tar, ["-xf", "uv.zip", "-C", "bin", "uv.exe"], build);
} else {
  run(
    "tar",
    ["-xzf", "uv.tar.gz", "--strip-components=1", "-C", "bin", `uv-${uv.target}/uv`],
    build,
  );
  await chmod(join(bin, "uv"), 0o755);
}
await rm(join(build, `uv.${packed}`));

const version = JSON.parse(await readFile(join(desktop, "package.json"), "utf8")).version;
say(`staged the editor ${version} for ${platform} in ${build}`);
