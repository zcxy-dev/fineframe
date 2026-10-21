// A brand kit's logo as an SVG: read with an XML parser against an allowlist, so one that runs a
// script, reaches outside itself or embeds HTML is refused, then drawn to a PNG in the same guarded
// Chrome the graphics render in, as an image, which runs nothing and loads nothing.

import { Parser } from "htmlparser2";

/** The largest SVG logo read. */
export const MAX_SVG_BYTES = 2 * 1024 * 1024;

/** Shapes, text, gradients, clips and masks, and references inside the file; no style sheets. */
const ELEMENTS = new Set(
  [
    "svg", "g", "defs", "symbol", "use", "title", "desc", "metadata", "path", "rect", "circle",
    "ellipse", "line", "polyline", "polygon", "text", "tspan", "lineargradient", "radialgradient",
    "stop", "clippath", "mask", "pattern", "filter", "fegaussianblur", "feoffset", "feblend",
    "fecolormatrix", "fecomposite", "feflood", "femerge", "femergenode",
  ],
); // biome-ignore format: one list

/** A CSS value with its escapes decoded (`\75 rl(` is `url(`), as a browser reads it. */
function unescapeCss(value: string): string {
  return value
    .replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?/g, (_, hex: string) =>
      String.fromCodePoint(Math.min(Number.parseInt(hex, 16), 0x10ffff) || 0xfffd),
    )
    .replace(/\\(.)/g, "$1");
}

/** Why an SVG logo cannot be used, or null. Attribute values are read with their entities
 * decoded and their CSS escapes too, so no spelling of a load gets past; styles of any kind are
 * refused rather than read, as is every processing instruction but the XML declaration. */
export function svgProblem(svg: string): string | null {
  if (Buffer.byteLength(svg) > MAX_SVG_BYTES) return "it is larger than 2 MB";
  let problem: string | null = null;
  const refuse = (why: string) => {
    problem ??= why;
  };
  let root: string | null = null;
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        // XML keeps a tag's case: linearGradient, foreignObject.
        root ??= name.toLowerCase();
        if (!ELEMENTS.has(name.toLowerCase())) refuse(`it has a <${name}> element`);
        for (const [key, value] of Object.entries(attributes)) {
          if (key.startsWith("on")) refuse(`it has a ${key} attribute`);
          const reference = key === "href" || key.endsWith(":href");
          if (reference && !value.trim().startsWith("#")) refuse("it refers to another file");
          const read = unescapeCss(value);
          if (/url\(\s*['"]?(?!#)/i.test(read) || /javascript:|@import/i.test(read)) {
            refuse("it refers to another file");
          }
        }
      },
      onprocessinginstruction(name) {
        const lower = name.toLowerCase();
        if (lower.startsWith("!doctype")) refuse("it has a doctype");
        else if (lower !== "?xml") refuse(`it has a processing instruction (${name})`);
      },
      oncdatastart() {
        refuse("it has a CDATA section");
      },
    },
    { xmlMode: true, recognizeCDATA: true },
  );
  parser.write(svg);
  parser.end();
  if (root !== "svg") return "it is not an SVG image";
  return problem;
}

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
  // Loaded only to draw: a server that reads kits never starts a browser to check one.
  const { default: puppeteer } = await import("puppeteer-core");
  const { guardPage } = await import("./guard.ts");
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
