import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { Rebrand } from "./brand.ts";
import { catalog, templateIds } from "./catalog.ts";
import { brandTones, contrast, hex, isAmber, PALETTE, readable } from "./colour.ts";
import { type GraphicLayout, graphicPage } from "./graphics.ts";
import { page } from "./page.ts";
import { HOUSE_CSS } from "./style.ts";
import { templateMarkup } from "./templates.ts";

const output = { aspect: "9:16" as const, width: 1080, height: 1920, fps: { num: 30, den: 1 } };
const BLUE = { primary: "#2f6bff" };

/** Every colour written outright in CSS or markup that is in the amber's family. */
function ambers(text: string): string[] {
  const found: string[] = [];
  for (const [token] of text.matchAll(
    /#[0-9a-fA-F]{6}(?![\w-])|rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)[^)]*\)/g,
  )) {
    const rgb = token.startsWith("#")
      ? hex(token)
      : (token.match(/\d+/g)?.slice(0, 3).map(Number) as [number, number, number]);
    if (isAmber(rgb)) found.push(token);
  }
  return found;
}

test("the house's ambers and a graphic's stray near-ambers all become the kit's tones", () => {
  const brand = new Rebrand({ colors: BLUE });
  assert.ok(ambers(HOUSE_CSS).length > 5);
  assert.deepEqual(ambers(brand.house()), []);
  const css = `.a { color: #f5a623; background: rgba(245, 166, 35, 0.4); }
.b { border-color: hsl(38 90% 55%); box-shadow: 0 0 9px rgb(255 190 80 / 50%); fill: orange; }
.c { color: #7bc29a; background: #ffffff; animation: gold-in 1s; }`;
  const rebranded = brand.css(css);
  assert.deepEqual(ambers(rebranded), []);
  assert.doesNotMatch(rebranded, /hsl\(38|orange;/);
  // Alpha is kept; colours outside the family and names that only contain one stay.
  assert.match(rebranded, /background: rgba\(\d+, \d+, \d+, 0\.4\)/);
  assert.match(rebranded, /rgba\(\d+, \d+, \d+, 0\.5\)/);
  assert.match(rebranded, /\.c \{ color: #7bc29a; background: #ffffff; animation: gold-in 1s; \}/);
});

test("text in the accent stays readable on the stage, and text on it turns black or white", () => {
  const navy = new Rebrand({ colors: { primary: "#14213d" } });
  const css = navy.css(
    ".k { color: var(--accent); } .t { color: #ffb547; } .tag { background: #ffb547; color: #0b0c0f; }",
  );
  // Navy would vanish on the near-black stage: its text is white instead.
  assert.match(css, /\.k \{ color: #ffffff; \}/);
  assert.match(css, /\.t \{ color: #ffffff; \}/);
  assert.match(css, /\.tag \{ background: #14213d; color: #ffffff; \}/);
  const light = new Rebrand({ colors: { primary: "#9be7ff" } });
  assert.match(
    light.css(".tag { background: var(--accent); color: var(--ink); }"),
    /color: #000000/,
  );
  assert.equal(readable("#9be7ff", PALETTE.ink), "#9be7ff");
  assert.ok(contrast(hex(readable("#14213d", PALETTE.ink)), hex(PALETTE.ink)) >= 3);
});

test("a kit's missing tones are made from its primary, deeper and lighter as the house's are", () => {
  const tones = brandTones(BLUE);
  assert.equal(tones.primary, "#2f6bff");
  assert.notEqual(tones.secondary, tones.primary);
  assert.notEqual(tones.accent, tones.primary);
  assert.deepEqual(brandTones({ primary: "#2F6BFF", secondary: "#00AA00", accent: "#EEEEEE" }), {
    primary: "#2f6bff",
    secondary: "#00aa00",
    accent: "#eeeeee",
  });
});

test("a graphic in a kit's look: its markup's styles, accent icons and face change, and nothing else", () => {
  const job = {
    layout: "full" as const,
    html: '<div class="ff-stage"></div><b style="color: #ffb547">27</b><img src="icons/accent/rocket.svg" width="40" height="40"><img src="icons/rocket.svg" width="40" height="40">',
    css: ".x { font-family: Inter; text-shadow: 0 0 4px rgba(255, 181, 71, 0.35); }",
    output,
    frames: 30,
  };
  const plain = graphicPage(job);
  assert.equal(plain.files, undefined);
  assert.match(plain.page, /href="house\.css"/);
  const sha256 = "ab".repeat(32);
  const branded = graphicPage({
    ...job,
    brand: { colors: BLUE, font: { path: "/k/Face.TTF", sha256 } },
  });
  assert.deepEqual(ambers(branded.page), []);
  assert.doesNotMatch(branded.page, /href="house\.css"/);
  assert.match(branded.page, /src: url\(brand\/abababababababab\.ttf\)/);
  assert.match(branded.page, /\.x \{ font-family: "Fineframe Brand", "Noto Sans TC", sans-serif;/);
  assert.match(branded.page, /<img src="brand\/marks-2f6bff\/icons\/accent\/rocket\.svg"/);
  assert.match(branded.page, /<img src="icons\/rocket\.svg"/);
  const files = branded.files ?? new Map();
  assert.deepEqual(files.get("brand/abababababababab.ttf"), { copy: "/k/Face.TTF" });
  const icon = files.get("brand/marks-2f6bff/icons/accent/rocket.svg");
  assert.ok(icon && "text" in icon && icon.text.includes('stroke="#2f6bff"'));
});

test("without a kit, a page is the one the house look always drew", () => {
  const spec = { width: 1080, height: 1920, u: 10.8, fps: output.fps, frames: 30 };
  for (const id of templateIds) {
    const markup = templateMarkup(id, catalog[id].example, "9:16", 1080, 1920, 1);
    assert.equal(page({ ...spec, ...markup }), page({ ...spec, ...markup, house: undefined }));
    assert.deepEqual(ambers(new Rebrand({ colors: BLUE }).css(markup.css)), []);
  }
});

test("without a kit, every graphic and template page is the one drawn before kits", () => {
  // Hashes of the pages, recorded with the effects before brand kits: an edit made then renders
  // its effects byte for byte as it did. A deliberate change to a page changes this too.
  const hash = (value: unknown) =>
    createHash("sha256")
      .update(typeof value === "string" ? value : JSON.stringify(value))
      .digest("hex")
      .slice(0, 16);
  const out: Record<string, string> = {};
  for (const aspect of ["16:9", "9:16"] as const) {
    const size = aspect === "16:9" ? { width: 1280, height: 720 } : { width: 1080, height: 1920 };
    const output = { aspect, ...size, fps: { num: 30, den: 1 } };
    const layouts =
      aspect === "9:16" ? ["label", "panel", "full"] : ["label", "lower-third", "full"];
    for (const layout of layouts as GraphicLayout[]) {
      const made = graphicPage({
        layout,
        html: '<div class="ff-stage"></div><b class="ff-accent" style="color: #ffb547">27</b><img src="icons/accent/rocket.svg" width="20" height="20">',
        css: ".x { color: rgba(255, 181, 71, 0.5); }",
        box: { x: 10, y: 20, width: 300, height: 80 },
        output,
        frames: 45,
      });
      out[`graphic ${aspect} ${layout}`] = hash([
        made.page,
        made.width,
        made.height,
        made.transparent,
        made.files ?? null,
      ]);
    }
    for (const id of templateIds) {
      const markup = templateMarkup(id, catalog[id].example, aspect, size.width, size.height, 2.9);
      const u = Math.min(size.width, size.height) / 100;
      out[`template ${aspect} ${id}`] = hash(
        page({ ...size, u, fps: output.fps, frames: 90, ...markup }),
      );
    }
  }
  assert.equal(Object.keys(out).length, 16);
  assert.equal(hash(out), "cb122141f132b56a");
});
