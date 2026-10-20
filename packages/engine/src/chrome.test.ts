import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BrowserPlatform } from "@puppeteer/browsers";
import { installChrome, PINNED_CHROME, removeOtherBuilds } from "./chrome.ts";
import { scratch } from "./testing.ts";

test("every platform Chrome for Testing builds for has its archive's SHA-256 pinned", () => {
  for (const platform of Object.values(BrowserPlatform)) {
    if (platform === BrowserPlatform.LINUX_ARM) continue;
    assert.match(PINNED_CHROME[platform] ?? "", /^[0-9a-f]{64}$/, platform);
  }
});

test("a Chrome archive that is not the pinned one is refused and nothing is unpacked", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "chrome-"));
  const server = createServer((_request, response) => response.end("not the archive"));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    server.close();
    await rm(dir, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await assert.rejects(
    installChrome({ cacheDir: dir, platform: BrowserPlatform.LINUX, baseUrl }),
    /Integrity check failed/,
  );
  const left = await readdir(dir, { recursive: true });
  // Neither the archive nor the build it would unpack to is left.
  assert.ok(!left.some((path) => /linux64|\.zip$/.test(String(path))), left.join(", "));
});

test("every Chrome Headless Shell but the pinned build is deleted", async (t) => {
  const dir = await scratch(t, "chrome-");
  const shell = join(dir, "chrome-headless-shell");
  for (const build of ["linux-148.0.7778.0", "linux-149.0.7790.0"]) {
    const folder = join(shell, build, "chrome-headless-shell-linux64");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "chrome-headless-shell"), "");
  }
  await removeOtherBuilds(dir);
  assert.deepEqual(await readdir(shell), ["linux-149.0.7790.0"]);
});
