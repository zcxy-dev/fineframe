// The app's updates, from the feed at downloads.fineframe.app that the release workflow uploads
// (electron-builder's generic provider, read by electron-updater). Windows and Linux download an
// update in the background and install it when the app quits or restarts; the Mac app, not
// signed with a Developer ID, cannot install one by itself, so it only says that a newer version
// is out, with its download.
import type { AppUpdater, UpdateInfo } from "electron-updater";

/** Where electron-builder.yml publishes the installers and their latest*.yml. */
const FEED = "https://downloads.fineframe.app/";

/** How often a running app checks again. */
const EVERY = 4 * 60 * 60 * 1000;

/** What the page's notice says: an update downloaded, installed on a restart, or a newer version
 * to download from `url`. */
export type Notice =
  | { kind: "ready"; version: string }
  | { kind: "available"; version: string; url: string };

type Updater = Pick<AppUpdater, "autoDownload" | "autoInstallOnAppQuit" | "checkForUpdates"> & {
  on(event: "update-available" | "update-downloaded", listener: (info: UpdateInfo) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
};

/**
 * Checks for updates now and every few hours, telling `notify` of one: on macOS (`platform`
 * "darwin") as soon as it is out, with its DMG, and never downloading it; elsewhere once it is
 * downloaded. Returns what stops the checks.
 */
export function watchUpdates(
  updater: Updater,
  platform: NodeJS.Platform,
  notify: (notice: Notice) => void,
  every = EVERY,
): () => void {
  const mac = platform === "darwin";
  updater.autoDownload = !mac;
  updater.autoInstallOnAppQuit = !mac;
  if (mac) {
    updater.on("update-available", ({ version, files }) => {
      const dmg = files.find((file) => file.url.endsWith(".dmg"));
      if (dmg) notify({ kind: "available", version, url: new URL(dmg.url, FEED).href });
    });
  } else {
    updater.on("update-downloaded", ({ version }) => notify({ kind: "ready", version }));
  }
  updater.on("error", (error) => console.error(`Could not update the app: ${error.message}`));
  // A failed check also comes as an error.
  const check = () => void updater.checkForUpdates().catch(() => {});
  check();
  const timer = setInterval(check, every);
  return () => clearInterval(timer);
}
