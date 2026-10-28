/** A computer the app runs on, or a phone or tablet, which it does not. */
export type Device = "mac" | "windows" | "linux" | "mobile";

/** What `detect` reads from `navigator`. */
export type Nav = {
  userAgent: string;
  maxTouchPoints?: number;
  userAgentData?: { platform: string; mobile: boolean };
};

/**
 * The device `nav` describes, or undefined when it cannot be told: another system, an ARM
 * Linux board or Chromebook the Linux installer does not run on, or a crawler. It is written
 * self-contained, because `DEVICE_SCRIPT` runs its source in the page's head.
 */
export function detect(nav: Nav): Device | undefined {
  const data = nav.userAgentData;
  const s = `${data?.platform ?? ""} ${nav.userAgent}`;
  if (/bot|crawl|spider/i.test(s)) return undefined;
  if (data?.mobile || /Android|iOS|iPhone|iPad|iPod|Mobi/.test(s)) return "mobile";
  // iPadOS asks for pages as a Mac does; only its touch screen gives it away.
  if (/Mac/.test(s)) return (nav.maxTouchPoints ?? 0) > 1 ? "mobile" : "mac";
  if (/Windows/.test(s)) return "windows";
  if (/Linux/.test(s) && !/CrOS|Chrome OS|Chromium OS|aarch64|arm64|armv/i.test(s)) {
    return "linux";
  }
  return undefined;
}

/**
 * Sets the device on `<html data-device>` before the first paint, so the page shows the
 * buttons for it (`data-show`, app/globals.css) without moving. Without it, the page stays
 * as it is for every device.
 */
export const DEVICE_SCRIPT = `var d=(${detect})(navigator);if(d)document.documentElement.dataset.device=d`;
