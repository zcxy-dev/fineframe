import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { panelShare } from "@video-editor/effects";
import { validateProject } from "@video-editor/schema";
import type { Capture } from "../broll/capture.ts";
import { project, SECOND, scratch } from "../testing.ts";
import type { TimedWord } from "./captions.ts";
import type { Line } from "./pack.ts";
import { planSchema, planSystem } from "./prompt.ts";
import {
  type Asset,
  FULL_MAX,
  PANEL_MAX,
  type PlacedVisual,
  parseVisuals,
  placeVisuals,
  sourceVisuals,
  speakerClips,
  stillFraming,
  type VisualWish,
  visualKey,
  visualParts,
  visualPath,
  wishProblem,
} from "./visuals.ts";

const wish = (overrides: Partial<VisualWish>): VisualWish => ({
  source: "a",
  line: 1,
  text: "",
  kind: "web",
  query: "",
  url: "",
  focus: "",
  name: "",
  sfx: "none",
  reason: "",
  ...overrides,
});
const surya = wish({
  url: "https://huggingface.co/nasa-ibm-ai4science",
  focus: "Surya",
  name: "Hugging Face",
});
const said = "Surya 的模型放在 Hugging Face 上";
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
  // Motion graphics are written once the cut is known, not in the plan.
  assert.doesNotMatch(rich, /card/);
  assert.match(rich, /web: the real page of a product.*the speaker names in that line/s);
  assert.doesNotMatch(rich, /stock: real footage/);
  assert.match(planSystem({ ...extras, visuals: true, stock: true }), /stock: real footage/);
});

test("the plan's visuals are read from their JSON, each left out unless whole", () => {
  const problems: string[] = [];
  const good = {
    source: "a",
    line: 2,
    text: "Surya",
    kind: "web",
    url: "https://huggingface.co/nasa-ibm-ai4science",
    focus: "Surya",
    sfx: "click",
    reason: "r",
  };
  const read = parseVisuals(
    JSON.stringify([
      good,
      { ...good, line: "3" },
      { ...good, kind: "stock" },
      { ...good, sfx: "laser" },
      { ...good, kind: "card" },
      { source: "a", line: 4, text: "x", kind: "web", url: "https://example.com/" },
    ]),
    false,
    (problem) => problems.push(problem),
  );
  assert.deepEqual(read, [
    wish({
      line: 2,
      text: "Surya",
      url: "https://huggingface.co/nasa-ibm-ai4science",
      focus: "Surya",
      sfx: "click",
      reason: "r",
    }),
    wish({ line: 4, text: "x", kind: "web", url: "https://example.com/" }),
  ]);
  assert.equal(problems.length, 4);
  assert.deepEqual(
    parseVisuals(JSON.stringify([{ ...good, kind: "stock", query: "sun" }]), true).length,
    1,
  );
  assert.deepEqual(
    parseVisuals("[{", false, (problem) => problems.push(problem)),
    [],
  );
  assert.match(problems.at(-1) ?? "", /not JSON/);
  assert.deepEqual(parseVisuals("", false), []);
});

test("code checks each visual before sourcing it", () => {
  assert.equal(wishProblem(surya, false, said), null);
  // A page with no words on it to show would show its first screen: a home page or an ad.
  assert.match(wishProblem(wish({ url: surya.url }), false, said) ?? "", /no words on the page/);
  const web = (url: string) =>
    wishProblem(wish({ kind: "web", url, focus: "x", name: "Hugging Face" }), false, said);
  assert.equal(web("https://huggingface.co/nasa-ibm-ai4science"), null);
  assert.match(web("http://localhost:3000/") ?? "", /local/);
  assert.match(web("http://192.168.1.2/") ?? "", /local/);
  assert.match(web("file:///etc/passwd") ?? "", /http/);
  assert.match(web("not a page") ?? "", /Not a web address/);
  assert.match(web("https://www.google.com/search?q=surya") ?? "", /search page/);
  assert.match(wishProblem(wish({ kind: "stock", query: "the sun" }), false, said) ?? "", /key/);
  assert.equal(wishProblem(wish({ kind: "stock", query: "the sun" }), true, said), null);
});

test("a page is captured only when the speaker names its site or product", () => {
  const page = (url: string, name: string) => wish({ kind: "web", url, focus: "x", name });
  const starbucks = page("https://www.starbucks.com.tw/products/cold-foam", "星巴克");
  assert.equal(wishProblem(starbucks, false, "下班之後去星巴克喝咖啡"), null);
  assert.match(wishProblem(starbucks, false, "下班之後去喝咖啡") ?? "", /does not name/);
  // The address's own name, said, is enough: dcard in www.dcard.tw.
  assert.equal(
    wishProblem(page("https://www.dcard.tw/f/x", ""), false, "我們在 Dcard 上的故事"),
    null,
  );
  // Not a name heard wrong, nor one inside another word.
  const claude = page("https://www.anthropic.com/claude", "Claude");
  assert.match(wishProblem(claude, false, "這一步是交給 Claire 來決定的") ?? "", /does not name/);
  assert.match(
    wishProblem(page("https://x.com/home", "X"), false, "the next step") ?? "",
    /does not name/,
  );
});

test("a visual that cannot be sourced is left out and its line keeps the speaker", async (t) => {
  const dir = await scratch(t, "visuals-");
  const assets = new Map<string, Asset | null>();
  const problems: string[] = [];
  const page = wish({
    kind: "web",
    url: "https://example.com/",
    focus: "Example Domain",
    name: "Example",
    line: 2,
  });
  const broken = wish({ kind: "web", url: "https://example.org/", focus: "x", line: 3 });
  const footage = wish({ kind: "stock", query: "solar flare", line: 4 });
  const captured: { url: string; text?: string; viewport?: object }[] = [];
  await sourceVisuals([page, broken, footage, page], assets, {
    output: { aspect: "9:16", width: 1080, height: 1920 },
    stock: false,
    said: () => "the Example site",
    dir,
    onProblem: (message) => problems.push(message),
    capture: async (options) => {
      captured.push(options);
      if (options.url.includes("example.org")) throw new Error("timed out");
      await writeFile(options.out, "png");
      const focus = { x: 400, y: 300, width: 600, height: 80 };
      const credit = {
        what: "Screenshot of example.com",
        source: options.url,
        license: null,
        by: null,
      };
      return {
        path: options.out,
        kind: "still",
        width: 2200,
        height: 1792,
        focus,
        credit,
      } satisfies Capture;
    },
  });
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
    said: () => "the Example site",
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
      words.push({
        source: "a",
        index: words.length,
        text: `w${words.length}`,
        start,
        end: start + 0.5 * SECOND,
      });
    }
    list.push({ source: "a", n, first, last: words.length - 1 });
  }
  return {
    words,
    lines: (_: string, n: number) => list.find((line) => line.n === n),
    sourceWords: () =>
      words.map((w) => ({ text: w.text, start: w.start / SECOND, end: w.end / SECOND })),
  };
}

test("visuals land on their words, a creator's pace apart, clear of what they may not cover", () => {
  const talk = speech(20);
  const assets = new Map<string, Asset | null>();
  const image: Asset = {
    kind: "image",
    path: "/p.png",
    width: 2200,
    height: 1792,
    focus: null,
    credit: { what: "x", source: "https://x.com", license: null, by: null },
  };
  const sun = { kind: "video", path: "/sun.mp4", seconds: 3, id: "pexels:1", credit: image.credit };
  const clip = (line: number, text = "") => wish({ kind: "stock", query: "the sun", line, text });
  const web = (line: number) => wish({ kind: "web", url: "https://x.com/", line });
  assets.set(visualKey(clip(0)), sun as Asset);
  assets.set(visualKey(web(0)), image);
  const context = { ...talk, edit: 40 * SECOND, frame: SECOND / 30, aspect: "9:16" as const };
  const placed = placeVisuals(
    [
      clip(1, "w1"),
      // Too close after the first: left out.
      clip(2),
      web(4),
      // Starts inside a name: left out.
      clip(8),
      clip(12),
      clip(14),
      clip(16),
      clip(18),
    ],
    assets,
    { ...context, blocked: [{ start: 14 * SECOND, end: 17 * SECOND }] },
  );
  const at = (v: PlacedVisual) => [v.wish.line, v.start / SECOND, v.end / SECOND, v.layout];
  // On w1, said at 0.6 s, 3 s of footage runs on over the next line's words.
  assert.deepEqual(at(placed[0] as PlacedVisual), [1, 0.6, 3.6, "full"]);
  // A capture splits the screen for its 4 s.
  assert.deepEqual(at(placed[1] as PlacedVisual), [4, 6, 10, "panel"]);
  assert.deepEqual(
    placed.map((v) => v.wish.line),
    [1, 4, 12, 14, 16, 18],
  );
  // At most one every 5 s of the edit.
  const few = placeVisuals([clip(1), clip(5), clip(9), clip(13)], assets, {
    ...context,
    edit: 10 * SECOND,
  });
  assert.equal(few.length, 2);
  // Under a name, it waits for the name to end while its line is said.
  const waits = placeVisuals([clip(1, "w1")], assets, {
    ...context,
    blocked: [{ start: 0.5 * SECOND, end: 0.8 * SECOND }],
  });
  assert.deepEqual(waits.map(at), [[1, 0.8, 3.8, "full"]]);
  // Ends where something it may not cover starts.
  const cut = placeVisuals([clip(1)], assets, {
    ...context,
    blocked: [{ start: 1.9 * SECOND, end: 5 * SECOND }],
  });
  const why: string[] = [];
  placeVisuals([clip(1)], assets, {
    ...context,
    blocked: [{ start: 0, end: 5 * SECOND }],
    onLeftOut: (_, reason) => why.push(reason),
  });
  assert.deepEqual(why, ["it would start under a title, chapter or name"]);
  assert.equal((cut[0]?.end ?? 0) / SECOND, 1.9);
  // Footage fills the frame, for at most 3.5 s.
  const footage = wish({ kind: "stock", query: "the sun", line: 6 });
  assets.set(visualKey(footage), {
    kind: "video",
    path: "/sun.mp4",
    seconds: 12,
    id: "pexels:1",
    credit: image.credit,
  });
  const [long] = placeVisuals([footage], assets, context);
  assert.deepEqual(long && at(long), [6, 10, 13.5, "full"]);
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
  const panel = { layout: "panel" } as const;
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

test("placed visuals become B-roll with credits and an occasional sound", async (t) => {
  const dir = await scratch(t, "visual-parts-");
  const still = join(dir, "page.png");
  await writeFile(still, "png");
  const credit = { what: "Screenshot of x.com", source: "https://x.com/", license: null, by: null };
  const image: Asset = {
    kind: "image",
    path: still,
    width: 2200,
    height: 1792,
    focus: null,
    credit,
  };
  const footage = join(dir, "sun.mp4");
  await writeFile(footage, "mp4");
  const sun: Asset = { kind: "video", path: footage, seconds: 4, id: "pexels:1", credit };
  const output = { aspect: "9:16" as const, width: 1080, height: 1920 };
  const at = (
    start: number,
    end: number,
    asset: Asset,
    layout: "full" | "panel",
    sfx: VisualWish["sfx"],
  ) => ({ wish: wish({ sfx }), asset, start: start * SECOND, end: end * SECOND, layout });
  const parts = await visualParts(
    [
      at(0, 2, sun, "full", "tap"),
      at(3, 6, image, "panel", "click"),
      at(7, 9, sun, "full", "tap"),
      at(10, 12, image, "panel", "none"),
    ],
    output,
    (file) => visualPath(dir, file),
  );
  // One still, shown twice, is one source; in the panel, pushed in. The footage fills the frame.
  assert.equal(parts.broll.length, 4);
  assert.deepEqual(new Set(parts.broll.map((b) => b.source)).size, 2);
  assert.deepEqual(parts.broll[1]?.rect, { x: 0, y: 0, w: 1, h: panelShare("9:16") });
  assert.equal(parts.broll[0]?.rect, undefined);
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
    audio: { ...main.audio, sfx: parts.sfx },
  });
});

test("a visual on another drive than the project is copied beside it, so its path stays relative", async (t) => {
  const dir = await scratch(t, "visual-path-");
  const asset = join(dir, "cache", "tap.ogg");
  const out = join(dir, "out");
  await mkdir(join(dir, "cache"), { recursive: true });
  await writeFile(asset, "sound");
  assert.equal(await visualPath(out, asset), "../cache/tap.ogg");
  // On Windows, relative() between drives gives back an absolute path.
  const otherDrive = (_from: string, to: string) => to;
  const copied = await visualPath(out, asset, otherDrive);
  assert.match(copied, /^visuals\/[0-9a-f]{8}-tap\.ogg$/);
  assert.equal(await readFile(join(out, copied), "utf8"), "sound");
  assert.equal(await visualPath(out, asset, otherDrive), copied);
});
