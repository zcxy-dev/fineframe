import assert from "node:assert/strict";
import { test } from "node:test";
import { catalog, templateIds } from "./catalog.ts";
import { graphicFrame, graphicPage, graphicsGuide } from "./graphics.ts";
import { markupProblem, page } from "./page.ts";
import { HOUSE_CSS } from "./style.ts";
import { templateMarkup } from "./templates.ts";
import { graphicProblems } from "./validate.ts";

const SECOND = 120_000;
const output = { aspect: "9:16" as const, width: 1080, height: 1920, fps: { num: 30, den: 1 } };

test("a page loads only its own folder's styles and fonts, and lasts its frames", () => {
  const html = page({
    width: 1080,
    height: 1920,
    u: 10.8,
    fps: { num: 30000, den: 1001 },
    frames: 90,
    html: "<b>27</b>",
    css: ".x { color: red; }",
  });
  assert.match(html, /Content-Security-Policy" content="default-src 'none'/);
  assert.match(
    html,
    /<link rel="stylesheet" href="fonts\.css"><link rel="stylesheet" href="house\.css">/,
  );
  // Seeked by the renderer frame by frame from its CSS animations, with no timeline to wait for.
  assert.match(html, /data-no-timeline data-start="0" data-duration="3\.003"/);
  assert.match(html, /--u: 10\.8px/);
  assert.match(html, /<div id="frame" class="ff"><b>27<\/b><\/div>/);
  // A label renders only its own box, the frame laid out under it as in the whole picture.
  const boxed = page({
    width: 1080,
    height: 1920,
    box: { x: 40, y: 800, width: 480, height: 160 },
    u: 10.8,
    fps: { num: 30, den: 1 },
    frames: 30,
    html: "",
    css: "",
  });
  assert.match(boxed, /html, body \{ width: 480px; height: 160px; \}/);
  assert.match(
    boxed,
    /#frame \{ position: absolute; left: -40px; top: -800px; width: 1080px; height: 1920px;/,
  );
});

test("markup that would load or run anything is refused", () => {
  assert.equal(
    markupProblem(
      '<div class="ff-chip"><span>27</span></div>',
      "@keyframes a { from { opacity: 0 } }",
    ),
    null,
  );
  assert.equal(markupProblem("<b>x</b>", "b { background: url(data:image/png;base64,AA) }"), null);
  for (const [html, css] of [
    ["<script>alert(1)</script>", ""],
    ['<img src="https://x.com/a.png">', ""],
    ['<b onclick="x()">x</b>', ""],
    ['<a href="javascript:x()">x</a>', ""],
    ["<b>x</b>", "@import url(https://fonts.example/a.css);"],
    ["<b>x</b>", "b { background: url(https://x.com/a.png) }"],
    ["<style>b{}</style>", ""],
  ] as const) {
    assert.notEqual(markupProblem(html, css), null, html + css);
  }
});

test("each layout renders at its area's size: a label at its box with its alpha, a panel and a full frame opaque", () => {
  assert.deepEqual(graphicFrame("panel", output), { width: 1080, height: 880 });
  assert.deepEqual(graphicFrame("full", output), { width: 1080, height: 1920 });
  const box = { x: 40, y: 800, width: 480, height: 160 };
  const label = graphicPage({ layout: "label", html: "", css: "", box, output, frames: 30 });
  assert.deepEqual([label.width, label.height, label.transparent], [480, 160, true]);
  const panel = graphicPage({ layout: "panel", html: "", css: "", output, frames: 30 });
  assert.deepEqual([panel.width, panel.height, panel.transparent], [1080, 880, false]);
  const full = graphicPage({ layout: "full", html: "", css: "", box, output, frames: 30 });
  assert.deepEqual([full.width, full.height, full.transparent], [1080, 1920, false]);
});

test("the guide for Claude gives the house stylesheet, the safe area and the motion rules", () => {
  const portrait = graphicsGuide("9:16", 1080, 1920);
  assert.ok(portrait.includes(HOUSE_CSS.trim()));
  assert.match(portrait, /panel: the upper panel of a split screen, 1080×880 px/);
  assert.match(portrait, /x 76 to 918 and y 211 to 1152/);
  assert.match(portrait, /0\.3 to 0\.8 s/);
  assert.match(portrait, /Entrances only/);
  assert.match(portrait, /No scripts, no images, no url\(\)/);
  assert.doesNotMatch(graphicsGuide("16:9", 1920, 1080), /panel:/);
});

test("every template's markup enters and stays, but the wipe, which crosses the frame", () => {
  for (const aspect of ["16:9", "9:16"] as const) {
    const [width, height] = aspect === "16:9" ? [1920, 1080] : [1080, 1920];
    for (const id of templateIds) {
      const { html, css } = templateMarkup(id, catalog[id].example, aspect, width, height, 3);
      assert.equal(markupProblem(html, css), null, id);
      assert.ok(html.length > 0 && /animation:/.test(css), id);
      // Every animation fills both ways, so a part waits unseen and then stays.
      for (const [, rule] of css.matchAll(/animation: ([^;]+);/g)) {
        assert.match(rule ?? "", id === "wipe" ? /linear both$/ : /both$/, `${id}: ${rule}`);
      }
      assert.doesNotMatch(css, /to \{ opacity: 0/, id);
    }
  }
  // Text is escaped.
  const { html } = templateMarkup("title", { text: "<b>A & B</b>" }, "16:9", 1920, 1080, 3);
  assert.match(html, /&lt;b&gt;A &amp; B&lt;\/b&gt;/);
});

test("graphics are checked: no markup that loads anything, a box for a label, a panel only at 9:16, no longer than their layout holds", () => {
  const graphic = (overrides: object) => ({
    layout: "full" as const,
    html: "<b>x</b>",
    css: "",
    start: 0,
    duration: 4 * SECOND,
    ...overrides,
  });
  assert.deepEqual(graphicProblems([graphic({})], "9:16"), []);
  assert.deepEqual(
    graphicProblems(
      [
        graphic({ html: "<script></script>" }),
        graphic({ layout: "label" }),
        graphic({ layout: "panel" }),
        graphic({ duration: 13 * SECOND }),
        graphic({ layout: "label", box: { x: 0.8, y: 0.1, w: 0.4, h: 0.1 } }),
      ],
      "16:9",
    ),
    [
      "/graphics/0: it uses an element graphics may not use (script, iframe, img, link, style and the like)",
      "/graphics/1/box: a label needs the region it is drawn in",
      "/graphics/2/layout: a panel splits only a 9:16 frame",
      "/graphics/3/duration: 13 s, longer than a full's 12 s",
      "/graphics/4/box: x + w and y + h may not exceed 1",
    ],
  );
});
