// Holds every page a graphic is drawn in to its own folder, whatever the page holds: the browser
// that checks graphics and the one HyperFrames renders them in let no request through but those
// for the page and the files beside it, on the loopback address it is served from, and run no
// script but the renderer's own.

import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Parser } from "htmlparser2";
import type { Browser, Page, PuppeteerNode } from "puppeteer-core";
import { POLICY } from "./page.ts";

const loopback = (url: URL) =>
  url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");

/** The page as served, with the hash of each of its inline scripts allowed in its policy. A page
 * of ours holds no script (markupProblem and the templates), so each one is the renderer's. */
function withScriptHashes(html: string): string {
  const scripts: string[] = [];
  let inScript = false;
  let text = "";
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        inScript = name === "script" && attributes.src === undefined;
        text = "";
      },
      ontext(chunk) {
        if (inScript) text += chunk;
      },
      onclosetag(name) {
        if (name === "script" && inScript) scripts.push(text);
        inScript = false;
      },
    },
    { decodeEntities: false },
  );
  parser.write(html);
  parser.end();
  const hashes = [...new Set(scripts)].map(
    (script) => `'sha256-${createHash("sha256").update(script).digest("base64")}'`,
  );
  const allowed = hashes.length > 0 ? hashes.join(" ") : "'none'";
  return html.replace(POLICY, POLICY.replace("script-src 'none'", `script-src ${allowed}`));
}

/**
 * Lets a page reach nothing but the loopback origin of the first document it opens, and the
 * `data:` and `chrome:` pages a renderer probes with: every other request and every navigation
 * elsewhere is aborted, whatever the page asks for. Each HTML document from that origin is served
 * with its scripts' hashes in its policy.
 */
export async function guardPage(page: Page): Promise<void> {
  await page.setRequestInterception(true);
  let origin: string | null = null;
  page.on("request", async (request) => {
    if (request.isInterceptResolutionHandled()) return;
    const url = new URL(request.url());
    if (url.protocol === "data:" || url.protocol === "chrome:" || url.href === "about:blank") {
      await request.continue();
      return;
    }
    if (loopback(url) && origin === null && request.isNavigationRequest()) origin = url.origin;
    if (!loopback(url) || url.origin !== origin) {
      await request.abort("blockedbyclient");
      return;
    }
    if (request.resourceType() === "document" && url.pathname.endsWith(".html")) {
      try {
        const response = await fetch(url);
        await request.respond({
          status: response.status,
          contentType: "text/html; charset=utf-8",
          body: withScriptHashes(await response.text()),
        });
      } catch {
        await request.abort("failed");
      }
      return;
    }
    await request.continue();
  });
}

/** Has every page each browser `puppeteer` launches guarded before its caller sees it. */
export function guardPuppeteer(puppeteer: PuppeteerNode): void {
  const launch = puppeteer.launch.bind(puppeteer);
  puppeteer.launch = async (...args: Parameters<PuppeteerNode["launch"]>) => {
    const browser: Browser = await launch(...args);
    const newPage = browser.newPage.bind(browser);
    browser.newPage = async (...pageArgs: Parameters<Browser["newPage"]>) => {
      const page = await newPage(...pageArgs);
      await guardPage(page);
      return page;
    };
    return browser;
  };
}

/** The puppeteer HyperFrames imports: the one its engine resolves, which is one module however
 * many import it. */
export async function hyperframesPuppeteer(): Promise<PuppeteerNode> {
  const from = (name: string, file: string) => {
    const paths = createRequire(file).resolve.paths(name) ?? [];
    const dir = paths
      .map((path) => join(path, name))
      .find((d) => existsSync(join(d, "package.json")));
    if (!dir) throw new Error(`${name} is not installed beside ${file}`);
    return realpathSync(dir);
  };
  const here = fileURLToPath(import.meta.url);
  const producer = from("@hyperframes/producer", here);
  const engine = from("@hyperframes/engine", join(producer, "package.json"));
  const entry = realpathSync(createRequire(join(engine, "package.json")).resolve("puppeteer"));
  const module = (await import(pathToFileURL(entry).href)) as { default: PuppeteerNode };
  return module.default;
}
