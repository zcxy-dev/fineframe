// Chrome Headless Shell, which renders the effects and captures web pages: Google's Chrome for
// Testing build, pinned by version and downloaded on first use.

import { join } from "node:path";
import { Browser, detectBrowserPlatform, install } from "@puppeteer/browsers";
import { cacheDir, type DownloadProgress } from "./download.ts";

/** Overrides the pinned build, e.g. with a Chromium for a system Chrome for Testing lacks. */
const CHROME_ENV = "VIDEO_EDITOR_CHROME";

/** The Chrome for Testing version every render and capture runs. */
const CHROME_BUILD = "149.0.7790.0";

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
    const installed = await install({
      browser: Browser.CHROMEHEADLESSSHELL,
      buildId: CHROME_BUILD,
      platform,
      cacheDir: join(cacheDir(), "chrome"),
      ...(onDownload ? { downloadProgressCallback: onDownload } : {}),
    });
    return installed.executablePath;
  })();
  // A failed download is not cached, so the next call tries again.
  resolved.catch(() => {
    resolved = undefined;
  });
  return resolved;
}
