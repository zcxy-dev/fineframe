import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { compositorPackage, lockedIntegrity } from "./compositor.ts";

test("each system's compositor is the package @remotion/renderer would load", () => {
  assert.equal(compositorPackage("darwin", "arm64"), "@remotion/compositor-darwin-arm64");
  assert.equal(compositorPackage("darwin", "x64"), "@remotion/compositor-darwin-x64");
  assert.equal(compositorPackage("linux", "x64"), "@remotion/compositor-linux-x64-gnu");
  assert.equal(compositorPackage("win32", "x64"), "@remotion/compositor-win32-x64-msvc");
  assert.throws(() => compositorPackage("freebsd", "x64"), /no compositor/);
});

test("the lockfile holds the integrity of every system's compositor at the renderer's version", async () => {
  const lockfile = await readFile(new URL("../../../pnpm-lock.yaml", import.meta.url), "utf8");
  const { version } = JSON.parse(
    await readFile(
      new URL("../node_modules/@remotion/renderer/package.json", import.meta.url),
      "utf8",
    ),
  ) as { version: string };
  for (const [platform, arch] of [
    ["darwin", "arm64"],
    ["darwin", "x64"],
    ["linux", "x64"],
    ["win32", "x64"],
  ] as const) {
    const integrity = lockedIntegrity(lockfile, compositorPackage(platform, arch), version);
    assert.match(integrity ?? "", /^sha512-[A-Za-z0-9+/]{86}==$/, `${platform} ${arch}`);
  }
  assert.equal(lockedIntegrity(lockfile, "@remotion/compositor-darwin-arm64", "0.0.0"), null);
});

test("a lockfile checked out with Windows line endings is read the same", () => {
  const entry = [
    "packages:",
    "",
    "  '@remotion/compositor-win32-x64-msvc@1.2.3':",
    `    resolution: {integrity: sha512-${"A".repeat(86)}==}`,
    "",
  ];
  const lf = entry.join("\n");
  const crlf = entry.join("\r\n");
  const name = "@remotion/compositor-win32-x64-msvc";
  assert.equal(lockedIntegrity(crlf, name, "1.2.3"), lockedIntegrity(lf, name, "1.2.3"));
  assert.notEqual(lockedIntegrity(crlf, name, "1.2.3"), null);
});
