import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { cachedIndex, type Worker, workerVersion } from "./analyze.ts";

const WORKER = fileURLToPath(new URL("../../../../worker/", import.meta.url));

/** A copy of the worker's hashed files, to change one thing at a time. */
async function copy(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "worker-"));
  for (const file of ["pyproject.toml", "uv.lock", "src"]) {
    await cp(join(WORKER, file), join(dir, file), { recursive: true });
  }
  return dir;
}

async function edit(file: string, from: RegExp, to: string): Promise<void> {
  const text = (await readFile(file, "utf8")).replaceAll("\r\n", "\n");
  assert.match(text, from);
  await writeFile(file, text.replace(from, to));
}

test("a release's version bump keeps the cached indexes, a change to the code does not", async () => {
  const dir = await copy();
  const before = await workerVersion(dir);

  await edit(join(dir, "pyproject.toml"), /^version = "[^"]+"$/m, 'version = "9.9.9"');
  await edit(join(dir, "uv.lock"), /(\nname = "vework"\nversion = )"[^"]+"/, '$1"9.9.9"');
  assert.equal(await workerVersion(dir), before);

  await edit(join(dir, "src", "vework", "audio.py"), /$/, "\n# changed\n");
  assert.notEqual(await workerVersion(dir), before);
});

test("a change to a dependency's locked version changes the worker's version", async () => {
  const dir = await copy();
  const before = await workerVersion(dir);
  await edit(join(dir, "uv.lock"), /(\nname = "numpy"\nversion = )"[^"]+"/, '$1"0.0.1"');
  assert.notEqual(await workerVersion(dir), before);
});

test("a Windows checkout, with CRLF line endings, has the same version as any other", async () => {
  const dir = await copy();
  const before = await workerVersion(dir);
  for (const file of ["pyproject.toml", "uv.lock"]) {
    const path = join(dir, file);
    const lf = (await readFile(path, "utf8")).replaceAll("\r\n", "\n");
    await writeFile(path, lf.replaceAll("\n", "\r\n"));
  }
  assert.equal(await workerVersion(dir), before);
});

test("a file analysed before is read from the cache, without running vework again", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cached-"));
  const source = join(dir, "talk.mp4");
  await writeFile(source, "footage");
  // What the stand-in for vework copies to the index it is asked for.
  await writeFile(join(dir, "talk.index.json"), "{}");
  const calls = join(dir, "vework.jsonl");
  process.env.FAKE_VEWORK_LOG = calls;
  const worker: Worker = {
    command: [process.execPath, fileURLToPath(new URL("fixtures/vework.ts", import.meta.url))],
    version: "test",
  };
  const file = { given: source, path: source, kind: "video" as const };
  const cache = join(dir, "cache");
  const quiet = () => {};
  const first = await cachedIndex(worker, file, { correct: false }, cache, quiet, quiet);
  const second = await cachedIndex(worker, file, { correct: false }, cache, quiet, quiet);
  assert.equal(second, first);
  assert.equal((await readFile(first, "utf8")).trim(), "{}");
  assert.equal((await readFile(calls, "utf8")).trim().split("\n").length, 1);
});
