// Runs `pnpm edit` as its own process and reads its progress lines.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import type { Progress } from "@video-editor/schema";

export interface RunOptions {
  /** The program and its first arguments, such as node and the edit command's script. */
  command: readonly string[];
  args: readonly string[];
  cwd: string;
  /** Set in its environment besides the server's own. */
  env?: Record<string, string>;
  onProgress: (line: Progress) => void;
  /** Each line for a person: stderr, and any stdout line that is not progress. */
  onLog: (line: string) => void;
}

export interface Run {
  /** Settles when the process has exited. */
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  /** Stops the edit and everything it started: analysis, FFmpeg. */
  stop: () => void;
}

const windows = process.platform === "win32";

/** Edits still running, stopped when the server exits: in their own process group, nothing
 * else would stop them, and they would keep using memory the next edit needs. */
const live = new Set<Run>();
process.on("exit", () => {
  for (const run of live) run.stop();
});

export function runEdit(options: RunOptions): Run {
  const [program, ...first] = options.command;
  if (!program) throw new Error("No edit command");
  const child: ChildProcess = spawn(program, [...first, ...options.args], {
    cwd: options.cwd,
    // The command resolves its paths against INIT_CWD when pnpm sets it; pnpm may have set it
    // for this server, to another folder.
    env: { ...process.env, ...options.env, INIT_CWD: options.cwd },
    stdio: ["ignore", "pipe", "pipe"],
    // Its own process group, so stopping it also stops the analysis and FFmpeg it runs. Windows
    // has no process groups (stop() ends the process tree there), and a detached edit would give
    // each program it starts a console window.
    detached: !windows,
    windowsHide: true,
  });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    },
  );
  if (child.stdout) {
    createInterface({ input: child.stdout }).on("line", (line) => {
      const progress = parseProgress(line);
      if (progress) options.onProgress(progress);
      else if (line.trim()) options.onLog(line);
    });
  }
  if (child.stderr) createInterface({ input: child.stderr }).on("line", options.onLog);
  let stopped = false;
  const run: Run = {
    exited,
    stop: () => {
      if (stopped || child.pid === undefined || child.exitCode !== null) return;
      stopped = true;
      // Synchronous, as the server's exit handler stops edits too.
      if (windows) {
        const tree = ["/pid", String(child.pid), "/t", "/f"];
        if (spawnSync("taskkill", tree, { stdio: "ignore", windowsHide: true }).status === 0)
          return;
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
          return;
        } catch {}
      }
      child.kill("SIGTERM");
    },
  };
  live.add(run);
  child.once("close", () => live.delete(run));
  return run;
}

/** A progress line, or null for anything else on stdout. */
export function parseProgress(line: string): Progress | null {
  if (!line.startsWith("{")) return null;
  try {
    const value = JSON.parse(line) as Partial<Progress>;
    if (typeof value.stage !== "string" || typeof value.fraction !== "number") return null;
    if (typeof value.message !== "string") return null;
    return value as Progress;
  } catch {
    return null;
  }
}
