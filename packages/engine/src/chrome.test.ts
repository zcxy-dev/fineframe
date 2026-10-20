import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { BrowserPlatform } from "@puppeteer/browsers";
import { installChrome, PINNED_CHROME } from "./chrome.ts";

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
