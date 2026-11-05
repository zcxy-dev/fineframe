// Screenshot comparison of the website's public pages (both languages' home, pricing, download,
// legal and sign-in pages; desktop and phone) against the baselines in screenshots/. CI runs it in
// the pinned Playwright image, where the baselines were recorded (apps/site/AGENTS.md);
// SITE_UPDATE_SCREENSHOTS=1 re-records them. Requests outside the served site are blocked.
// Usage: node scripts/visual-screens.mjs <base URL> <evidence dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

// playwright-core is the desktop app's dependency; the image provides its browsers.
const { chromium } = createRequire(new URL("../../desktop/package.json", import.meta.url))(
  "playwright-core",
);

const [base, out] = process.argv.slice(2);
if (!base || !out) throw new Error("Usage: visual-screens.mjs <base URL> <evidence dir>");
const baselines = new URL("../screenshots/", import.meta.url).pathname;
const updating = process.env.SITE_UPDATE_SCREENSHOTS === "1";
const routes = [
  "/en/",
  "/zh-tw/",
  "/en/pricing/",
  "/en/download/",
  "/en/terms/",
  "/en/privacy/",
  "/en/signin/",
];
const widths = { desktop: 1440, phone: 390 };

mkdirSync(out, { recursive: true });
if (updating) mkdirSync(baselines, { recursive: true });
const browser = await chromium.launch();
const failures = [];
try {
  for (const [device, width] of Object.entries(widths)) {
    const context = await browser.newContext({
      viewport: { width, height: 900 },
      deviceScaleFactor: 1,
      locale: "en-US",
      timezoneId: "UTC",
      reducedMotion: "reduce",
    });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === new URL(base).origin
        ? route.continue()
        : route.abort(),
    );
    const page = await context.newPage();
    for (const path of routes) {
      await page.goto(new URL(path, base).toString(), { waitUntil: "networkidle" });
      await page.evaluate(async () => {
        for (const image of document.querySelectorAll('img[loading="lazy"]')) {
          image.loading = "eager";
        }
        await document.fonts.ready;
      });
      await page.waitForFunction(
        () => [...document.images].every((image) => image.complete),
        null,
        {
          timeout: 30000,
        },
      );
      await page.evaluate(async () => {
        await Promise.all([...document.images].map((image) => image.decode().catch(() => null)));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const png = await page.screenshot({ fullPage: true, animations: "disabled", caret: "hide" });
      const name = `${path.replaceAll("/", "-").replace(/^-|-$/g, "")}-${device}.png`;
      if (updating) {
        writeFileSync(join(baselines, name), png);
        continue;
      }
      let expected = null;
      try {
        expected = readFileSync(join(baselines, name));
      } catch {
        // A missing baseline is a failure below.
      }
      if (!expected?.equals(png)) {
        writeFileSync(join(out, name), png);
        failures.push(name);
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}
if (failures.length) {
  console.error(
    `Screenshots differ from apps/site/screenshots (new renderings in ${out}): ${failures.join(", ")}.\n` +
      "If the change is intended, run `mise run screenshots:update` on the branch (apps/site/AGENTS.md).",
  );
  process.exit(1);
}
console.log(
  updating
    ? `Recorded ${routes.length * 2} screenshots.`
    : `${routes.length * 2} screenshots match.`,
);
