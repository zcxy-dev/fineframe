import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { workerVersion } from "./analyze.ts";

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
  const text = await readFile(file, "utf8");
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
