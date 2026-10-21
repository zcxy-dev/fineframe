// A brand kit's SVG logo drawn to a PNG for its watermark, in the same guarded Chrome the graphics
// render in, as an image, which runs nothing and loads nothing. Call it on an SVG svgProblem
// (logo.ts) passes.

import puppeteer from "puppeteer-core";
import { guardPage } from "./guard.ts";

/** The SVG's width and height ratio, from its width and height or its viewBox. */
function aspect(svg: string): number {
  const tag = /<svg\b[^>]*>/i.exec(svg)?.[0] ?? "";
  const number = (name: string) => {
    const value = new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)(px)?\\s*["']`).exec(tag)?.[1];
    return value === undefined ? undefined : Number(value);
  };
  const [width, height] = [number("width"), number("height")];
  if (width && height) return width / height;
  const box = /viewBox\s*=\s*["']([^"']*)["']/i
    .exec(tag)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box && box.length === 4 && (box[2] as number) > 0 && (box[3] as number) > 0) {
    return (box[2] as number) / (box[3] as number);
  }
  return 1;
}

/** The SVG drawn as a PNG with its transparency, its longer side `longest` pixels, in Chrome
 * Headless Shell at `chrome`. Call it on an SVG that svgProblem passes. */
export async function rasterizeSvg(svg: string, chrome: string, longest = 1024): Promise<Buffer> {
  const ratio = Math.min(20, Math.max(1 / 20, aspect(svg)));
  const width = Math.max(1, Math.round(ratio >= 1 ? longest : longest * ratio));
  const height = Math.max(1, Math.round(ratio >= 1 ? longest / ratio : longest));
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const tab = await browser.newPage();
    await guardPage(tab);
    await tab.setViewport({ width, height });
    const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    await tab.setContent(
      `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>html, body { margin: 0; background: transparent; } img { display: block; width: ${width}px; height: ${height}px; }</style></head><body><img src="${source}"></body></html>`,
      { waitUntil: "load" },
    );
    const drawn = await tab.$eval("img", (img) =>
      (img as HTMLImageElement).decode().then(
        () => true,
        () => false,
      ),
    );
    if (!drawn) throw new Error("The SVG logo does not draw");
    return Buffer.from(await tab.screenshot({ type: "png", omitBackground: true }));
  } finally {
    await browser.close();
  }
}
