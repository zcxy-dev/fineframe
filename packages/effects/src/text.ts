// A graphic's text as a person reads it, for the re-edit panel's labels. Only the HTML parser, so
// the page's server bundles it without the CSS parser the markup's checks use (markup.ts).

import { Parser } from "htmlparser2";

/** The markup's text as drawn: entities decoded, a space between elements, whitespace collapsed. */
export function markupText(html: string): string {
  const parts: string[] = [];
  const between = () => parts.push(" ");
  const parser = new Parser(
    { ontext: (text) => parts.push(text), onopentag: between, onclosetag: between },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  return parts.join("").replace(/\s+/g, " ").trim();
}
