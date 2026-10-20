import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import puppeteer from "puppeteer-core";
import { guardPage, guardPuppeteer } from "./guard.ts";
import { POLICY } from "./page.ts";

/** The Chrome Headless Shell the engine installed, or VIDEO_EDITOR_CHROME. */
function localChrome(): string | null {
  if (process.env.VIDEO_EDITOR_CHROME) return process.env.VIDEO_EDITOR_CHROME;
  const cache = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  const root = join(cache, "video-editor", "chrome", "chrome-headless-shell");
  if (!existsSync(root)) return null;
  for (const build of readdirSync(root)) {
    for (const folder of readdirSync(join(root, build))) {
      for (const name of ["chrome-headless-shell", "chrome-headless-shell.exe"]) {
        const path = join(root, build, folder, name);
        if (existsSync(path)) return path;
      }
    }
  }
  return null;
}

const executablePath = localChrome();
const chrome = {
  skip: process.env.CI
    ? "renders with Chrome: run it locally"
    : executablePath
      ? false
      : "no Chrome Headless Shell installed",
};

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A page as a renderer serves one: our policy, its own inline script, and everything a page
 * might try to reach another address with. */
function hostile(elsewhere: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${POLICY}">
<meta http-equiv="refresh" content="1;url=${elsewhere}/navigated">
<link rel="stylesheet" href="${elsewhere}/style.css">
<script>window.ran = 1; fetch("${elsewhere}/fetched").catch(() => {});
const late = document.createElement("script"); late.textContent = "window.late = 1"; document.head.append(late);</script>
</head><body><img src="${elsewhere}/image.png"><svg><image href="${elsewhere}/svg.png"/></svg></body></html>`;
}

test(
  "a guarded page reaches nothing but its own address, and runs only the scripts it was served with",
  chrome,
  async (t) => {
    const reached: string[] = [];
    const outside = createServer((request, response) => {
      reached.push(request.url ?? "");
      response.end();
    });
    const elsewhere = await listen(outside);
    const own = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(hostile(elsewhere));
    });
    const origin = await listen(own);
    t.after(() => {
      outside.close();
      own.close();
    });

    for (const launch of ["guardPage", "guardPuppeteer"] as const) {
      let browser: import("puppeteer-core").Browser;
      let page: import("puppeteer-core").Page;
      if (launch === "guardPage") {
        browser = await puppeteer.launch({
          executablePath: executablePath as string,
          args: ["--no-sandbox"],
        });
        page = await browser.newPage();
        await guardPage(page);
      } else {
        // As the render's worker does to the puppeteer HyperFrames launches its browsers with.
        const guarded = puppeteer;
        const launchBefore = guarded.launch;
        guardPuppeteer(guarded);
        try {
          browser = await guarded.launch({
            executablePath: executablePath as string,
            args: ["--no-sandbox"],
          });
        } finally {
          guarded.launch = launchBefore;
        }
        page = await browser.newPage();
      }
      try {
        await page.goto(`${origin}/index.html`, { waitUntil: "load" });
        // The script it was served with ran, by its hash; the one it made later did not.
        assert.equal(await page.evaluate(() => (window as { ran?: number }).ran), 1, launch);
        assert.equal(
          await page.evaluate(() => (window as { late?: number }).late),
          undefined,
          launch,
        );
        // Long enough for the refresh to try to leave; Chrome shows its own error page instead.
        await new Promise((resolve) => setTimeout(resolve, 2000));
        assert.notEqual(new URL(page.url()).origin, elsewhere, launch);
      } finally {
        await browser.close();
      }
    }
    assert.deepEqual(reached, []);
  },
);
