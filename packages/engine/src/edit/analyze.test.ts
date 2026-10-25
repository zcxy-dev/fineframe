import assert from "node:assert/strict";
import type { RmOptions } from "node:fs";
import fs, { cp, readFile, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { fileURLToPath } from "node:url";
import { scratch } from "../testing.ts";
import {
  type AnalysisOptions,
  analyze,
  cachedIndex,
  indexName,
  type Worker,
  workerVersion,
} from "./analyze.ts";

const WORKER = fileURLToPath(new URL("../../../../worker/", import.meta.url));

/** A copy of the worker's hashed files, to change one thing at a time. */
async function copy(t: TestContext): Promise<string> {
  const dir = await scratch(t, "worker-");
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

test("a release's version bump keeps the cached indexes, a change to the code does not", async (t) => {
  const dir = await copy(t);
  const before = await workerVersion(dir);

  await edit(join(dir, "pyproject.toml"), /^version = "[^"]+"$/m, 'version = "9.9.9"');
  await edit(join(dir, "uv.lock"), /(\nname = "vework"\nversion = )"[^"]+"/, '$1"9.9.9"');
  assert.equal(await workerVersion(dir), before);

  await edit(join(dir, "src", "vework", "audio.py"), /$/, "\n# changed\n");
  const code = await workerVersion(dir);
  assert.notEqual(code, before);

  // Its data, such as the dictionaries the Chinese conversion reads, is part of the code.
  await edit(join(dir, "src", "vework", "everyday_tw.txt"), /$/, "\u9EB5\t\u9EB5\n");
  assert.notEqual(await workerVersion(dir), code);
});

test("a change to a dependency's locked version changes the worker's version", async (t) => {
  const dir = await copy(t);
  const before = await workerVersion(dir);
  await edit(join(dir, "uv.lock"), /(\nname = "numpy"\nversion = )"[^"]+"/, '$1"0.0.1"');
  assert.notEqual(await workerVersion(dir), before);
});

test("a Windows checkout, with CRLF line endings, has the same version as any other", async (t) => {
  const dir = await copy(t);
  const before = await workerVersion(dir);
  for (const file of ["pyproject.toml", "uv.lock"]) {
    const path = join(dir, file);
    const lf = (await readFile(path, "utf8")).replaceAll("\r\n", "\n");
    await writeFile(path, lf.replaceAll("\n", "\r\n"));
  }
  assert.equal(await workerVersion(dir), before);
});

test("a file analysed before is read from the cache, without running vework again", async (t) => {
  const dir = await scratch(t, "cached-");
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

test("the glossary reaches vework only where it uses it, and keys the index only there", async (t) => {
  const dir = await scratch(t, "names-");
  const source = join(dir, "talk.mp4");
  await writeFile(source, "footage");
  await writeFile(join(dir, "talk.index.json"), "{}");
  const calls = join(dir, "vework.jsonl");
  process.env.FAKE_VEWORK_LOG = calls;
  const worker: Worker = {
    command: [process.execPath, fileURLToPath(new URL("fixtures/vework.ts", import.meta.url))],
    version: "test",
  };
  const file = { given: source, path: source, kind: "video" as const };
  const glossary = { path: join(dir, "glossary.txt"), text: "Lin Chia-ying\nRemotion\n" };
  const quiet = () => {};
  const cases: [AnalysisOptions, string[]][] = [
    // vework refuses a glossary it would not use: OpenRouter takes no context prompt.
    [{ correct: false, asr: "cloud", glossary }, ["--asr", "cloud"]],
    [
      { correct: true, asr: "cloud", glossary },
      ["--correct", "--asr", "cloud", "--glossary", glossary.path],
    ],
    [{ correct: false, glossary }, ["--glossary", glossary.path, "--asr-context"]],
    [{ correct: true, glossary }, ["--correct", "--glossary", glossary.path, "--asr-context"]],
  ];
  for (const [options, extra] of cases) {
    await writeFile(calls, "");
    await cachedIndex(worker, file, options, join(dir, "cache"), quiet, quiet);
    const args: string[] = JSON.parse(await readFile(calls, "utf8"));
    assert.deepEqual(args.slice(4), extra);
  }
  const fingerprint = { sha256: "0".repeat(64), bytes: 7 };
  assert.equal(
    indexName(worker, fingerprint, { correct: false, asr: "cloud", glossary }),
    indexName(worker, fingerprint, { correct: false, asr: "cloud" }),
  );
  assert.notEqual(
    indexName(worker, fingerprint, { correct: true, asr: "cloud", glossary }),
    indexName(worker, fingerprint, { correct: true, asr: "cloud" }),
  );
  assert.notEqual(
    indexName(worker, fingerprint, { correct: false, glossary }),
    indexName(worker, fingerprint, { correct: false }),
  );
});

/** Seconds each step took in the three recordings analysed with cloud speech in
 * packages/engine/MEASUREMENTS.md (analysis measurements): shots, faces, transcription and
 * alignment as measured, the rest of each run split between the steps before faces and the
 * denoising, two to one, as with local speech. */
const CLOUD_RUNS: Record<string, [number, number, number, number, number, number, number]> = {
  "Recording A": [152, 9, 9, 46, 9, 15, 69],
  "Recording B": [135, 20, 21, 46, 20, 54, 119],
  "Recording C": [403, 23, 22, 111, 23, 31, 176],
};

test("with cloud speech, the bar moves with the time the analysis's steps take", async (t) => {
  const dir = await scratch(t, "cloud-pace-");
  const source = join(dir, "talk.mp4");
  await writeFile(source, "footage");
  const file = { given: source, path: source, kind: "video" as const };
  const quiet = () => {};
  for (const [name, [shots, speech, events, faces, denoise, transcribe, align]] of Object.entries(
    CLOUD_RUNS,
  )) {
    // Each line vework prints and the seconds until its next one; OpenRouter hears 10 chunks.
    const lines: [string, number][] = [
      ["probing", 0],
      ["detecting shots", shots],
      ["finding speech", speech],
      ["finding audio events", events],
      ["finding faces", faces],
      ["removing noise from speech", denoise],
      ...Array.from({ length: 10 }, (_, i): [string, number] => [
        `transcribing ${i + 1}/10 (US$0.0000 so far)`,
        transcribe / 10,
      ]),
      ...Array.from({ length: 5 }, (_, i): [string, number] => [`aligning ${i + 1}/5`, align / 5]),
    ];
    const script = join(dir, "vework.ts");
    await writeFile(
      script,
      `import { writeFile } from "node:fs/promises";
for (const line of ${JSON.stringify(lines.map(([line]) => line))}) {
  process.stderr.write(\`vework: \${line}\\n\`);
}
await writeFile(process.argv[5] ?? "", "{}");
`,
    );
    const worker: Worker = { command: [process.execPath, script], version: "test" };
    const bar: number[] = [];
    const report = (fraction: number) => bar.push(fraction);
    const index = join(dir, `${name}.index.json`);
    await analyze(worker, file, index, { correct: false, asr: "cloud" }, report, quiet);
    assert.equal(bar.length, lines.length);
    const total = lines.reduce((sum, [, seconds]) => sum + seconds, 0);
    let elapsed = 0;
    for (const [i, [line, seconds]] of lines.entries()) {
      // Each line within 15 % of the run of the share of its time already spent, as near as
      // footage at 30 or 60 fps, whose shots take a third to a half of the run, allows.
      const off = (bar[i] ?? 0) - elapsed / total;
      assert.ok(Math.abs(off) <= 0.15, `${name}: "${line}" at ${bar[i]}, ${off.toFixed(2)} off`);
      elapsed += seconds;
    }
  }
});

test("an index analysed with the Mac's GPU is not reused for one asked of the CPU", (t) => {
  const worker: Worker = { command: ["vework"], version: "test" };
  const fingerprint = { sha256: "0".repeat(64), bytes: 7 };
  const options: AnalysisOptions = { correct: false };
  const configured = process.env.VEWORK_DEVICE;
  t.after(() => {
    if (configured === undefined) delete process.env.VEWORK_DEVICE;
    else process.env.VEWORK_DEVICE = configured;
  });
  delete process.env.VEWORK_DEVICE;
  const either = indexName(worker, fingerprint, options);
  process.env.VEWORK_DEVICE = "CPU";
  assert.notEqual(indexName(worker, fingerprint, options), either);
});

test("the analysis ends, failing, when its folder cannot be removed", async (t) => {
  const dir = await scratch(t, "kept-");
  const source = join(dir, "talk.mp4");
  await writeFile(source, "footage");
  process.env.FAKE_VEWORK_LOG = join(dir, "vework.jsonl");
  // Every removal of vework's folder fails, as when a program still holds it past the retries.
  const held = Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
  const { rm } = fs;
  const removal = t.mock.method(fs, "rm", (path: string, options?: RmOptions) =>
    path.endsWith(".partial") ? Promise.reject(held) : rm(path, options),
  );
  syncBuiltinESMExports();
  t.after(() => {
    removal.mock.restore();
    syncBuiltinESMExports();
  });
  const worker: Worker = {
    command: [process.execPath, fileURLToPath(new URL("fixtures/vework.ts", import.meta.url))],
    version: "test",
  };
  const file = { given: source, path: source, kind: "video" as const };
  const quiet = () => {};
  const index = join(dir, "talk.cache.json");
  // vework's own error comes first: the stand-in fails on a file with no index beside it.
  await assert.rejects(
    analyze(worker, file, index, { correct: false }, quiet, quiet),
    /talk\.mp4: the analysis failed: .*Invalid data found when processing input$/,
  );
  await assert.rejects(
    analyze(
      { command: ["no-such-program-for-vework"], version: "test" },
      file,
      index,
      { correct: false },
      quiet,
      quiet,
    ),
    /no-such-program-for-vework is not installed or not on PATH/,
  );
  // Analysed whole, the removal's error is the failure.
  await writeFile(join(dir, "talk.index.json"), "{}");
  await assert.rejects(analyze(worker, file, index, { correct: false }, quiet, quiet), held);
  assert.equal(removal.mock.callCount(), 3);
});
