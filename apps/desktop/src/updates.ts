// The app's updates, from the feed at downloads.fineframe.app that the release workflow uploads
// (electron-builder's generic provider, read by electron-updater). An update downloads in the
// background and installs when the app quits or restarts; on macOS from the zip beside the DMG,
// which Squirrel.Mac installs only into an app signed with the same Developer ID.
import type { AppUpdater, UpdateInfo } from "electron-updater";

/** How often a running app checks again. */
const EVERY = 4 * 60 * 60 * 1000;

/** What the page's notice says: an update downloaded, installed on a restart. */
export type Notice = { version: string };

type Updater = Pick<AppUpdater, "autoDownload" | "autoInstallOnAppQuit" | "checkForUpdates"> & {
  on(event: "update-downloaded", listener: (info: UpdateInfo) => void): void;
  on(event: "error", listener: (error: Error) => void): void;
};

/**
 * Checks for updates now and every few hours, telling `notify` of one once it is downloaded.
 * Returns what stops the checks.
 */
export function watchUpdates(
  updater: Updater,
  notify: (notice: Notice) => void,
  every = EVERY,
): () => void {
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.on("update-downloaded", ({ version }) => notify({ version }));
  updater.on("error", (error) => console.error(`Could not update the app: ${error.message}`));
  // A failed check also comes as an error.
  const check = () => void updater.checkForUpdates().catch(() => {});
  check();
  const timer = setInterval(check, every);
  return () => clearInterval(timer);
}
