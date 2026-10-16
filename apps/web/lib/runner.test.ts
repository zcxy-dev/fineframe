import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { runEdit } from "./runner.ts";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("stopping an edit stops the programs it started too", async () => {
  const dir = await mkdtemp(join(tmpdir(), "runner-"));
  try {
    // The edit starts a program of its own, as it starts the analysis and FFmpeg, and says its
    // process ID once it runs.
    const child = `setInterval(() => {}, 1000)`;
    const edit = `
      const { spawn } = require("node:child_process");
      const child = spawn(process.execPath, ["-e", ${JSON.stringify(child)}], { stdio: "ignore" });
      require("node:fs").writeFileSync(${JSON.stringify(join(dir, "pid"))}, String(child.pid));
      setInterval(() => {}, 1000);
    `;
    const run = runEdit({
      command: [process.execPath, "-e", edit],
      args: [],
      cwd: dir,
      onProgress: () => {},
      onLog: () => {},
    });
    let pid = 0;
    for (let tries = 0; tries < 100 && !pid; tries++) {
      pid = Number(await readFile(join(dir, "pid"), "utf8").catch(() => "0"));
      if (!pid) await sleep(100);
    }
    assert.ok(pid, "the edit never started its program");
    run.stop();
    await run.exited;
    for (let tries = 0; tries < 50 && alive(pid); tries++) await sleep(100);
    assert.equal(alive(pid), false, "the edit's program outlived it");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
