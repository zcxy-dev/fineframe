// `pnpm start` at the repository root, or `mise run start` where only mise is installed: sets up
// what is missing, builds the page when its code changed, starts the server on 127.0.0.1 and opens
// the page in the browser. `--no-open` leaves the browser alone. Only Node's own modules are used,
// as the packages may not be installed yet.
import { type SpawnOptions, spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { statfs } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const web = join(root, "apps", "web");
const host = process.env.VIDEO_EDITOR_HOST || "127.0.0.1";
const port = process.env.PORT || "3000";
const url = `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
// Corepack would otherwise stop to ask before it fetches the pinned pnpm.
const env = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" };
// pnpm is a .cmd script on Windows, which only a shell runs.
const shell = process.platform === "win32";
const MISE = "Install mise (https://mise.jdx.dev), then run `mise run start` in the repository";

const say = (line: string) => console.log(`start: ${line}`);
function fail(problem: string, fix: string): never {
  console.error(`start: ${problem}\n  ${fix}`);
  process.exit(1);
}

/** `program` with `args`, as spawn takes them: one command line where a shell runs it, since
 * Node warns of arguments passed to a shell unescaped. Every argument here is a plain word. */
const command = (program: string, args: string[]): [string, string[]] =>
  shell ? [[program, ...args].join(" "), []] : [program, args];

function run(program: string, args: string[], options: SpawnOptions = {}): void {
  const result = spawnSync(...command(program, args), { stdio: "inherit", env, shell, ...options });
  if (result.status !== 0)
    fail(`\`${program} ${args.join(" ")}\` failed.`, "Its output above says why.");
}

const has = (program: string) =>
  spawnSync(...command(program, ["--version"]), { stdio: "ignore", env, shell }).status === 0;

const wanted = Number(readFileSync(join(root, ".node-version"), "utf8").trim().split(".")[0]);
if (Number(process.versions.node.split(".")[0]) < wanted) {
  fail(`The page needs Node ${wanted} or newer; this is Node ${process.versions.node}.`, MISE);
}
if (!has("pnpm")) fail("pnpm is not installed.", `Run \`corepack enable\`, or: ${MISE}`);
if (!has("uv")) fail("uv, which runs the analysis, is not installed.", MISE);

/** Whether the page answers at `url`; null when nothing listens there. */
async function answers(): Promise<boolean | null> {
  try {
    const response = await fetch(`${url}/api/key`, { signal: AbortSignal.timeout(2000) });
    return response.ok && "set" in ((await response.json()) as object);
  } catch (error) {
    // Something answered, but not with the page's JSON.
    return error instanceof SyntaxError ? false : null;
  }
}

function openPage(): void {
  if (process.argv.includes("--no-open")) return;
  const [program, ...args] =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  const child = spawn(program as string, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}

// Before building: a build would rewrite the files a running page serves.
const already = await answers();
if (already) {
  say(`the page is already running at ${url}`);
  openPage();
  process.exit(0);
}
if (already === false) {
  fail(`Another program is using port ${port}.`, "Start on another port: PORT=3001 pnpm start");
}

// The first edit downloads the speech model and the analysis environment takes about 2 GB.
const cache = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
const { bavail, bsize } = await statfs(existsSync(cache) ? cache : homedir());
const free = (bavail * bsize) / 1e9;
if (free < 10) {
  say(
    `only ${free.toFixed(1)} GB is free. The first edit needs about 6 GB for the analysis and ` +
      "its models, and each edit a few times its footage: free some space if it runs out.",
  );
}

say("installing the page's packages");
run("pnpm", ["install", "--frozen-lockfile"], { cwd: root });
say("setting up the analysis environment (about 2 GB the first time)");
run("uv", ["sync", "--extra", "ml"], { cwd: join(root, "worker") });

/** The newest modification time of the files under `path`, leaving out what builds write. */
function newest(path: string): number {
  const info = statSync(path, { throwIfNoEntry: false });
  if (!info) return 0;
  if (!info.isDirectory()) return info.mtimeMs;
  let latest = 0;
  for (const name of readdirSync(path)) {
    if (name === "node_modules" || name === ".next") continue;
    latest = Math.max(latest, newest(join(path, name)));
  }
  return latest;
}
const built = statSync(join(web, ".next", "BUILD_ID"), { throwIfNoEntry: false })?.mtimeMs ?? 0;
const sources = [web, join(root, "packages"), join(root, "pnpm-lock.yaml")];
if (Math.max(...sources.map(newest)) > built) {
  say("building the page");
  run("pnpm", ["build"], { cwd: web });
}

// In a process group of its own, stopped whole: pnpm does not pass a signal on to the server.
const server = spawn(...command("pnpm", ["start"]), {
  cwd: web,
  stdio: "inherit",
  env,
  shell,
  detached: !shell,
});
const stop = () => {
  try {
    process.kill(shell ? (server.pid as number) : -(server.pid as number), "SIGTERM");
  } catch {
    // Already stopped.
  }
};
// SIGHUP too: closing the terminal would otherwise leave the server holding the port.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, stop);
server.on("exit", (code) => process.exit(code ?? 0));
let up = false;
for (let tries = 0; tries < 300 && !up; tries++) {
  up = (await answers()) === true;
  if (!up) await sleep(200);
}
if (!up) {
  stop();
  fail(`The page did not answer at ${url} within a minute.`, "The server's output above says why.");
}
say(`the page is at ${url}; Ctrl+C stops it`);
openPage();
