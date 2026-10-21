import assert from "node:assert/strict";
import { test } from "node:test";
import { type CaptionLine, type Project, ticksPerFrame } from "@video-editor/schema";
import { project, SECOND } from "../testing.ts";
import { emojiImage } from "./emoji.ts";
import { buildCaptions, type CaptionBrand, type CaptionStyle, PRESETS } from "./index.ts";

test("the pinned emoji font has an image of each single emoji, and of nothing else", async () => {
  const fire = await emojiImage("🔥");
  assert.ok(fire);
  assert.deepEqual(fire.png.subarray(0, 8), Buffer.from("89504e470d0a1a0a", "hex"), "a PNG");
  assert.equal(fire.ppem, 109);
  assert.ok(fire.width > 100 && fire.height > 100 && fire.top > 0);
  // With the emoji presentation selector or without it, the same image.
  assert.deepEqual((await emojiImage("❤️"))?.png, (await emojiImage("❤"))?.png);
  for (const other of ["👍🏽", "🇹🇼", "👨‍💻", "🔥🔥", "A", "中", ""]) {
    assert.equal(await emojiImage(other), undefined, other);
  }
});

const LINES: CaptionLine[] = [
  line(
    ["今天", "我們", "來", "聊", "一下", "怎麼", "把", "影片", "剪得", "更", "好看", "一點"],
    0,
    "🎬",
  ),
  line(["沒有", "表情"], 4),
  line(["Money", "talks", "loudly"], 6, "💰", "en"),
];

/** A caption line said at four words a second from `start`, with an emoji or not. */
function line(words: string[], start: number, emoji?: string, language = "zh-TW"): CaptionLine {
  return {
    start: Math.round(start * SECOND),
    end: Math.round((start + words.length / 4) * SECOND),
    language,
    text: words.join(language === "en" ? " " : ""),
    ...(emoji ? { emoji } : {}),
    words: words.map((text, i) => ({
      text,
      start: Math.round((start + i / 4) * SECOND),
      end: Math.round((start + (i + 0.8) / 4) * SECOND),
    })),
  };
}

async function built(
  preset: CaptionStyle,
  emoji: boolean,
  output: Partial<Project["output"]>,
  brand?: CaptionBrand,
) {
  const edit = project([{ source: "a", in: 0, out: 10 * SECOND }], {
    captions: { preset, srt: true, ...(emoji ? { emoji } : {}), lines: LINES },
  });
  edit.output = { ...edit.output, ...output };
  const frameTicks = ticksPerFrame(edit.output.fps);
  const timeline = {
    main: [],
    broll: [],
    frames: Math.ceil((10 * SECOND) / frameTicks),
    frameTicks,
  };
  const files = await buildCaptions(edit, timeline, brand);
  assert.ok(files);
  return files;
}

test("a line's emoji ends its last caption, from its last word, inside the frame", async () => {
  // A kit's custom captions, large in a box on one row, set smaller where a row is too wide.
  const kit: CaptionBrand = {
    colors: { primary: "#2f6bff" },
    custom: {
      style: "creator",
      size: "L",
      text: "#ffffff",
      highlight: "#2f6bff",
      frame: "box",
      position: "top",
      lines: 1,
    },
  };
  for (const [aspect, width, height] of [
    ["9:16", 1080, 1920],
    ["16:9", 1920, 1080],
  ] as const) {
    for (const preset of [...(Object.keys(PRESETS) as (keyof typeof PRESETS)[]), "kit"] as const) {
      const at = `${preset} at ${aspect}`;
      const files =
        preset === "kit"
          ? await built("bold", true, { aspect, width, height }, kit)
          : await built(preset, true, { aspect, width, height });
      assert.deepEqual(
        files.emoji.map((each) => each.emoji),
        ["🎬", "💰"],
        at,
      );
      for (const event of files.emoji) {
        const line = LINES.findIndex((each) => each.emoji === event.emoji);
        const last = files.pages.findLast((page) => page.line === line);
        assert.ok(last, at);
        assert.equal(event.start, last.words.at(-1)?.start, `${at}: from its last word`);
        assert.equal(event.end, last.end, `${at}: until its caption leaves`);
        assert.ok(event.x > width / 2 && event.x + event.width <= width, `${at}: at the end`);
        assert.ok(event.y >= 0 && event.y + event.height <= height, at);
      }
      const cues = files.srt.split("\n\n");
      assert.ok(cues.some((cue) => cue.endsWith(" 🎬")) && cues.at(-1)?.endsWith(" 💰\n"), at);
      assert.equal(files.srt.match(/🎬|💰/gu)?.length, 2, `${at}: once each`);
    }
  }
});

test("with emoji off, or no style drawn, nothing is drawn; the SubRip copy follows the switch", async () => {
  const off = await built("bold", false, {});
  assert.deepEqual(off.emoji, []);
  assert.doesNotMatch(off.srt, /🎬|💰/u);
  const none = await built("none", true, {});
  assert.deepEqual(none.emoji, []);
  assert.match(none.srt, /🎬/u);
});
