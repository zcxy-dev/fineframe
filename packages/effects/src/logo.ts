// A brand kit's logo as an SVG, read with an XML parser against an allowlist, so one that runs a
// script, reaches outside itself or embeds HTML is refused. No browser here: the page's server
// checks a logo with it, and only a render draws one (raster.ts).

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
