// Web capture: a page the speaker names, shot headless at 2x as a still cropped to what is
// talked about, or as a slow scroll down it, ready to zoom into. It runs the Chrome Headless
// Shell Remotion downloads for the effects, in a fresh profile: no cookies, no saved logins, and
// it never fills a form or clicks a consent button.

import { lookup } from "node:dns/promises";
import { mkdir, rm } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname } from "node:path";
import { ensureBrowser } from "@remotion/renderer";
import { type Browser, type BrowserContext, chromium, type Page } from "playwright-core";
import { ffmpeg, run } from "../ffmpeg.ts";
import type { Credit } from "./credits.ts";

export interface CaptureOptions {
  /** The page, http or https only. */
  url: string;
  /** Where the PNG goes; with `scroll`, where the MP4 goes. */
  out: string;
  /** A CSS selector of the element to crop to. */
  selector?: string;
  /** Text on the page to crop to, such as a price or a product name; the first match is used. */
  text?: string;
  /** Seconds of a slow scroll down the page, as an MP4 instead of a still. */
  scroll?: number;
  /** The browser window in CSS pixels: 1280 x 800 unless given. */
  viewport?: { width: number; height: number };
  /** Device pixels per CSS pixel: 2 unless given. */
  scale?: number;
  /** Space kept around the crop, in CSS pixels: 24 unless given. */
  padding?: number;
  /** How long the page may take to load, in ms: 20 000 unless given. */
  timeout?: number;
  /** Local hosts a capture may reach all the same, such as a test's own server; pages the
   * speaker names are never local. */
  allowHosts?: readonly string[];
  /** A browser already open, which is left open; otherwise one is opened and closed. */
  browser?: Browser;
}

export interface Capture {
  /** The PNG or MP4 written. */
  path: string;
  kind: "still" | "clip";
  /** Its size in pixels. */
  width: number;
  height: number;
  /** The selector's element or the text's box, in the still's pixels, for a zoom or a
   * highlight to aim at; null without either or for a clip. */
  focus: { x: number; y: number; width: number; height: number } | null;
  credit: Credit;
}

const VIEWPORT = { width: 1280, height: 800 };

/** Opens Chrome Headless Shell, downloading it as Remotion does on first use. */
export async function openCaptureBrowser(): Promise<Browser> {
  const status = await ensureBrowser({ logLevel: "error" });
  if (status.type !== "local-puppeteer-browser" && status.type !== "user-defined-path") {
    throw new Error(`Chrome Headless Shell is not available (${status.type})`);
  }
  return chromium.launch({ executablePath: status.path, headless: true });
}

/** Captures `options.url` as a still, cropped when a selector or text is given, or as a scroll. */
export async function capturePage(options: CaptureOptions): Promise<Capture> {
  const allow = options.allowHosts ?? [];
  const url = checkedUrl(options.url, allow);
  const browser = options.browser ?? (await openCaptureBrowser());
  try {
    const viewport = options.viewport ?? VIEWPORT;
    const scale = options.scale ?? 2;
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: scale,
      acceptDownloads: false,
      serviceWorkers: "block",
      reducedMotion: "reduce",
      // Some sites turn away a browser that calls itself headless.
      userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${browser.version()} Safari/537.36`,
    });
    try {
      await guard(context, allow);
      const page = await context.newPage();
      page.setDefaultTimeout(options.timeout ?? 20_000);
      await page.goto(url.href, { waitUntil: "load" });
      await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
      await clearOverlays(page);
      await mkdir(dirname(options.out), { recursive: true });
      if (options.scroll) return await scrollClip(page, options, viewport, scale, url);
      return await still(page, options, viewport, scale, url);
    } finally {
      await context.close();
    }
  } finally {
    if (!options.browser) await browser.close();
  }
}

/** The URL if it is one a capture may open: http or https, and not a local or private address
 * unless `allow` names its host. */
export function checkedUrl(text: string, allow: readonly string[] = []): URL {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error(`Not a web address: ${text}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http and https pages are captured, not ${url.protocol}`);
  }
  if (url.username || url.password) throw new Error("A capture never logs in");
  if (!allow.includes(url.hostname) && isLocal(url.hostname)) {
    throw new Error(`${url.hostname} is a local or private address`);
  }
  return url;
}

/** Keeps every request the page makes off local and private addresses: each is fetched with its
 * redirects held back, so every hop is checked, by its name and by the addresses the name
 * resolves to; a WebSocket is checked as it opens. */
async function guard(context: BrowserContext, allow: readonly string[]): Promise<void> {
  const resolved = new Map<string, Promise<boolean>>();
  const blocked = (host: string): Promise<boolean> => {
    if (allow.includes(host)) return Promise.resolve(false);
    if (isLocal(host)) return Promise.resolve(true);
    if (isIP(host.replace(/^\[|\]$/g, ""))) return Promise.resolve(false);
    let answer = resolved.get(host);
    if (!answer) {
      answer = lookup(host, { all: true }).then(
        (addresses) => addresses.some(({ address }) => isLocal(address)),
        // A name that does not resolve fails to load anyway.
        () => false,
      );
      resolved.set(host, answer);
    }
    return answer;
  };
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol !== "http:" && url.protocol !== "https:") return route.continue();
    if (await blocked(url.hostname)) return route.abort("blockedbyclient");
    const response = await route.fetch({ maxRedirects: 0 }).catch(() => null);
    if (!response) return route.abort();
    const location = response.headers().location;
    if (location && (await blocked(new URL(location, url).hostname))) {
      return route.abort("blockedbyclient");
    }
    return route.fulfill({ response });
  });
  await context.routeWebSocket(/.*/, async (socket) => {
    if (await blocked(new URL(socket.url()).hostname)) await socket.close();
    else socket.connectToServer();
  });
}

function isLocal(host: string): boolean {
  // A trailing dot names the same host.
  const name = host
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "")
    .toLowerCase();
  if (name === "localhost" || name.endsWith(".localhost") || name.endsWith(".local")) return true;
  if (isIP(name) === 4) {
    const [a = 0, b = 0] = name.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b < 32) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b < 128) ||
      (a === 198 && (b === 18 || b === 19)) ||
      // Multicast and reserved, broadcast included.
      a >= 224
    );
  }
  if (isIP(name) === 6) {
    return (
      name === "::" ||
      name === "::1" ||
      /^f[cd]/.test(name) ||
      /^fe[89ab]/.test(name) ||
      /^ff/.test(name) ||
      name.startsWith("::ffff:") ||
      name.startsWith("64:ff9b:")
    );
  }
  return false;
}

/** Hides cookie and consent banners and other fixed overlays without answering them: a click on
 * "Accept" would agree to terms for the person editing. Escape closes most dialogs first. */
async function clearOverlays(page: Page): Promise<void> {
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => {
    const words = /cookie|consent|gdpr|privacy|onetrust|didomi|cookiebot|usercentrics|cmp/i;
    for (const element of document.querySelectorAll<HTMLElement>("body *")) {
      const style = getComputedStyle(element);
      if (style.position !== "fixed" && style.position !== "sticky") continue;
      const label = `${element.id} ${element.className} ${element.getAttribute("aria-label") ?? ""}`;
      const text = (element.innerText ?? "").slice(0, 2000);
      const covers =
        element.offsetWidth * element.offsetHeight > 0.5 * innerWidth * innerHeight &&
        style.position === "fixed";
      if (words.test(label) || words.test(text) || covers) element.style.display = "none";
    }
    // A banner may have locked scrolling while it showed. Unlocked as visible, not auto: with
    // both set, the body would scroll inside a page one screen tall.
    for (const element of [document.documentElement, document.body]) {
      if (getComputedStyle(element).overflowY === "hidden") {
        element.style.setProperty("overflow", "visible", "important");
      }
    }
  });
}

async function still(
  page: Page,
  options: CaptureOptions,
  viewport: { width: number; height: number },
  scale: number,
  url: URL,
): Promise<Capture> {
  const target = options.selector
    ? page.locator(options.selector).first()
    : options.text
      ? page.getByText(options.text).first()
      : null;
  let clip = { x: 0, y: 0, width: viewport.width, height: viewport.height };
  let focus: Capture["focus"] = null;
  if (target) {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error(`${options.selector ?? options.text} is not visible on ${url.href}`);
    const pad = options.padding ?? 24;
    const x = Math.max(0, Math.floor(box.x - pad));
    const y = Math.max(0, Math.floor(box.y - pad));
    clip = {
      x,
      y,
      width: Math.min(viewport.width - x, Math.ceil(box.width + 2 * pad)),
      height: Math.min(viewport.height - y, Math.ceil(box.height + 2 * pad)),
    };
    focus = {
      x: Math.round((box.x - x) * scale),
      y: Math.round((box.y - y) * scale),
      width: Math.round(box.width * scale),
      height: Math.round(box.height * scale),
    };
  }
  await page.screenshot({ path: options.out, clip, animations: "disabled", caret: "hide" });
  return {
    path: options.out,
    kind: "still",
    width: Math.round(clip.width * scale),
    height: Math.round(clip.height * scale),
    focus,
    credit: pageCredit(url),
  };
}

/** A smooth scroll down the page: one tall screenshot panned by FFmpeg with an ease in and out,
 * steadier than recording the browser while it scrolls. */
async function scrollClip(
  page: Page,
  options: CaptureOptions,
  viewport: { width: number; height: number },
  scale: number,
  url: URL,
): Promise<Capture> {
  const seconds = options.scroll ?? 0;
  const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  // About one screen every two seconds reads; never past the page.
  const height = Math.min(pageHeight, Math.round(viewport.height * (1 + seconds / 2)));
  const tall = `${options.out}.${process.pid}.png`;
  try {
    await page.screenshot({
      path: tall,
      fullPage: true,
      clip: { x: 0, y: 0, width: viewport.width, height },
      animations: "disabled",
      caret: "hide",
    });
    const width = even(viewport.width * scale);
    const frame = even(viewport.height * scale);
    const pan = `(ih-${frame})*(1-cos(PI*min(t/${seconds},1)))/2`;
    await run(await ffmpeg(), [
      ...["-v", "error", "-y", "-loop", "1", "-framerate", "30", "-i", tall, "-t", `${seconds}`],
      ...["-vf", `scale=${width}:-2,crop=${width}:${frame}:0:'${pan}',format=yuv420p`],
      ...["-c:v", "libx264", "-crf", "18", "-preset", "medium", "-an", options.out],
    ]);
    return {
      path: options.out,
      kind: "clip",
      width,
      height: frame,
      focus: null,
      credit: pageCredit(url),
    };
  } finally {
    await rm(tall, { force: true });
  }
}

function even(value: number): number {
  return Math.round(value / 2) * 2;
}

/** A screenshot shows someone else's page: the credit names it, and its owner keeps every right
 * in it. */
function pageCredit(url: URL): Credit {
  return { what: `Screenshot of ${url.hostname}`, source: url.href, license: null, by: null };
}
