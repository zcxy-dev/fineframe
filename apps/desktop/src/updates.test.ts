import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import type { UpdateInfo } from "electron-updater";
import { type Notice, watchUpdates } from "./updates.ts";

/** A stand-in for electron-updater: counts its checks and downloads the update only when told to
 * download automatically, as it does. */
class Updater extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  checks = 0;
  downloads = 0;
  async checkForUpdates() {
    this.checks++;
    const info = {
      version: "0.5.0",
      files: [
        { url: "Fineframe-0.5.0-mac-arm64.zip", sha512: "" },
        { url: "Fineframe-0.5.0-mac-arm64.dmg", sha512: "" },
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

test("an update downloads by itself and is announced once it is ready", async () => {
  const updater = new Updater();
  const notices: Notice[] = [];
  const stop = watchUpdates(updater, (notice) => notices.push(notice), 10);
  await new Promise((resolve) => setTimeout(resolve, 35));
  stop();
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.ok(updater.checks >= 2, "it checks again");
  assert.equal(updater.downloads, updater.checks);
  assert.deepEqual(notices[0], { version: "0.5.0" });
});
