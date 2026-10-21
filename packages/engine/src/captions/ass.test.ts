import assert from "node:assert/strict";
import { test } from "node:test";
import { type CaptionLine, type Project, ticksPerFrame } from "@video-editor/schema";
import { subtitled } from "../plan/captions.ts";
import { project, SECOND } from "../testing.ts";
import { assTime } from "./ass.ts";
import { buildCaptions, type CaptionStyle, captionAreas, PRESETS } from "./index.ts";
import { type Page, rowText } from "./layout.ts";

/** Centiseconds of an ASS time. */
function centiseconds(time: string): number {
  const [h, m, s] = time.split(":").map(Number) as [number, number, number];
  return Math.round((h * 3600 + m * 60 + s) * 100);
}

/** The time FFmpeg's subtitle filter hands libass for output frame n, in ms: the frame's
 * timestamp times the time base in floating point, cut to a whole number. */
function libassTime(n: number, fps: { num: number; den: number }): number {
  return Math.trunc(n * (fps.den / fps.num) * 1000);
}

test("an event placed on a frame shows from exactly that frame, at every common rate", () => {
  for (const fps of [
    { num: 24000, den: 1001 },
    { num: 24, den: 1 },
    { num: 25, den: 1 },
    { num: 30000, den: 1001 },
    { num: 30, den: 1 },
    { num: 50, den: 1 },
    { num: 60000, den: 1001 },
    { num: 60, den: 1 },
  ]) {
    const frameTicks = ticksPerFrame(fps);
    // Ten minutes of frames: libass shows an event at t when start <= t.
    for (let n = 1; n < (600 * fps.num) / fps.den; n++) {
      const start = 10 * centiseconds(assTime(n, frameTicks));
      const at = `${fps.num}/${fps.den} fps, frame ${n}`;
      assert.ok(start <= libassTime(n, fps), `${at} starts after it`);
      assert.ok(start > libassTime(n - 1, fps), `${at} also shows on the frame before`);
    }
  }
  // At 30 fps frame 111 starts at 3700 ms, which reaches libass as 3699.
  assert.equal(assTime(111, 4000), "0:00:03.69");
  assert.equal(assTime(0, 4000), "0:00:00.00");
  assert.equal(assTime(30 * 3725, 4000), "1:02:04.99");
});

/** A caption line said at four words a second from `start`, punctuated as the planner writes it. */
function said(words: string[], start: number, language = "zh-TW"): CaptionLine {
  const shown = language === "zh-TW" ? subtitled(words) : { text: words.join(" "), words };
  const timed = words.map((_, i) => ({
    text: shown.words[i] as string,
    start: Math.round((start + i / 4) * SECOND),
    end: Math.round((start + (i + 0.8) / 4) * SECOND),
  }));
  return {
    start: Math.round(start * SECOND),
    end: Math.round((start + words.length / 4) * SECOND),
    language,
    text: shown.text,
    words: timed.filter((word) => word.text),
  };
}

const LINES = [
  said([..."大家好，今天要來聊一下怎麼用", "AI", ..."自動剪片。"], 0.5),
  said(
    [
      ..."其實這個",
      "workflow",
      ..."很簡單，你只要把素材丟進去，選好長度跟比例，按下",
      "start",
      ..."就好了！",
    ],
    6,
  ),
  said(["English", "words", "stay", "in", "English."], 17, "en"),
  said([..."他說「真的嗎？」我說……對啊。"], 19.5),
];

/** What a caption shows on each frame: from an ASS script, the face layer's rows top to bottom
 * (a row's words left to right, where each word is its own event) with every override tag
 * removed; from SubRip, the cue's lines. */
function framesOfAss(ass: string, fps: Project["output"]["fps"], frames: number): string[] {
  const events = ass
    .split("\n")
    .filter((line) => line.startsWith("Dialogue: 2,"))
    .map((line) => {
      const [, start, end, , , , , , , ...rest] = line.slice("Dialogue: ".length).split(",");
      const text = rest.join(",");
      const [, x, y] = /\\pos\(([\d.]+),([\d.]+)\)/.exec(text) ?? [];
      return {
        start: 10 * centiseconds(start as string),
        end: 10 * centiseconds(end as string),
        x: Number(x),
        y: Number(y),
        text: text.replace(/\{[^}]*\}/g, ""),
      };
    });
  return Array.from({ length: frames }, (_, n) => {
    const t = libassTime(n, fps);
    const shown = events
      .filter((event) => event.start <= t && t < event.end)
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const rows: string[][] = [];
    shown.forEach((event, i) => {
      if (i === 0 || event.y !== shown[i - 1]?.y) rows.push([]);
      rows.at(-1)?.push(event.text);
    });
    return rows.map((row) => row.join(" ")).join("\n");
  });
}

function framesOfSrt(srt: string, fps: Project["output"]["fps"], frames: number): string[] {
  const ms = (time: string) => {
    const [h, m, rest] = time.split(":") as [string, string, string];
    const [s, milli] = rest.split(",").map(Number) as [number, number];
    return Number(h) * 3_600_000 + Number(m) * 60_000 + s * 1000 + milli;
  };
  const cues = srt
    .trim()
    .split("\n\n")
    .map((cue) => {
      const [, times, ...text] = cue.split("\n");
      const [start, end] = (times as string).split(" --> ").map(ms) as [number, number];
      return { start, end, text: text.join("\n") };
    });
  return Array.from({ length: frames }, (_, n) => {
    const t = (n * 1000 * fps.den) / fps.num;
    return cues.find((cue) => cue.start <= t && t < cue.end)?.text ?? "";
  });
}

const DRAWN = Object.keys(PRESETS) as (keyof typeof PRESETS)[];

/** The captions of `lines` in `preset`, at an aspect and frame rate, over `seconds`. */
async function built(
  preset: CaptionStyle,
  lines: CaptionLine[],
  seconds: number,
  output: Partial<Project["output"]> = {},
) {
  const edit = project([{ source: "a", in: 0, out: seconds * SECOND }], {
    captions: { preset, srt: true, lines },
  });
  edit.output = { ...edit.output, aspect: "9:16", width: 1080, height: 1920, ...output };
  const { fps } = edit.output;
  const frames = Math.ceil((seconds * fps.num) / fps.den);
  const timeline = { main: [], broll: [], frames, frameTicks: ticksPerFrame(fps) };
  const files = await buildCaptions(edit, timeline);
  assert.ok(files);
  return { files, fps, frames, timeline };
}

const bare = (text: string) => text.replace(/[\s　]/g, "");

test("the SubRip export shows on every frame exactly the text burned in, in every style", async () => {
  for (const [aspect, width, height] of [
    ["9:16", 1080, 1920],
    ["1:1", 1080, 1080],
    ["16:9", 1920, 1080],
  ] as const) {
    for (const fps of [
      { num: 30, den: 1 },
      { num: 30000, den: 1001 },
    ]) {
      for (const preset of DRAWN) {
        const { files, frames } = await built(preset, LINES, 25, { aspect, width, height, fps });
        assert.ok(files.ass);
        const burned = framesOfAss(files.ass, fps, frames);
        const exported = framesOfSrt(files.srt, fps, frames);
        const at = `${preset} at ${aspect}, ${fps.num}/${fps.den} fps`;
        for (let n = 0; n < frames; n++) {
          if (PRESETS[preset].wordPop) {
            // Words appear as they are said: the picture shows the start of the cue, the
            // whole of it by its last frame.
            const cue = bare(exported[n] as string);
            assert.ok(cue.startsWith(bare(burned[n] as string)), `${at}, frame ${n}`);
            if (exported[n + 1] !== exported[n]) assert.equal(bare(burned[n] as string), cue);
          } else {
            assert.equal(burned[n], exported[n], `${at}, frame ${n}`);
          }
        }
        // Every word is shown, in order, as said.
        const all = exported.filter((text, n) => text && text !== exported[n - 1]).join("");
        const words = LINES.flatMap((line) => line.words?.map((word) => word.text) ?? []);
        assert.equal(
          all.replace(/[\s　「」？！…]/g, ""),
          words.join("").replace(/[「」？！…]/g, ""),
          at,
        );
      }
    }
  }
});

test("with no captions on the picture, the SubRip file is the one bold writes", async () => {
  const none = await built("none", LINES, 25);
  const bold = await built("bold", LINES, 25);
  assert.equal(none.files.ass, null);
  assert.deepEqual(none.files.fonts, []);
  assert.equal(none.files.srt, bold.files.srt);
});

test("creator shows a few words at a time, in a box, with numbers and English words in amber", async () => {
  const lines = [
    said([..."我今年二十七歲", "workflow", ..."其實很簡單"], 0.5),
    said(["I", "want", "to", "focus", "on", "this", "one", "thing", "today."], 6, "en"),
  ];
  const { files } = await built("creator", lines, 10);
  assert.ok(files.ass);
  for (const page of files.pages) {
    assert.equal(page.rows.length, 1);
    const text = rowText(page.rows[0] as Page["rows"][number]);
    assert.ok((text.match(/[A-Za-z]+/g)?.length ?? 0) <= 3, text);
    assert.ok((text.match(/\p{Script=Han}/gu)?.length ?? 0) <= 6, text);
  }
  const rows = files.pages.map((page) => rowText(page.rows[0] as Page["rows"][number]));
  assert.ok(
    rows.some((row) => row.includes("二十七")),
    rows.join(" | "),
  );
  // A box behind each caption, and amber exactly on the keywords.
  assert.equal(
    files.ass.split("\n").filter((line) => line.startsWith("Dialogue: 0,")).length,
    files.pages.length,
  );
  const amber = files.ass
    .split("\n")
    .filter((line) => line.startsWith("Dialogue: 2,"))
    .flatMap((line) => [...line.matchAll(/\\1c&H33C2FF&[^}]*\}([^{]*)/g)].map((m) => m[1]));
  assert.equal([...new Set(amber)].join(""), "二十七workflow");
});

test("pop draws each word from the frame it is said, where the finished row puts it", async () => {
  const lines = [said([..."會害怕", "becoming", "thirty", "嗎？"], 0.5)];
  const { files, timeline } = await built("pop", lines, 4);
  assert.ok(files.ass);
  const faces = files.ass.split("\n").filter((line) => line.startsWith("Dialogue: 2,"));
  const page = files.pages[0] as Page;
  assert.equal(faces.length, page.words.length);
  for (const [i, face] of faces.entries()) {
    const start = assTime((page.words[i] as Page["words"][number]).start, timeline.frameTicks);
    assert.ok(face.startsWith(`Dialogue: 2,${start},`), face);
    assert.match(face, /\\fscx125\\fscy125\\t\(0,140,/);
  }
  // Left to right along a row, words never overlapping once settled.
  const xs = faces.map((face) => Number(/\\pos\(([\d.]+),/.exec(face)?.[1]));
  const ys = faces.map((face) => Number(/\\pos\([\d.]+,([\d.]+)\)/.exec(face)?.[1]));
  for (let i = 1; i < faces.length; i++) {
    if (ys[i] === ys[i - 1]) assert.ok((xs[i] as number) > (xs[i - 1] as number), faces[i]);
  }
  assert.deepEqual(
    faces.map((face) =>
      face
        .replace(/\{[^}]*\}/g, "")
        .split(",")
        .at(-1),
    ),
    ["會", "害", "怕", "becoming", "thirty", "嗎？"],
  );
});

test("a caption fades in after a pause, and one that replaces another shows at full strength", async () => {
  const lines = [
    said([..."今天要來聊一下怎麼用", "AI", ..."自動剪片你只要把素材丟進去就好了"], 0.5),
    said([..."謝謝收看"], 12),
  ];
  for (const preset of DRAWN) {
    const { files, timeline } = await built(preset, lines, 15);
    assert.ok(files.ass && files.pages.length >= 3, `${preset}: ${files.pages.length} pages`);
    const ass = files.ass;
    // The opacity at the first frame of each page, from the face layer's first event there.
    const fadeIns = files.pages.map((page) => {
      const start = assTime(page.start, timeline.frameTicks);
      const event = ass.split("\n").find((line) => line.startsWith(`Dialogue: 2,${start},`));
      const fade = /\\fade\(255,0,255,(-?[\d.]+),(-?[\d.]+),/.exec(event ?? "");
      return fade ? Number(fade[2]) > Number(fade[1]) : false;
    });
    const afterPause = files.pages.map(
      (page, i) => i === 0 || (files.pages[i - 1] as { end: number }).end < page.start,
    );
    assert.deepEqual(fadeIns, afterPause, preset);
  }
});

test("a line without word timings shows at full strength in every style", async () => {
  const line = { start: SECOND, end: 3 * SECOND, language: "zh-TW", text: "謝謝收看" };
  for (const preset of DRAWN) {
    const { files } = await built(preset, [line], 5);
    const faces = files.ass?.split("\n").filter((event) => event.startsWith("Dialogue: 2,")) ?? [];
    assert.ok(faces.length > 0, preset);
    for (const face of faces) {
      assert.doesNotMatch(face, /\\alpha&H(?!00&)/, preset);
    }
  }
});

test("graphics keep off where the captions of any style are drawn", async () => {
  for (const [aspect, width, height] of [
    ["9:16", 1080, 1920],
    ["16:9", 1920, 1080],
  ] as const) {
    const { timeline } = await built("bold", LINES, 25, { aspect, width, height });
    const edit = project([{ source: "a", in: 0, out: 25 * SECOND }], {
      captions: { preset: "bold", srt: true, lines: LINES },
    });
    edit.output = { ...edit.output, aspect, width, height };
    const areas = await captionAreas(edit, timeline);
    assert.ok(areas.length > 0);
    for (const preset of DRAWN) {
      const { files } = await built(preset, LINES, 25, { aspect, width, height });
      for (const line of files.ass?.split("\n") ?? []) {
        if (!line.startsWith("Dialogue: 2,")) continue;
        const [, start] = line.split(",");
        const t = 10 * centiseconds(start as string);
        const [, x, y] = /\\pos\(([\d.]+),([\d.]+)\)/.exec(line) ?? [];
        const frame = Math.ceil((t * 120) / timeline.frameTicks);
        const inside = areas.some(
          (area) =>
            area.start <= frame &&
            frame < area.end &&
            Number(x) >= area.x &&
            Number(x) <= area.x + area.width &&
            Number(y) >= area.y &&
            Number(y) <= area.y + area.height,
        );
        assert.ok(inside, `${preset} at ${aspect}: ${line.slice(0, 60)}`);
      }
    }
  }
});
