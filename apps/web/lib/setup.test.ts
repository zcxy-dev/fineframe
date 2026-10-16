// The analysis's setup in the desktop app, against a stand-in for uv that prints what uv prints.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultAsr, parseUvLine, Setup } from "./setup.ts";

test("uv's download lines give each package's size, and when it has arrived", () => {
  assert.deepEqual(parseUvLine("Downloading torch (187.2MiB)"), {
    start: "torch",
    bytes: Math.round(187.2 * 1024 ** 2),
  });
  assert.deepEqual(
    parseUvLine("Downloading cpython-3.12.15-linux-x86_64-gnu (download) (32.7MiB)"),
    {
      start: "cpython-3.12.15-linux-x86_64-gnu (download)",
      bytes: Math.round(32.7 * 1024 ** 2),
    },
  );
  assert.deepEqual(parseUvLine(" Downloaded torch"), { done: "torch" });
  assert.equal(parseUvLine("Prepared 120 packages in 31.2s"), null);
});

test("a computer with less memory than the speech model needs hears speech on OpenRouter", () => {
  assert.equal(defaultAsr(8 * 1024 ** 3), "cloud");
  assert.equal(defaultAsr(16 * 1024 ** 3), "local");
});

test("the environment installs once from the lockfile, reporting its download, and again for new code", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "web-setup-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const worker = join(dir, "app", "worker");
  await mkdir(join(worker, "src", "vework"), { recursive: true });
  await writeFile(join(dir, "app", ".python-version"), "3.12\n");
  for (const file of ["pyproject.toml", "uv.lock", join("src", "vework", "cli.py")]) {
    await writeFile(join(worker, file), "");
  }
  // Records its arguments, then prints two downloads the way uv does, slowly enough to be seen.
  const fake = join(dir, "uv.cjs");
  await writeFile(
    fake,
    `const { appendFileSync } = require("node:fs");
appendFileSync(${JSON.stringify(join(dir, "calls"))}, JSON.stringify(process.argv.slice(2)) + "\\n");
const lines = ["Downloading cpython-3.12.15-linux-x86_64-gnu (download) (30.0MiB)", " Downloaded cpython-3.12.15-linux-x86_64-gnu (download)", "Downloading torch (3.0MiB)", "Downloading numpy (1.0MiB)", " Downloaded numpy", " Downloaded torch"];
let i = 0;
const next = () => (i < lines.length ? (process.stderr.write(lines[i++] + "\\n"), setTimeout(next, 30)) : process.exit(process.env.FAKE_UV_FAIL ? 2 : 0));
next();
`,
  );
  const uv = [process.execPath, fake];
  const saved = { UV_PROJECT_ENVIRONMENT: process.env.UV_PROJECT_ENVIRONMENT };
  process.env.UV_PROJECT_ENVIRONMENT = join(dir, "env");
  await mkdir(join(dir, "env"));
  t.after(() => Object.assign(process.env, saved));

  const setup = new Setup({ worker, enabled: true, uv });
  assert.equal(setup.state.state, "installing");
  const seen: number[] = [];
  const totals = new Set<number>();
  const watch = setInterval(() => {
    const download = setup.state.download;
    if (download) seen.push(download.bytes / download.total);
    if (download) totals.add(download.total);
  }, 5);
  await setup.ready();
  clearInterval(watch);
  assert.deepEqual(setup.state, { state: "ready" });
  assert.ok(
    seen.some((share) => share > 0 && share < 1),
    "part way shown",
  );
  // The packages' sizes, without Python's, which downloads alone before them.
  assert.ok([...totals].every((total) => total <= 4 * 1024 ** 2));
  const calls = async () =>
    (await readFile(join(dir, "calls"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  const [first] = await calls();
  assert.deepEqual(first, [
    ...["sync", "--project", worker, "--python", "3.12", "--extra", "ml"],
    ...["--frozen", "--no-dev", "--no-editable"],
  ]);

  // The same code again is only checked; changed code reinstalls the worker.
  await new Setup({ worker, enabled: true, uv }).ready();
  await writeFile(join(worker, "src", "vework", "cli.py"), "# changed\n");
  await new Setup({ worker, enabled: true, uv }).ready();
  const [, same, changed] = await calls();
  assert.deepEqual(same, first);
  assert.deepEqual(changed, [...first, "--reinstall-package", "vework"]);

  // A failure says so, and is tried again when asked.
  process.env.FAKE_UV_FAIL = "1";
  const failing = new Setup({ worker, enabled: true, uv });
  await assert.rejects(failing.ready(), /Setting up the analysis failed/);
  assert.equal(failing.state.state, "failed");
  delete process.env.FAKE_UV_FAIL;
  await failing.ready();
  assert.equal(failing.state.state, "ready");

  // From a clone, `pnpm start` has set it up already.
  assert.deepEqual(new Setup({ worker, enabled: false }).state, { state: "ready" });
});
