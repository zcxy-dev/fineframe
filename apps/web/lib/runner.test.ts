import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  let pid = 0;
  try {
    // The edit starts a program through another, as it starts the analysis through uv: on
    // Windows, what a program Node did not start starts is outside what Node stops. The program
    // says its process ID once it runs.
    const program = join(dir, "program.js");
    await writeFile(
      program,
      `require("node:fs").writeFileSync(${JSON.stringify(join(dir, "pid"))}, String(process.pid));
      setInterval(() => {}, 1000);`,
    );
    const line = `"${process.execPath}" "${program}"`;
    const edit = `
      require("node:child_process").spawn(${JSON.stringify(line)}, { shell: true, stdio: "ignore" });
      setInterval(() => {}, 1000);
    `;
    const run = runEdit({
      command: [process.execPath, "-e", edit],
      args: [],
      cwd: dir,
      onProgress: () => {},
      onLog: () => {},
    });
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
    if (pid && alive(pid)) process.kill(pid);
    await rm(dir, { recursive: true, force: true });
  }
});
