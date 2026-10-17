import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { test } from "node:test";
import { panelShare } from "@video-editor/effects";
import { validateProject } from "@video-editor/schema";
import type { Capture } from "../broll/capture.ts";
import { project, SECOND, scratch } from "../testing.ts";
import type { TimedWord } from "./captions.ts";
import { recordedClaude, type Usage } from "./claude.ts";
import type { Line } from "./pack.ts";
import { planSchema, planSystem } from "./prompt.ts";
import {
  type Asset,
  FULL_MAX,
  PANEL_MAX,
  type PlacedVisual,
  parseVisuals,
  placeVisuals,
  repairCards,
  sourceVisuals,
  speakerClips,
  stillFraming,
  type VisualWish,
  visualKey,
  visualParts,
  wishProblem,
} from "./visuals.ts";

const wish = (overrides: Partial<VisualWish>): VisualWish => ({
  source: "a",
  line: 1,
  text: "",
  kind: "card",
  query: "",
  url: "",
  focus: "",
  card: "",
  params: "",
  sfx: "none",
  reason: "",
  ...overrides,
});
const stat = wish({ card: "stat", params: JSON.stringify({ value: 3, label: "倍的速度" }) });
const extras = { music: false, title: false, chapters: false, people: false, callouts: false };

test("a rich plan asks for visuals, with stock footage only when a key allows it", () => {
  const minimal = planSchema(extras);
  assert.ok(!("visuals" in (minimal.properties as object)));
  assert.equal(planSystem(extras), planSystem({ ...extras, visuals: false }));
  assert.doesNotMatch(planSystem(extras), /## Visuals/);

  // One JSON string, checked in code: with every other extra on, an array of objects in the
  // schema makes a grammar too large for structured outputs to compile.
  const every = { music: true, title: true, chapters: true, people: true, callouts: true };
  const schema = planSchema({ ...every, visuals: true, stock: true });
  assert.ok((schema.required as string[]).includes("visuals"));
  assert.deepEqual((schema.properties as Record<string, object>).visuals, {
    type: "string",
    description: "The visuals as a JSON array, [] for none.",
  });
  const rich = planSystem({ ...extras, visuals: true, stock: false });
  assert.match(rich, /## Visuals/);
  assert.match(rich, /- stat: /);
  // Each card's text limits, so its params pass the card's schema.
  assert.match(rich, /- versus: .*left\.name 14/);
  assert.match(rich, /- stat: .*At most: prefix 4, suffix 6, label 28, context 40 characters\./);
  assert.match(rich, /- kpis: .*At most: title 24 characters; items 2 to 4, each prefix 4, suffix 6, label 14 characters\./); // biome-ignore format: one line
  assert.doesNotMatch(rich, /stock: real footage/);
  assert.match(planSystem({ ...extras, visuals: true, stock: true }), /stock: real footage/);
});

test("the plan's visuals are read from their JSON, each left out unless whole", () => {
  const problems: string[] = [];
  const good = { source: "a", line: 2, text: "Surya", kind: "card", card: "stat", params: "{}", sfx: "tap", reason: "r" }; // biome-ignore format: one line
  const read = parseVisuals(
    JSON.stringify([
      good,
      { ...good, line: "3" },
      { ...good, kind: "stock" },
      { ...good, sfx: "laser" },
      { source: "a", line: 4, text: "x", kind: "web", url: "https://example.com/" },
    ]),
    false,
    (problem) => problems.push(problem),
  );
  assert.deepEqual(read, [
    wish({
      line: 2,
      text: "Surya",
      kind: "card",
      card: "stat",
      params: "{}",
      sfx: "tap",
      reason: "r",
    }),
    wish({ line: 4, text: "x", kind: "web", url: "https://example.com/" }),
  ]);
  assert.equal(problems.length, 3);
  assert.deepEqual(parseVisuals(JSON.stringify([{ ...good, kind: "stock", query: "sun" }]), true).length, 1); // biome-ignore format: one line
  assert.deepEqual(
    parseVisuals("[{", false, (problem) => problems.push(problem)),
    [],
  );
  assert.match(problems.at(-1) ?? "", /not JSON/);
  assert.deepEqual(parseVisuals("", false), []);
});

test("a card whose params break its schema is rewritten once, then checked again", async () => {
  const long = wish({ line: 2, card: "stat", params: JSON.stringify({ value: 3, label: "這是一段超過二十八個字元的標籤，太長了放不進卡片的版面裡面" }) }); // biome-ignore format: one line
  const zero = wish({ line: 3, card: "list", params: JSON.stringify({ items: [{ text: "一" }, { text: "二" }], active: 0 }) }); // biome-ignore format: one line
  const page = wish({ line: 4, kind: "web", url: "https://example.com/" });
  const fixedStat = JSON.stringify({ value: 3, label: "倍的速度" });
  const { claude, requests } = recordedClaude({ repair: [{ fixed: [fixedStat, "{\"items\": []}"] }] }); // biome-ignore format: one line
  const usage: Usage[] = [];
  const repaired = await repairCards([stat, long, zero, page], claude, usage);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.purpose, "repair");
  const asked = requests[0]?.content.at(-1);
  assert.match(asked?.type === "text" ? asked.text : "", /label.*28 characters/s);
  assert.deepEqual(repaired, [stat, { ...long, params: fixedStat }, zero, page]);
  assert.equal(usage.length, 1);
  // Nothing to repair, nothing asked; a failed request keeps the wishes as they were.
  const none = recordedClaude({});
  assert.deepEqual(await repairCards([stat, page], none.claude, []), [stat, page]);
  assert.equal(none.requests.length, 0);
  assert.deepEqual(await repairCards([long], none.claude, []), [long]);
});

test("code checks each visual before sourcing it", () => {
  assert.equal(wishProblem(stat, false), null);
  assert.match(wishProblem(wish({ card: "sparkles", params: "{}" }), false) ?? "", /no card/);
  assert.match(wishProblem(wish({ card: "stat", params: "{value: 3" }), false) ?? "", /not JSON/);
  assert.match(
    wishProblem(wish({ card: "stat", params: JSON.stringify({ value: "3" }) }), false) ?? "",
    /params/,
  );
  const web = (url: string) => wishProblem(wish({ kind: "web", url }), false);
  assert.equal(web("https://huggingface.co/nasa-ibm-ai4science"), null);
  assert.match(web("http://localhost:3000/") ?? "", /local/);
  assert.match(web("http://192.168.1.2/") ?? "", /local/);
  assert.match(web("file:///etc/passwd") ?? "", /http/);
  assert.match(web("not a page") ?? "", /Not a web address/);
  assert.match(web("https://www.google.com/search?q=surya") ?? "", /search page/);
  assert.match(wishProblem(wish({ kind: "stock", query: "the sun" }), false) ?? "", /key/);
  assert.equal(wishProblem(wish({ kind: "stock", query: "the sun" }), true), null);
});

test("a visual that cannot be sourced is left out and its line keeps the speaker", async (t) => {
  const dir = await scratch(t, "visuals-");
  const assets = new Map<string, Asset | null>();
  const problems: string[] = [];
  const page = wish({ kind: "web", url: "https://example.com/", focus: "Example Domain", line: 2 }); // biome-ignore format: one line
  const broken = wish({ kind: "web", url: "https://example.org/", line: 3 });
  const footage = wish({ kind: "stock", query: "solar flare", line: 4 });
  const captured: { url: string; text?: string; viewport?: object }[] = [];
  await sourceVisuals([stat, page, broken, footage, stat], assets, {
    output: { aspect: "9:16", width: 1080, height: 1920 },
    stock: false,
    dir,
    onProblem: (message) => problems.push(message),
    capture: async (options) => {
      captured.push(options);
      if (options.url.includes("example.org")) throw new Error("timed out");
      await writeFile(options.out, "png");
      const focus = { x: 400, y: 300, width: 600, height: 80 };
      const credit = { what: "Screenshot of example.com", source: options.url, license: null, by: null }; // biome-ignore format: one line
      return { path: options.out, kind: "still", width: 2200, height: 1792, focus, credit } satisfies Capture; // biome-ignore format: one line
    },
  });
  assert.deepEqual(assets.get(visualKey(stat)), { kind: "card", card: "stat", params: { value: 3, label: "倍的速度" } }); // biome-ignore format: one line
  assert.equal(assets.get(visualKey(page))?.kind, "image");
  assert.equal(assets.get(visualKey(broken)), null);
  assert.equal(assets.get(visualKey(footage)), null);
  assert.equal(problems.length, 2);
  assert.match(problems.join("\n"), /line 3: timed out/);
  assert.match(problems.join("\n"), /line 4: no stock footage key/);
  // The page is captured in a viewport of the panel's shape, at 2x the panel's width.
  const [first] = captured;
  assert.deepEqual(first?.viewport, { width: 1100, height: 896 });
  assert.equal(first?.text, "Example Domain");
  // A capture made before is read back, not taken again.
  const again = new Map<string, Asset | null>();
  await sourceVisuals([page], again, {
    output: { aspect: "9:16", width: 1080, height: 1920 },
    stock: false,
    dir,
    onProblem: () => {},
    capture: async () => assert.fail("captured again"),
  });
  assert.deepEqual(again.get(visualKey(page)), assets.get(visualKey(page)));
});

/** `lines` lines of three words, line n said from (n - 1) × 2 s. */
function speech(lines: number) {
  const words: TimedWord[] = [];
  const list: Line[] = [];
  for (let n = 1; n <= lines; n++) {
    const first = words.length;
    for (let k = 0; k < 3; k++) {
      const start = ((n - 1) * 2 + k * 0.6) * SECOND;
      words.push({ source: "a", index: words.length, text: `w${words.length}`, start, end: start + 0.5 * SECOND }); // biome-ignore format: one line
    }
    list.push({ source: "a", n, first, last: words.length - 1 });
  }
  return {
    words,
    lines: (_: string, n: number) => list.find((line) => line.n === n),
    sourceWords: () => words.map((w) => ({ text: w.text, start: w.start / SECOND, end: w.end / SECOND })), // biome-ignore format: one line
  };
}

test("visuals land on their words, a creator's pace apart, clear of what they may not cover", () => {
  const talk = speech(20);
  const assets = new Map<string, Asset | null>();
  const image: Asset = { kind: "image", path: "/p.png", width: 2200, height: 1792, focus: null, credit: { what: "x", source: "https://x.com", license: null, by: null } }; // biome-ignore format: one line
  const card = (line: number, text = "") => ({ ...stat, line, text });
  const web = (line: number) => wish({ kind: "web", url: "https://x.com/", line });
  assets.set(visualKey(stat), { kind: "card", card: "stat", params: { value: 3, label: "x" } });
  assets.set(visualKey(web(0)), image);
  const context = { ...talk, edit: 40 * SECOND, frame: SECOND / 30, aspect: "9:16" as const };
  const placed = placeVisuals(
    [
      card(1, "w1"),
      // Too close after the first: left out.
      card(2),
      web(4),
      // Starts inside a name: left out.
      card(8),
      card(12),
      card(14),
      card(16),
      card(18),
    ],
    assets,
    { ...context, blocked: [{ start: 14 * SECOND, end: 17 * SECOND }] },
  );
  const at = (v: PlacedVisual) => [v.wish.line, v.start / SECOND, v.end / SECOND, v.layout];
  // On w1, said at 0.6 s; a stat card's typical 3 s is cut to its line's end (2.0 s + 0.4 s)
  // only down to its minimum of 1.8 s.
  assert.deepEqual(at(placed[0] as PlacedVisual), [1, 0.6, 2.4, "full"]);
  // A capture splits the screen for 4 s, cut back to its line's end.
  assert.deepEqual(at(placed[1] as PlacedVisual), [4, 6, 8.1, "panel"]);
  assert.deepEqual(
    placed.map((v) => v.wish.line),
    [1, 4, 12, 14, 16, 18],
  );
  // At most one every 5 s of the edit.
  const few = placeVisuals([card(1), card(5), card(9), card(13)], assets, { ...context, edit: 10 * SECOND }); // biome-ignore format: one line
  assert.equal(few.length, 2);
  // Ends where something it may not cover starts.
  const cut = placeVisuals([card(1)], assets, { ...context, blocked: [{ start: 1.9 * SECOND, end: 5 * SECOND }] }); // biome-ignore format: one line
  const why: string[] = [];
  placeVisuals([card(1)], assets, { ...context, blocked: [{ start: 0, end: 5 * SECOND }], onLeftOut: (_, reason) => why.push(reason) }); // biome-ignore format: one line
  assert.deepEqual(why, ["it would start under a title, chapter or name"]);
  assert.equal((cut[0]?.end ?? 0) / SECOND, 1.9);
  // Footage fills the frame, for at most 3.5 s.
  const footage = wish({ kind: "stock", query: "the sun", line: 6 });
  assets.set(visualKey(footage), { kind: "video", path: "/sun.mp4", seconds: 12, id: "pexels:1", credit: image.credit }); // biome-ignore format: one line
  const [sun] = placeVisuals([footage], assets, context);
  assert.deepEqual(sun && at(sun), [6, 10, 12.1, "full"]);
  // Other aspects have no split; every visual fills the frame.
  const wide = placeVisuals([web(4)], assets, { ...context, aspect: "16:9" });
  assert.equal(wide[0]?.layout, "full");
  for (const v of placed) {
    const cap = v.layout === "full" ? FULL_MAX : PANEL_MAX;
    assert.ok(v.end - v.start <= cap * SECOND);
    assert.equal(v.start % (SECOND / 30), 0);
    assert.equal(v.end % (SECOND / 30), 0);
  }
});

test("a capture is zoomed into its words, in the box's shape, never past its own pixels", () => {
  const box = { width: 1080, height: 880 };
  const focus = { x: 1500, y: 1500, width: 400, height: 80 };
  const framing = stillFraming({ width: 2200, height: 1792, focus }, box, 3 * SECOND);
  const crop = framing.crop?.type === "static" ? framing.crop.rect : assert.fail("no crop");
  const [w, h] = [crop.w * 2200, crop.h * 1792];
  assert.ok(Math.abs(w / h - box.width / box.height) < 0.01, `${w}x${h}`);
  // The words are small, so the crop is as small as the box's own pixels allow.
  assert.ok(Math.abs(w - 1080) < 1, `${w}`);
  // The words are inside the crop, which stays inside the still.
  assert.ok(crop.x * 2200 <= focus.x && (crop.x + crop.w) * 2200 >= focus.x + focus.width);
  assert.ok(crop.y * 1792 <= focus.y && (crop.y + crop.h) * 1792 >= focus.y + focus.height);
  assert.ok(crop.x + crop.w <= 1 && crop.y + crop.h <= 1);
  // A slow push in about the words.
  assert.deepEqual(framing.scale, {
    type: "path",
    keyframes: [
      { t: 0, scale: 1 },
      { t: 3 * SECOND, scale: 1.08 },
    ],
  });
  const ax = (focus.x + focus.width / 2 - crop.x * 2200) / w;
  assert.ok(Math.abs((framing.anchor?.x ?? 0) - ax) < 1e-6);
  // Without words to aim at: the whole still, pushed in about its middle.
  const whole = stillFraming({ width: 2200, height: 1792, focus: null }, box, SECOND);
  const all = whole.crop?.type === "static" ? whole.crop.rect : assert.fail("no crop");
  assert.ok(Math.abs(all.w * 2200 - 1792 * (1080 / 880)) < 1);
  assert.deepEqual(whole.anchor, { x: 0.5, y: 0.5 });
});

test("the speaker beside a split screen plays in step with the main track, across its cuts", () => {
  const output = { aspect: "9:16" as const, width: 1080, height: 1920 };
  const main = [
    { source: "a", in: 10 * SECOND, out: 13 * SECOND },
    { source: "a", in: 20 * SECOND, out: 24 * SECOND },
  ];
  const panel = { wish: stat, asset: { kind: "card", card: "stat", params: {} }, layout: "panel" } as const; // biome-ignore format: one line
  const clips = speakerClips(
    [
      { ...panel, start: 2 * SECOND, end: 5 * SECOND },
      { ...panel, layout: "full", start: 6 * SECOND, end: 7 * SECOND },
    ],
    main,
    () => null,
    output,
  );
  const rect = { x: 0, y: panelShare("9:16"), w: 1, h: 1 - panelShare("9:16") };
  assert.deepEqual(clips, [
    { source: "a", in: 12 * SECOND, out: 13 * SECOND, start: 2 * SECOND, rect },
    { source: "a", in: 20 * SECOND, out: 22 * SECOND, start: 3 * SECOND, rect },
  ]);
});

test("placed visuals become cards, B-roll with credits and an occasional sound", async (t) => {
  const dir = await scratch(t, "visual-parts-");
  const still = join(dir, "page.png");
  await writeFile(still, "png");
  const credit = { what: "Screenshot of x.com", source: "https://x.com/", license: null, by: null }; // biome-ignore format: one line
  const image: Asset = { kind: "image", path: still, width: 2200, height: 1792, focus: null, credit }; // biome-ignore format: one line
  const card: Asset = { kind: "card", card: "stat", params: { value: 3, label: "x" } };
  const output = { aspect: "9:16" as const, width: 1080, height: 1920 };
  const at = (start: number, end: number, asset: Asset, layout: "full" | "panel", sfx: VisualWish["sfx"]) => ({ wish: wish({ sfx }), asset, start: start * SECOND, end: end * SECOND, layout }); // biome-ignore format: one line
  const parts = await visualParts(
    [
      at(0, 2, card, "full", "tap"),
      at(3, 6, image, "panel", "click"),
      at(7, 9, card, "full", "tap"),
      at(10, 12, image, "panel", "none"),
    ],
    output,
    (file) => relative(dir, file).split(sep).join("/"),
  );
  assert.deepEqual(
    parts.cards.map((c) => [c.card, c.start / SECOND, c.duration / SECOND, c.placement]),
    [
      ["stat", 0, 2, "full"],
      ["stat", 7, 2, "full"],
    ],
  );
  // One still, shown twice, is one source; in the panel, pushed in.
  assert.equal(parts.broll.length, 2);
  assert.deepEqual(new Set(parts.broll.map((b) => b.source)).size, 1);
  assert.deepEqual(parts.broll[0]?.rect, { x: 0, y: 0, w: 1, h: panelShare("9:16") });
  // A sound at most every 6 s: the click 3 s after the first tap is left out.
  assert.deepEqual(
    parts.sfx.map((s) => s.start / SECOND),
    [0, 7],
  );
  const still2 = parts.sources.find((s) => s.kind === "image");
  assert.deepEqual(still2?.credit, { what: "Screenshot of x.com", source: "https://x.com/" });
  const sound = parts.sources.find((s) => s.kind === "audio");
  assert.equal(sound?.credit?.license?.name, "CC0 1.0");
  // Two taps take two different files.
  assert.notEqual(parts.sfx[0]?.source, parts.sfx[1]?.source);
  // It all validates as a project.
  const main = project([{ source: "a", in: 0, out: 12 * SECOND }]);
  validateProject({
    ...main,
    output: { ...main.output, aspect: "9:16", width: 1080, height: 1920 },
    sources: [...main.sources, ...parts.sources] as typeof main.sources,
    broll: parts.broll,
    cards: parts.cards,
    audio: { ...main.audio, sfx: parts.sfx },
  });
});
