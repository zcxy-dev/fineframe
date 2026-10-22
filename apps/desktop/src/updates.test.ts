import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { UpdateInfo } from "electron-updater";
import { type Notice, watchUpdates } from "./updates.ts";

/** A stand-in for electron-updater: counts its checks and downloads the update only when told to
 * download automatically, as it does. */
class Updater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  checks = 0;
  downloads = 0;
  async checkForUpdates() {
    this.checks++;
    const info = {
      version: "0.5.0",
      files: [
        { url: "Fineframe-0.5.0-mac-arm64.dmg", sha512: "" },
        { url: "Fineframe-0.5.0-mac-arm64.dmg.blockmap", sha512: "" },
      ],
    } as unknown as UpdateInfo;
    this.emit("update-available", info);
    if (this.autoDownload) {
      this.downloads++;
      this.emit("update-downloaded", info);
    }
    return null;
  }
}

test("on macOS an update is only announced, with its DMG, and never downloaded or installed", async () => {
  const updater = new Updater();
  const notices: Notice[] = [];
  const stop = watchUpdates(updater, "darwin", (notice) => notices.push(notice));
  stop();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(updater.autoDownload, false);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(updater.downloads, 0);
  assert.deepEqual(notices, [
    {
      kind: "available",
      version: "0.5.0",
      url: "https://downloads.fineframe.app/Fineframe-0.5.0-mac-arm64.dmg",
    },
  ]);
});

test("on Windows and Linux an update downloads by itself and is announced once it is ready", async () => {
  for (const platform of ["win32", "linux"] as const) {
    const updater = new Updater();
    const notices: Notice[] = [];
    const stop = watchUpdates(updater, platform, (notice) => notices.push(notice), 10);
    await new Promise((resolve) => setTimeout(resolve, 35));
    stop();
    assert.equal(updater.autoInstallOnAppQuit, true);
    assert.ok(updater.checks >= 2, "it checks again");
    assert.equal(updater.downloads, updater.checks);
    assert.deepEqual(notices[0], { kind: "ready", version: "0.5.0" });
  }
});
