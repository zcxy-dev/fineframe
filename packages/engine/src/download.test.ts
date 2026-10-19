import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { copyFile, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { pinnedFile, untar } from "./download.ts";
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

test("a pinned download reports its bytes against the size the server gives", async (t) => {
  const body = Buffer.alloc(300_000, 7);
  const server = createServer((_, response) => {
    response.writeHead(200, { "Content-Length": body.length });
    // In pieces, so the progress has more than one step to report.
    response.write(body.subarray(0, 100_000));
    setTimeout(() => response.end(body.subarray(100_000)), 20);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/file`;
  const sha256 = createHash("sha256").update(body).digest("hex");
  const path = join(await scratch(t, "download-"), "file");

  const heard: [number, number][] = [];
  await pinnedFile(url, sha256, path, "a test file", 0o644, (bytes, total) =>
    heard.push([bytes, total]),
  );
  assert.deepEqual(await readFile(path), body);
  assert.ok(heard.length > 1);
  assert.ok(heard.every(([, total]) => total === body.length));
  assert.ok(heard.every(([bytes], i) => i === 0 || bytes > (heard[i - 1] as [number, number])[0]));
  assert.deepEqual(heard.at(-1), [body.length, body.length]);

  // Once it is there, nothing is downloaded or reported.
  heard.length = 0;
  await pinnedFile(url, sha256, path, "a test file", 0o644, (bytes, total) =>
    heard.push([bytes, total]),
  );
  assert.deepEqual(heard, []);
});

/** A ustar archive of `files`, with long paths split into prefix and name. */
function tar(files: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [path, text] of Object.entries(files)) {
    const header = Buffer.alloc(512);
    const cut = path.length > 100 ? path.lastIndexOf("/", 155) : -1;
    header.write(cut > 0 ? path.slice(cut + 1) : path, 0);
    if (cut > 0) header.write(path.slice(0, cut), 345);
    const data = Buffer.from(text);
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write("0", 156);
    header.write("ustar\0", 257);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return Buffer.concat([...blocks, Buffer.alloc(1024)]);
}

test("unpacks a tar archive's files, long paths included", () => {
  const long = `package/${"a".repeat(120)}/icon.svg`;
  const files = { "package/LICENSE": "ISC", [long]: "<svg/>" };
  const read = Object.fromEntries(
    [...untar(tar(files))].map(([path, data]) => [path, data.toString()]),
  );
  assert.deepEqual(read, files);
});
