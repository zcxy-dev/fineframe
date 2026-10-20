// Chrome Headless Shell, which renders the effects and captures web pages: Google's Chrome for
// Testing build, pinned by version and by its archive's SHA-256, and downloaded on first use.

import { join } from "node:path";
import {
  Browser,
  BrowserPlatform,
  detectBrowserPlatform,
  getInstalledBrowsers,
  install,
  uninstall,
} from "@puppeteer/browsers";
import { cacheDir, type DownloadProgress } from "./download.ts";

/** Overrides the pinned build, e.g. with a Chromium for a system Chrome for Testing lacks. */
const CHROME_ENV = "VIDEO_EDITOR_CHROME";

/** The Chrome for Testing version every render and capture runs. */
const CHROME_BUILD = "149.0.7790.0";

/** Each platform's archive of that build, by SHA-256: a download that differs is refused before
 * it is unpacked. Chrome for Testing builds none for Linux on arm64. */
export const PINNED_CHROME: Partial<Record<BrowserPlatform, string>> = {
  [BrowserPlatform.LINUX]: "a3b011ab4c726e215cdeb623907a09cfb48f07054a7271fdda555ee2ae4f804d",
  [BrowserPlatform.MAC]: "2597bf0940b54afbdfcb76519b5c8cf423cec49eea90ce1c4123456aca47a851",
  [BrowserPlatform.MAC_ARM]: "17ef152eba8ffcfebc42e25ab295eb040d8e62455cff7dfcc735b652456d6899",
  [BrowserPlatform.WIN32]: "44c3064d2880536693e882e486093969ccdb77a8843ca61bd65fc6d25b3d9155",
  [BrowserPlatform.WIN64]: "8a112c0e768907ff382ff994dcde35cdbd0e1f5a3a475da93d3a83e3260e78c2",
};

/** Installs the pinned build for `platform` under `cacheDir`, its archive checked against its
 * SHA-256, and returns its executable. `baseUrl` replaces Chrome for Testing's address (tests). */
export async function installChrome(options: {
  cacheDir: string;
  platform: BrowserPlatform;
  baseUrl?: string;
  onDownload?: DownloadProgress;
}): Promise<string> {
  const expectedHash = PINNED_CHROME[options.platform];
  if (!expectedHash) throw new Error(`No pinned Chrome Headless Shell for ${options.platform}`);
  const installed = await install({
    browser: Browser.CHROMEHEADLESSSHELL,
    buildId: CHROME_BUILD,
    platform: options.platform,
    cacheDir: options.cacheDir,
    expectedHash,
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(options.onDownload ? { downloadProgressCallback: options.onDownload } : {}),
  });
  await removeOtherBuilds(options.cacheDir);
  return installed.executablePath;
}

/** Deletes every Chrome Headless Shell in `cacheDir` but the pinned build: what earlier pins left.
 * One that cannot be deleted, such as a build still running on Windows, stays. */
export async function removeOtherBuilds(cacheDir: string): Promise<void> {
  for (const { browser, buildId, platform } of await getInstalledBrowsers({ cacheDir })) {
    if (browser !== Browser.CHROMEHEADLESSSHELL || buildId === CHROME_BUILD) continue;
    await uninstall({ browser, buildId, platform, cacheDir }).catch(() => {});
  }
}

let resolved: Promise<string> | undefined;

/** The Chrome Headless Shell to run: `VIDEO_EDITOR_CHROME`, or the pinned build, downloaded into
 * the cache on first use with `onDownload` hearing its progress. */
export function chrome(onDownload?: DownloadProgress): Promise<string> {
  resolved ??= (async () => {
    const own = process.env[CHROME_ENV];
    if (own) return own;
    const platform = detectBrowserPlatform();
    // Chrome for Testing builds no Linux arm64 Chrome.
    if (!platform || platform === "linux_arm") {
      throw new Error(
        `No Chrome Headless Shell build for ${process.platform} ${process.arch}; set ` +
          `${CHROME_ENV} to a Chrome or Chromium.`,
      );
    }
    return installChrome({
      cacheDir: join(cacheDir(), "chrome"),
      platform,
      ...(onDownload ? { onDownload } : {}),
    });
  })();
  // A failed download is not cached, so the next call tries again.
  resolved.catch(() => {
    resolved = undefined;
  });
  return resolved;
}
