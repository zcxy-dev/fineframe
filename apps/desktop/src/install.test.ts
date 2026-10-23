// The `fineframe` command's launcher, run for real against a stand-in for the app's binary, and the
// skill's install over the app's own copy, someone else's and a link.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  installCommand,
  installSkill,
  launcher,
  launcherPath,
  repointLauncher,
  skillFolders,
} from "./install.ts";

const posix = process.platform !== "win32";

test("the launcher runs the app as Node with its arguments as they are", {
  skip: !posix,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), "fineframe-launcher-"));
  try {
    // Stands in for the app's binary: prints how it was run.
    const program = join(dir, "it's app");
    await writeFile(
      program,
      `#!/bin/sh\nprintf '%s\\n' "$ELECTRON_RUN_AS_NODE" "$VIDEO_EDITOR_DATA" "$@"\n`,
      { mode: 0o755 },
    );
    const data = join(dir, "data $HOME");
    const home = join(dir, "home");
    const installed = await installCommand(
      { program, data },
      { confirm: async () => false, home, env: { PATH: "/usr/bin" }, platform: "linux" },
    );
    assert.deepEqual(installed, {
      path: join(home, ".local", "bin", "fineframe"),
      remove: `rm '${join(home, ".local", "bin", "fineframe")}'`,
      offPath: join(home, ".local", "bin"),
    });
    assert.equal(await readlink(installed.path), launcherPath(data, "linux"));
    const run = spawnSync(installed.path, ["edit", "a b", "$(x)", "--help"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr);
    const [asNode, given, e, boot, dashes, noSandbox, ...args] = run.stdout.trimEnd().split("\n");
    assert.equal(asNode, "1");
    assert.equal(given, data);
    assert.equal(e, "-e");
    assert.match(boot as string, /app\.asar.*cli\.ts/);
    assert.equal(dashes, "--");
    assert.equal(noSandbox, "--no-sandbox");
    assert.deepEqual(args, ["edit", "a b", "$(x)", "--help"]);

    // Installing again keeps the link; moving the app points the launcher at it on the next start.
    assert.deepEqual(
      await installCommand(
        { program, data },
        {
          confirm: async () => false,
          home,
          env: { PATH: join(home, ".local", "bin") },
          platform: "linux",
        },
      ),
      { ...installed, offPath: null },
    );
    const moved = join(dir, "moved");
    assert.equal(await repointLauncher({ program: moved, data }, "linux"), true);
    assert.equal(await repointLauncher({ program: moved, data }, "linux"), false);
    const gone = spawnSync(installed.path, ["--help"], { encoding: "utf8" });
    assert.equal(gone.status, 1);
    assert.match(gone.stderr, /Fineframe app is not at .*moved\. Install it or open it once/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("something else named fineframe stays unless replacing it is confirmed", {
  skip: !posix,
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), "fineframe-other-"));
  try {
    const home = join(dir, "home");
    const link = join(home, ".local", "bin", "fineframe");
    await mkdir(join(home, ".local", "bin"), { recursive: true });
    await writeFile(link, "someone else's");
    const options = { home, env: {}, platform: "linux" as const };
    const target = { program: "/opt/app", data: join(dir, "data") };
    assert.equal(await installCommand(target, { ...options, confirm: async () => false }), null);
    assert.equal(await readFile(link, "utf8"), "someone else's");
    const asked: string[] = [];
    const confirm = async (path: string) => asked.push(path) > 0;
    assert.notEqual(await installCommand(target, { ...options, confirm }), null);
    assert.deepEqual(asked, [link]);
    assert.equal(await readlink(link), launcherPath(target.data, "linux"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the Windows launcher checks for the app and passes its arguments on", () => {
  const text = launcher(
    { program: "C:\\Apps\\Fineframe.exe", data: "C:\\Users\\a\\Fineframe" },
    "win32",
  );
  assert.match(text, /^@echo off\r\n/);
  assert.match(text, /if exist "C:\\Apps\\Fineframe\.exe" goto run\r\n/);
  assert.match(text, /set "VIDEO_EDITOR_DATA=C:\\Users\\a\\Fineframe"\r\n/);
  assert.match(text, /"C:\\Apps\\Fineframe\.exe" -e "[^"]+" -- %\*\r\n/);
  assert.equal(launcherPath("C:\\data", "win32").endsWith("fineframe.cmd"), true);
});

test("the Windows launcher keeps % and & in its paths as they are", () => {
  const text = launcher({ program: "C:\\R&D 100%PATH%\\F.exe", data: "C:\\R&D %TEMP%" }, "win32");
  assert.match(text, /if exist "C:\\R&D 100%%PATH%%\\F\.exe" goto run\r\n/);
  assert.match(text, /echo fineframe: .* C:\\R\^&D 100%%PATH%%\\F\.exe\. .* 1>&2\r\n/);
  assert.match(text, /set "VIDEO_EDITOR_DATA=C:\\R&D %%TEMP%%"\r\n/);
  assert.match(text, /"C:\\R&D 100%%PATH%%\\F\.exe" -e /);
});

test("the Windows launcher runs an app whose paths hold % and &, and says when it is gone", {
  skip: posix && "cmd.exe runs the launcher",
}, async () => {
  const dir = await mkdtemp(join(tmpdir(), "fineframe-cmd-"));
  try {
    // Node itself stands in for the app's binary, and a preloaded script prints how it was run.
    const odd = join(dir, "R&D 100%PATH%");
    await mkdir(odd);
    const program = join(odd, "Fineframe.exe");
    await copyFile(process.execPath, program);
    const preload = join(dir, "print.cjs");
    await writeFile(
      preload,
      "console.log(JSON.stringify([process.env.ELECTRON_RUN_AS_NODE, process.env.VIDEO_EDITOR_DATA, process.argv.slice(1)])); process.exit(0);",
    );
    const data = join(odd, "data");
    const file = join(dir, "fineframe.cmd");
    const runIt = async (target: { program: string; data: string }) => {
      await writeFile(file, launcher(target, "win32"));
      return spawnSync(`"${file}" edit "a b"`, {
        shell: true,
        encoding: "utf8",
        // NODE_OPTIONS reads a backslash as an escape.
        env: { ...process.env, NODE_OPTIONS: `--require "${preload.replaceAll("\\", "/")}"` },
      });
    };
    const run = await runIt({ program, data });
    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), ["1", data, ["edit", "a b"]]);
    const gone = join(odd, "R&D.exe");
    const moved = await runIt({ program: gone, data });
    assert.equal(moved.status, 1);
    assert.equal(
      moved.stderr.trim(),
      `fineframe: the Fineframe app is not at ${gone}. Install it or open it once, and it sets this command up again.`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the skill replaces the app's own copy, and anything else only when confirmed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fineframe-skill-"));
  try {
    const skill = join(dir, "skill");
    await mkdir(join(skill, "references"), { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "new");
    await writeFile(join(skill, "references", "recipes.md"), "recipes");
    const [claude, agents] = skillFolders(join(dir, "home")) as [string, string];
    const no = async () => false;

    assert.equal(await installSkill(skill, claude, no), true);
    assert.equal(await readFile(join(claude, "references", "recipes.md"), "utf8"), "recipes");
    await writeFile(join(skill, "SKILL.md"), "newer");
    assert.equal(await installSkill(skill, claude, no), true);
    assert.equal(await readFile(join(claude, "SKILL.md"), "utf8"), "newer");

    // A link to someone's own clone: kept when declined, and when replaced, the clone stays.
    const clone = join(dir, "clone");
    await mkdir(clone);
    await writeFile(join(clone, "SKILL.md"), "the clone's");
    await mkdir(join(agents, ".."), { recursive: true });
    await symlink(clone, agents, "junction");
    assert.equal(await installSkill(skill, agents, no), false);
    assert.equal((await lstat(agents)).isSymbolicLink(), true);
    assert.equal(await installSkill(skill, agents, async () => true), true);
    assert.equal((await lstat(agents)).isSymbolicLink(), false);
    assert.equal(await readFile(join(agents, "SKILL.md"), "utf8"), "newer");
    assert.equal(await readFile(join(clone, "SKILL.md"), "utf8"), "the clone's");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
