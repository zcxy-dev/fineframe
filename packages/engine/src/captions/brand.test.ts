import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { BrandCaptions, CaptionLine, Project } from "@video-editor/schema";
import { ticksPerFrame } from "@video-editor/schema";
import { faceFile } from "../brand/kit.ts";
import { project, SECOND } from "../testing.ts";
import type { TimelineGraphic } from "../timeline.ts";
import { readFace } from "./fonts.ts";
import { buildCaptions, type CaptionBrand } from "./index.ts";
import { brandPreset, PRESETS } from "./presets.ts";

const BLUE = { primary: "#2f6bff" };
const CUSTOM: BrandCaptions = {
  style: "bold",
  size: "M",
  text: "#ffffff",
  highlight: "#00ff88",
  frame: "outline",
  position: "bottom",
  lines: 2,
};

/** One caption line of `text`, a character a word, a quarter second each, from 0.5 s. */
function line(text: string): CaptionLine {
  const chars = [...text];
  return {
    start: SECOND / 2,
    end: SECOND / 2 + (chars.length * SECOND) / 4,
    language: "zh-TW",
    text,
    words: chars.map((char, i) => ({
      text: char,
      start: SECOND / 2 + (i * SECOND) / 4,
      end: SECOND / 2 + ((i + 0.8) * SECOND) / 4,
    })),
  };
}

async function captions(text: string, brand?: CaptionBrand, graphics: TimelineGraphic[] = []) {
  const edit: Project = project([{ source: "a", in: 0, out: 6 * SECOND }], {
    captions: { preset: "bold", srt: true, lines: [line(text)] },
  });
  edit.output = { ...edit.output, aspect: "9:16", width: 1080, height: 1920 };
  const frameTicks = ticksPerFrame(edit.output.fps);
  const timeline = { main: [], broll: [], graphics, frames: 180, frameTicks };
  const files = await buildCaptions(edit, timeline, brand);
  assert.ok(files?.ass);
  return files;
}

/** The face layer's rows' centres, top to bottom, of each event in an ASS script. */
const centres = (ass: string) =>
  [...ass.matchAll(/^Dialogue: 2,.*\\pos\([\d.]+,([\d.]+)\)/gm)].map((m) => Number(m[1]));

test("a kit's primary lights the word said and the keywords, white where it would not read", () => {
  assert.equal(brandPreset("bold", BLUE, undefined).active, "#2f6bff");
  assert.equal(brandPreset("creator", BLUE, undefined).keyword, "#2f6bff");
  assert.deepEqual(brandPreset("minimal", BLUE, undefined), PRESETS.minimal);
  // Navy on the dark stroke would vanish.
  assert.equal(brandPreset("bold", { primary: "#14213d" }, undefined).active, "#ffffff");
});

test("custom captions take their style's motion, with their size, colours, and outline or box", () => {
  const large = brandPreset("bold", BLUE, {
    ...CUSTOM,
    style: "creator",
    size: "L",
    text: "#111111",
  });
  assert.equal(large.scale, PRESETS.creator.scale * 1.25);
  assert.equal(large.chunk, PRESETS.creator.chunk);
  assert.ok(large.stroke && !large.plate, "outlined, out of its box");
  // Dark text on the dark outline turns white; creator lights its keywords, not the word said.
  assert.equal(large.text, "#ffffff");
  assert.equal(large.keyword, "#00ff88");
  assert.equal(large.active, large.text);
  const boxed = brandPreset("bold", BLUE, { ...CUSTOM, frame: "box" });
  assert.ok(boxed.plate && !boxed.stroke && !boxed.shadow);
  assert.equal(boxed.active, "#00ff88");
  assert.equal(brandPreset("bold", BLUE, { ...CUSTOM, style: "pop" }).wordPop, PRESETS.pop.wordPop);
});

test("custom captions rest at the top, the middle or the bottom, in the rows asked", async () => {
  const text = "今天要來聊一下怎麼用自動剪片做出好看的影片";
  const at = async (position: BrandCaptions["position"], lines: 1 | 2) => {
    const files = await captions(text, { colors: BLUE, custom: { ...CUSTOM, position, lines } });
    return {
      rows: Math.max(...files.pages.map((page) => page.rows.length)),
      y: centres(files.ass ?? ""),
    };
  };
  const top = await at("top", 2);
  const middle = await at("middle", 2);
  const bottom = await at("bottom", 2);
  assert.ok(Math.max(...top.y) < 0.3 * 1920, `top: ${top.y}`);
  assert.ok(Math.min(...middle.y) > 0.4 * 1920 && Math.max(...middle.y) < 0.6 * 1920);
  assert.ok(Math.min(...bottom.y) > 0.6 * 1920);
  assert.equal(bottom.rows, 2);
  assert.equal((await at("bottom", 1)).rows, 1);
});

test("a character the kit's face lacks is drawn in the house face, at the same em", async () => {
  const path = (await faceFile("jf-openhuninn")) as string;
  const face = { path, ...readFace(await readFile(path)) };
  // The face has 粉 and 圓 but not 偯.
  assert.equal(face.metrics.advance("偯".codePointAt(0) as number), undefined);
  const files = await captions("粉圓偯好", { colors: BLUE, face });
  const ass = files.ass ?? "";
  assert.match(ass, new RegExp(`Style: Caption,${face.family},[\\d.]+,(?:[^,]*,){4}0,`));
  assert.match(
    ass,
    /\{\\fnNoto Sans CJK TC Black\\b1\\fs[\d.]+\}偯\{\\fnjf-openhuninn-2\.1\\b0\\fs[\d.]+\}/,
  );
  assert.equal(files.fonts[0], path);
  assert.equal(files.fonts.length, 2);
});

test("custom captions keep clear of a label the house captions never meet", async () => {
  const label: TimelineGraphic = {
    index: 0,
    graphic: {
      layout: "label",
      html: "<b>27</b>",
      css: "",
      box: { x: 0.1, y: 0.6, w: 0.8, h: 0.13 },
      start: 0,
      duration: 6 * SECOND,
    },
    start: 0,
    end: 180,
  };
  const text = "大家好今天要來聊";
  const house = centres((await captions(text, { colors: BLUE }, [label])).ass ?? "");
  const custom = centres(
    (await captions(text, { colors: BLUE, custom: CUSTOM }, [label])).ass ?? "",
  );
  // The label covers 1152 to 1402; the house captions stay where they rest over it.
  assert.ok(
    house.every((y) => y > 1152 && y < 1402),
    `house: ${house}`,
  );
  assert.ok(
    custom.every((y) => y < 1152 || y > 1402),
    `custom: ${custom}`,
  );
});
