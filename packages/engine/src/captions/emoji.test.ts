import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type CaptionLine,
  type FaceFraming,
  type Project,
  ticksPerFrame,
} from "@video-editor/schema";
import { facts, project, SECOND, sources } from "../testing.ts";
import { buildTimeline } from "../timeline.ts";
import { emojiImage } from "./emoji.ts";
import {
  buildCaptions,
  type CaptionBrand,
  type CaptionStyle,
  captionAreas,
  PRESETS,
} from "./index.ts";

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

/** A box's overlap with another, in square pixels. */
function overlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return Math.max(0, w) * Math.max(0, h);
}

test("a caption beside a face moves clear of it when its emoji would cover the face", async () => {
  // One face low and right of centre in a 16:9 picture, still for 10 s: right of where a
  // seven-character caption ends, left of where its emoji ends.
  const box = { x: 0.65, y: 0.72, w: 0.1, h: 0.2 };
  const framing: FaceFraming = {
    fps: 2,
    shots: [
      {
        start: 0,
        end: 10,
        layout: "talking_head",
        faces: [
          {
            id: 0,
            boxes: [
              { t: 0, ...box },
              ...Array.from({ length: 19 }, (_, i) => ({ t: (i + 1) / 2, ...box })),
            ],
          },
        ],
        speakers: [],
      },
    ],
  };
  const face = { x: 0.65 * 1280, y: 0.72 * 720, width: 0.1 * 1280, height: 0.2 * 720 };
  const caption = async (emoji: boolean) => {
    const edit = project([{ source: "a", in: 0, out: 3 * SECOND }], {
      captions: {
        preset: "bold",
        srt: false,
        ...(emoji ? { emoji } : {}),
        lines: [line(["字幕", "不會", "蓋住", "臉"], 0, "🔥")],
      },
    });
    const faces = { framing, aspect: 16 / 9 };
    const files = await buildCaptions(edit, buildTimeline(edit, sources(facts("a", { faces }))));
    assert.ok(files?.ass);
    const event = files.ass.split("\n").find((each) => each.startsWith("Dialogue: 2,"));
    return { files, y: Number(/\\pos\([\d.]+,([\d.]+)\)/.exec(event ?? "")?.[1]) };
  };
  // The text alone stays at its place, its row at the face's height, beside it.
  const off = await caption(false);
  assert.ok(off.y > face.y, `text at ${off.y}`);
  const on = await caption(true);
  const [emoji] = on.files.emoji;
  assert.ok(emoji);
  assert.equal(overlap(emoji, face), 0, `the emoji at ${emoji.x},${emoji.y} covers the face`);
  assert.ok(on.y < face.y, `moved to ${on.y}`);
});

test("graphics keep off a line's emoji in every style, whether the switch is on or not", async () => {
  for (const [aspect, width, height] of [
    ["9:16", 1080, 1920],
    ["16:9", 1920, 1080],
  ] as const) {
    const edit = project([{ source: "a", in: 0, out: 10 * SECOND }], {
      captions: { preset: "bold", srt: true, lines: LINES },
    });
    edit.output = { ...edit.output, aspect, width, height };
    const frameTicks = ticksPerFrame(edit.output.fps);
    const frames = Math.ceil((10 * SECOND) / frameTicks);
    const areas = await captionAreas(edit, { main: [], broll: [], frames, frameTicks });
    for (const preset of Object.keys(PRESETS) as (keyof typeof PRESETS)[]) {
      const { emoji } = await built(preset, true, { aspect, width, height });
      assert.equal(emoji.length, 2);
      for (const event of emoji) {
        for (let frame = event.start; frame < event.end; frame++) {
          const inside = areas.some(
            (area) =>
              area.start <= frame &&
              frame < area.end &&
              event.x >= area.x &&
              event.x + event.width <= area.x + area.width &&
              event.y >= area.y &&
              event.y + event.height <= area.y + area.height,
          );
          assert.ok(inside, `${preset} at ${aspect}: ${event.emoji} on frame ${frame}`);
        }
      }
    }
  }
});
