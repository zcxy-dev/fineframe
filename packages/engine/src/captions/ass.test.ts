import assert from "node:assert/strict";
import { test } from "node:test";
import { type CaptionLine, type Project, ticksPerFrame } from "@video-editor/schema";
import { subtitled } from "../plan/captions.ts";
import { project, SECOND } from "../testing.ts";
import { assTime } from "./ass.ts";
import { buildCaptions, PRESETS } from "./index.ts";

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
 * with every override tag removed; from SubRip, the cue's lines. */
function framesOfAss(ass: string, fps: Project["output"]["fps"], frames: number): string[] {
  const events = ass
    .split("\n")
    .filter((line) => line.startsWith("Dialogue: 4,"))
    .map((line) => {
      const [, start, end, , , , , , , ...rest] = line.slice("Dialogue: ".length).split(",");
      const text = rest.join(",");
      const y = Number(/\\pos\([\d.]+,([\d.]+)\)/.exec(text)?.[1]);
      return {
        start: 10 * centiseconds(start as string),
        end: 10 * centiseconds(end as string),
        y,
        text: text.replace(/\{[^}]*\}/g, ""),
      };
    });
  return Array.from({ length: frames }, (_, n) => {
    const t = libassTime(n, fps);
    const rows = events.filter((event) => event.start <= t && t < event.end);
    return rows
      .sort((a, b) => a.y - b.y)
      .map((row) => row.text)
      .join("\n");
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

test("the SubRip export shows on every frame exactly the text burned in, for every preset", async () => {
  for (const [aspect, width, height] of [
    ["9:16", 1080, 1920],
    ["1:1", 1080, 1080],
    ["16:9", 1920, 1080],
  ] as const) {
    for (const fps of [
      { num: 30, den: 1 },
      { num: 30000, den: 1001 },
    ]) {
      for (const preset of Object.keys(PRESETS)) {
        const edit = project([{ source: "a", in: 0, out: 25 * SECOND }], {
          captions: { preset, srt: true, lines: LINES },
        });
        edit.output = { ...edit.output, aspect, width, height, fps };
        const frames = Math.ceil((25 * fps.num) / fps.den);
        const timeline = { main: [], broll: [], frames, frameTicks: ticksPerFrame(fps) };
        const built = await buildCaptions(edit, timeline);
        assert.ok(built);
        const burned = framesOfAss(built.ass, fps, frames);
        const exported = framesOfSrt(built.srt, fps, frames);
        const at = `${preset} at ${aspect}, ${fps.num}/${fps.den} fps`;
        for (let n = 0; n < frames; n++) {
          assert.equal(burned[n], exported[n], `${at}, frame ${n}`);
        }
        // Every word is shown, in order, as said.
        const all = exported.filter((text, n) => text && text !== exported[n - 1]).join("");
        const words = LINES.flatMap((line) => line.words?.map((word) => word.text) ?? []);
        assert.equal(
          all.replace(/[\s\u3000「」？！…]/g, ""),
          words.join("").replace(/[「」？！…]/g, ""),
          at,
        );
      }
    }
  }
});

test("a caption fades in after a pause, and one that replaces another shows at full strength", async () => {
  const lines = [
    said([..."今天要來聊一下怎麼用", "AI", ..."自動剪片你只要把素材丟進去就好了"], 0.5),
    said([..."謝謝收看"], 12),
  ];
  for (const preset of Object.keys(PRESETS)) {
    const edit = project([{ source: "a", in: 0, out: 15 * SECOND }], {
      captions: { preset, srt: false, lines },
    });
    edit.output = { ...edit.output, aspect: "9:16", width: 1080, height: 1920 };
    const timeline = {
      main: [],
      broll: [],
      frames: 450,
      frameTicks: ticksPerFrame(edit.output.fps),
    };
    const built = await buildCaptions(edit, timeline);
    assert.ok(built && built.pages.length >= 3, `${preset}: ${built?.pages.length} pages`);
    // The opacity at the first frame of each page, from the face layer's first event there.
    const fadeIns = built.pages.map((page) => {
      const start = assTime(page.start, timeline.frameTicks);
      const event = built.ass.split("\n").find((line) => line.startsWith(`Dialogue: 4,${start},`));
      const fade = /\\fade\(255,0,255,(-?[\d.]+),(-?[\d.]+),/.exec(event ?? "");
      return fade ? Number(fade[2]) > Number(fade[1]) : false;
    });
    const afterPause = built.pages.map(
      (page, i) => i === 0 || (built.pages[i - 1] as { end: number }).end < page.start,
    );
    assert.deepEqual(fadeIns, afterPause, preset);
  }
});

test("a line without word timings shows at full strength in every preset", async () => {
  const line = { start: SECOND, end: 3 * SECOND, language: "zh-TW", text: "謝謝收看" };
  for (const preset of Object.keys(PRESETS)) {
    const edit = project([{ source: "a", in: 0, out: 5 * SECOND }], {
      captions: { preset, srt: false, lines: [line] },
    });
    const timeline = {
      main: [],
      broll: [],
      frames: 150,
      frameTicks: ticksPerFrame(edit.output.fps),
    };
    const built = await buildCaptions(edit, timeline);
    const faces = built?.ass.split("\n").filter((event) => event.startsWith("Dialogue: 4,")) ?? [];
    assert.ok(faces.length > 0, preset);
    for (const face of faces) {
      assert.doesNotMatch(face, /\\alpha&H(?!00&)/, preset);
    }
  }
});
