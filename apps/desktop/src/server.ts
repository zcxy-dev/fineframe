// The page's server as the desktop app runs it: on a free port on this machine's loopback
// address, with the app's own folders for the keys and the analysis's Python, and stopped with
// everything it started when the app quits. Only Node's own modules, so it is tested without
// Electron.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, lstat, mkdir, readFile, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { delimiter, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/** Where the app's parts are and where it keeps its own files. */
export interface Places {
  /** The repository's layout: apps/web built, packages/, worker/. */
  editor: string;
  /** Holds uv, which installs and runs the analysis; null to use the one on PATH. */
  bin: string | null;
  /** The app's own folder for the user: the keys and the analysis's Python. */
  data: string;
  /** Where the server's output is written. */
  log: string;
}

/**
 * Makes again the links between the workspace's packages that the Windows installer could not
 * carry (scripts/stage.ts lists them in links.json), as junctions, which need no administrator.
 * Each is made once; elsewhere there is no list and nothing to do.
 */
export async function restoreLinks(editor: string): Promise<void> {
  const list = await readFile(join(editor, "links.json"), "utf8").catch(() => null);
  if (!list) return;
  for (const { path, target } of JSON.parse(list) as { path: string; target: string }[]) {
    const link = join(editor, ...path.split("/"));
    if (
      await lstat(link).then(
        () => true,
        () => false,
      )
    )
      continue;
    await mkdir(dirname(link), { recursive: true });
    await symlink(join(editor, ...target.split("/")), link, "junction");
  }
}

/** A port nothing listens on at 127.0.0.1, as the system hands one out. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === "object" && address
          ? resolve(address.port)
          : reject(new Error("No port")),
      );
    });
  });
}

/**
 * The server's environment: the inherited one, run as plain Node by this app's own binary, with
 * the keys in the app's folder rather than a repository's .env, and uv told to install the
 * analysis's Python and its locked packages there too, never anything of the user's own.
 */
export function serverEnvironment(
  places: Places,
  port: number,
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const python = join(places.data, "python");
  // Windows names it Path, and would take either of two spellings.
  const path = Object.keys(inherited).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
  return {
    ...inherited,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    VIDEO_EDITOR_HOST: "127.0.0.1",
    PORT: String(port),
    VIDEO_EDITOR_ENV_FILE: join(places.data, "keys.env"),
    VIDEO_EDITOR_BRAND_KITS: join(places.data, "brand-kits"),
    VIDEO_EDITOR_SETUP: "1",
    VIDEO_EDITOR_STOP_WITH_STDIN: "1",
    [path]: [places.bin, inherited[path]].filter(Boolean).join(delimiter),
    UV_PROJECT_ENVIRONMENT: join(python, "env"),
    UV_PYTHON_INSTALL_DIR: join(python, "cpython"),
    UV_CACHE_DIR: join(python, "cache"),
    UV_PYTHON_PREFERENCE: "only-managed",
    UV_NO_CONFIG: "1",
    UV_FROZEN: "1",
    UV_NO_DEV: "1",
    UV_NO_EDITABLE: "1",
  };
}

export interface Server {
  url: string;
  child: ChildProcess;
  /** Settles when the server has exited, with its exit code. */
  exited: Promise<number | null>;
  /** Stops the server and every process it started; settles once they are gone. */
  stop: () => Promise<void>;
}

/** Whether the page answers at `url` with its own JSON. */
async function answers(url: string): Promise<boolean> {
  try {
    const response = await fetch(`${url}/api/key`, { signal: AbortSignal.timeout(2000) });
    return response.ok && "set" in ((await response.json()) as object);
  } catch {
    return false;
  }
}

/**
 * Starts the page's server with `node` (this app's binary, run as Node) and waits until the page
 * answers. Its output goes to `places.log`, which never holds a key: the server prints none.
 */
export async function startServer(
  places: Places,
  node: string,
  inherited: NodeJS.ProcessEnv = process.env,
): Promise<Server> {
  await restoreLinks(places.editor);
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const web = join(places.editor, "apps", "web");
  // The keys are in it: its owner's alone, however it was made.
  await mkdir(places.data, { recursive: true });
  await chmod(places.data, 0o700);
  await mkdir(dirname(places.log), { recursive: true });
  const log = createWriteStream(places.log, { flags: "w" });
  // Wherever the install put it: beside the page, or hoisted to the root.
  const next = createRequire(join(web, "package.json")).resolve("next/dist/bin/next");
  const child = spawn(node, [next, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: web,
    env: serverEnvironment(places, port, inherited),
    // Its stdin stays open while the app runs: if the app ends without stopping it, even
    // force-quit, the pipe closes and the server exits (apps/web/instrumentation.ts).
    stdio: ["pipe", "pipe", "pipe"],
    // A process group of its own, stopped whole: the analysis and FFmpeg run under it.
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  child.stdout?.pipe(log, { end: false });
  child.stderr?.pipe(log, { end: false });
  const exited = new Promise<number | null>((resolve) => {
    child.once("error", () => resolve(null));
    child.once("exit", (code) => resolve(code));
  });
  const stop = () => stopTree(child, exited).finally(() => log.end());
  let gone = false;
  void exited.then(() => {
    gone = true;
  });
  for (let tries = 0; tries < 600; tries++) {
    if (gone) break;
    if (await answers(url)) return { url, child, exited, stop };
    await sleep(100);
  }
  await stop();
  throw new Error(`The editor's server did not start; its output is in ${places.log}`);
}

/**
 * Stops `child` with everything it started, returning once all of it is gone. On macOS and
 * Linux its whole process group is asked to stop, and made to after a few seconds; the server
 * stops a running edit's own group as it exits. On Windows, taskkill stops the tree.
 */
async function stopTree(child: ChildProcess, exited: Promise<unknown>): Promise<void> {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
    await exited;
    return;
  }
  const signal = (name: NodeJS.Signals) => {
    try {
      process.kill(-pid, name);
    } catch {
      // Already gone.
    }
  };
  // The server exiting is not enough: what it started may still be shutting down.
  const groupGone = async (ms: number) => {
    for (let waited = 0; waited < ms; waited += 50) {
      try {
        process.kill(-pid, 0);
      } catch {
        return true;
      }
      await sleep(50);
    }
    return false;
  };
  signal("SIGTERM");
  const stopped = await Promise.race([exited.then(() => true), sleep(5000).then(() => false)]);
  if (!stopped || !(await groupGone(5000))) {
    signal("SIGKILL");
    await exited;
    await groupGone(5000);
  }
}
