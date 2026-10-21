// What a graphic's markup and styles may hold. Claude writes them, and a transcript can carry text
// meant to steer it, so they are read with a real HTML parser and a CSS parser against an
// allowlist, never by pattern: anything else is refused, and the page renders the markup as
// rebuilt from that parse, so the browser draws exactly what was checked.

import { Parser } from "htmlparser2";
import postcss, { type Declaration, type Root } from "postcss";
import { markOf } from "./icons.ts";

/** Elements for text and boxes, and images of the bundled icons and logos. */
const ELEMENTS = new Set([
  "div", "span", "p", "b", "strong", "i", "em", "small", "sub", "sup", "br",
  "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "img",
]); // biome-ignore format: one list
const VOID = new Set(["br", "img"]);
/** Attributes any element may have, and those an image may have besides. */
const ATTRIBUTES = new Set(["class", "style"]);
const IMAGE_ATTRIBUTES = new Set(["src", "alt", "width", "height"]);
/** At-rules a graphic's own CSS may hold: its animations' keyframes and typed custom properties. */
const AT_RULES = new Set(["keyframes", "-webkit-keyframes", "property"]);
/** CSS that loads something, or writes text no check reads (generated content and counters). */
const LOADS =
  /url\(|image-set\(|image\(|cross-fade\(|element\(|expression\(|-moz-binding|behavior/i;
const COUNTERS = new Set(["counter-reset", "counter-increment", "counter-set"]);

interface Node {
  name: string;
  attributes: [string, string][];
  children: (Node | string)[];
}

/** The markup parsed as a browser would, or why it cannot be drawn. */
function parse(html: string): { root: Node; problem: string | null } {
  const root: Node = { name: "", attributes: [], children: [] };
  const open: Node[] = [root];
  let problem: string | null = null;
  const refuse = (why: string) => {
    problem ??= why;
  };
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (!ELEMENTS.has(name)) refuse(`it uses <${name}>, which graphics may not use`);
        const node: Node = { name, attributes: Object.entries(attributes), children: [] };
        for (const [key, value] of node.attributes) {
          const allowed = ATTRIBUTES.has(key) || (name === "img" && IMAGE_ATTRIBUTES.has(key));
          if (!allowed) refuse(`it has a ${key} attribute, which graphics may not use`);
          else if (key === "style") {
            const why = cssProblem(`x{${value}}`);
            if (why) refuse(`its style attribute ${why}`);
          } else if ((key === "width" || key === "height") && !/^\d{1,4}$/.test(value)) {
            refuse(`its image's ${key} is not a number of pixels`);
          }
        }
        if (name === "img") {
          const src = attributes.src;
          if (!src || !markOf(src)) {
            refuse(
              `its image ${src ? `"${src}"` : "without a src"} is not one of the bundled icons or logos`,
            );
          }
        }
        (open.at(-1) as Node).children.push(node);
        if (!VOID.has(name)) open.push(node);
      },
      onclosetag(name) {
        if (VOID.has(name)) return;
        const at = open.findLastIndex((node) => node.name === name);
        if (at > 0) open.length = at;
      },
      ontext(text) {
        (open.at(-1) as Node).children.push(text);
      },
      oncomment() {
        refuse("it has an HTML comment, which browsers and parsers may read differently");
      },
      onprocessinginstruction() {
        refuse("it has a doctype or processing instruction");
      },
      oncdatastart() {
        refuse("it has a CDATA section");
      },
    },
    { lowerCaseTags: true, lowerCaseAttributeNames: true, decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  return { root, problem };
}

const escapeText = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const escapeAttribute = (value: string) => escapeText(value).replaceAll('"', "&quot;");

/** What rebuilding markup changes: each style attribute's declarations, and each image's
 * source. */
export interface Restyle {
  style(declarations: string): string;
  src(src: string): string;
}

function serialize(node: Node | string, restyle?: Restyle): string {
  if (typeof node === "string") return escapeText(node);
  const inner = node.children.map((child) => serialize(child, restyle)).join("");
  if (!node.name) return inner;
  const attributes = node.attributes.map(([key, value]) => {
    const changed =
      restyle && key === "style"
        ? restyle.style(value)
        : restyle && key === "src"
          ? restyle.src(value)
          : value;
    return ` ${key}="${escapeAttribute(changed)}"`;
  });
  const open = `<${node.name}${attributes.join("")}>`;
  return VOID.has(node.name) ? open : `${open}${inner}</${node.name}>`;
}

function declarationProblem(declaration: Declaration): string | null {
  const property = declaration.prop.toLowerCase();
  if (LOADS.test(declaration.value)) return "loads something (url() and the like)";
  if (COUNTERS.has(property) || /counters?\(/i.test(declaration.value)) {
    return "uses a CSS counter, whose text no check reads";
  }
  if (property === "content" && !/^(none|normal|""|'')$/.test(declaration.value.trim())) {
    return "writes text with content:, which no check reads";
  }
  return null;
}

/** Why a stylesheet cannot be drawn as it is, or null. */
function cssProblem(css: string): string | null {
  // Inside the page's <style>, these would end it and start markup.
  if (/<\/|<!/.test(css)) return "has </ or <!, which would end the stylesheet";
  let root: Root;
  try {
    root = postcss.parse(css);
  } catch {
    return "does not parse as CSS";
  }
  let problem: string | null = null;
  root.walkAtRules((rule) => {
    if (!AT_RULES.has(rule.name.toLowerCase())) problem ??= `uses @${rule.name}`;
  });
  root.walkDecls((declaration) => {
    const why = declarationProblem(declaration);
    if (why) problem ??= why;
  });
  return problem;
}

/** Why the markup or styles Claude wrote cannot be drawn as they are, or null. */
export function markupProblem(html: string, css: string): string | null {
  const { problem } = parse(html);
  if (problem) return problem;
  const css_ = cssProblem(css);
  return css_ ? `its CSS ${css_}` : null;
}

/** The markup as rebuilt from its parse, for the page: only what the checks read reaches the
 * browser. Call it on markup that markupProblem passes; `restyle` puts it in a brand kit's look. */
export function cleanMarkup(html: string, restyle?: Restyle): string {
  return serialize(parse(html).root, restyle);
}
