import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { copyFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { pinnedFile } from "./download.ts";
import { scratch } from "./testing.ts";

test("a program another download put in place first is kept, even while it runs", async (t) => {
  const dir = await scratch(t, "download-");
  const path = join(dir, "tool.exe");
  const body = Buffer.from("the pinned program");
  const sha256 = createHash("sha256").update(body).digest("hex");
  let answer = () => {};
  const asked = new Promise<void>((resolve) => {
    answer = resolve;
  });
  const server = createServer(async (_request, response) => {
    await asked;
    response.end(body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  const download = pinnedFile(`http://127.0.0.1:${port}/tool`, sha256, path, "the tool", 0o755);
  // Meanwhile another download finished and its program runs, as concurrent renders run FFmpeg;
  // Windows will not replace a program while it runs.
  await copyFile(process.execPath, path);
  const running = spawn(path, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  try {
    await once(running, "spawn");
    answer();
    assert.equal(await download, path);
  } finally {
    // Stopped before the folder is removed, which Windows refuses while the program runs.
    running.kill();
    await once(running, "exit");
    server.close();
  }
});
