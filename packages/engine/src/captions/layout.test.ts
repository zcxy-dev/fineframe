import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutFor } from "@video-editor/effects";
import type { CaptionLine } from "@video-editor/schema";
import { SECOND } from "../testing.ts";
import type { Metrics } from "./fonts.ts";
import { GAP, type LayoutOptions, layoutCaptions, type Page, rowText } from "./layout.ts";
import { LEADING, PRESETS, TYPE_SCALE } from "./presets.ts";

/** Ideographs and full-width marks an em wide, Latin half, a space a quarter; no emoji. */
const metrics: Metrics = {
  advance: (code) => {
    if (code >= 0x1f000) return undefined;
    if (code === 0x20) return 0.25;
    return code >= 0x2e80 ? 1 : 0.5;
  },
  lineHeight: 1.448,
  ascent: 1.16,
  descent: 0.288,
  emTop: 0.88,
  emBottom: 0.12,
};

const options: LayoutOptions = {
  maxWidth: 10,
  maxRows: 2,
  tracking: 0,
  frameTicks: 4000,
  hold: 0,
  tail: 0,
  frames: 1_000_000,
};

/** A line whose words are its Han characters and Latin words, 0.2 s each from `start`. */
function line(text: string, start = 0): CaptionLine {
  const tokens = text.match(/[A-Za-z0-9']+|\p{Script=Han}/gu) ?? [];
  const words = tokens.map((token, i) => ({
    text: token,
    start: Math.round((start + 0.2 * i) * SECOND),
    end: Math.round((start + 0.2 * (i + 1)) * SECOND),
  }));
  return {
    start: Math.round(start * SECOND),
    end: Math.round((start + 0.2 * tokens.length) * SECOND),
    language: "zh-TW",
    text,
    words,
  };
}

const lay = (lines: CaptionLine[], extra: Partial<LayoutOptions> = {}) =>
  layoutCaptions({ preset: "bold", srt: true, lines }, metrics, { ...options, ...extra });
const shown = (pages: Page[]) => pages.map((page) => page.rows.map(rowText));

test("rows break between words, never inside one", () => {
  // Without word breaks, the even split would be 今天要來聊一 | 下怎麼用 AI 自動剪片.
  assert.deepEqual(shown(lay([line("今天要來聊一下怎麼用 AI 自動剪片")])), [
    ["今天要來聊一下", "怎麼用 AI 自動剪片"],
  ]);
});

test("rows do not end on a word that leads into the next, nor start on a particle", () => {
  // The even split would leave 不 hanging: 什麼事情都不 | 給我標準答案.
  assert.deepEqual(shown(lay([line("什麼事情都不給我標準答案")])), [
    ["什麼事情", "都不給我標準答案"],
  ]);
  // Nor 最尖端 | 的語言模型, or 其實現在最 | 尖端的語言模型.
  assert.deepEqual(shown(lay([line("其實現在最尖端的語言模型")])), [
    ["其實現在", "最尖端的語言模型"],
  ]);
});

test("pages and rows end at pauses and hold whole phrases", () => {
  const text = `大家好${GAP}今天要來聊一下怎麼用 AI 自動剪片${GAP}你只要把素材丟進去${GAP}選好長度跟比例`;
  assert.deepEqual(shown(lay([line(text)])), [
    ["大家好"],
    ["今天要來聊一下", "怎麼用 AI 自動剪片"],
    ["你只要把素材丟進去", "選好長度跟比例"],
  ]);
  // Short phrases share a row, with the gap between them.
  assert.deepEqual(shown(lay([line(`好${GAP}走吧`)])), [[`好${GAP}走吧`]]);
});

test("one row a caption at 16:9, broken at pauses and between words", () => {
  const text = `你只要把素材丟進去${GAP}選好長度跟比例${GAP}按下 start 就好了！`;
  assert.deepEqual(shown(lay([line(text)], { maxWidth: 16, maxRows: 1 })), [
    ["你只要把素材丟進去"],
    ["選好長度跟比例"],
    ["按下 start 就好了！"],
  ]);
});

test("a word wider than a row breaks between its characters, and an English word never", () => {
  const pages = lay([line("台灣積體電路製造股份有限公司")], { maxWidth: 5, maxRows: 1 });
  assert.ok(pages.every((page) => page.rows.every((row) => row.width <= 5)));
  assert.equal(shown(pages).flat().join(""), "台灣積體電路製造股份有限公司");
  const english = lay([line("supercalifragilistic 很長")], { maxWidth: 4, maxRows: 1 });
  assert.deepEqual(shown(english), [["supercalifragilistic"], ["很長"]]);
});

const CLOSING = "、。，：；？！）」』》…,.!?:;)";
const OPENING = "（「『《([";

test("over random mixed lines, rows keep every character, fit, and obey kinsoku", () => {
  const han = [
    "今天",
    "要",
    "來",
    "聊",
    "一下",
    "怎麼",
    "用",
    "自動",
    "剪片",
    "字幕",
    "跟著",
    "講話",
  ];
  const latin = ["AI", "workflow", "start", "Claude", "FFmpeg"];
  let seed = 7;
  const random = (n: number) => {
    seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
    return seed % n;
  };
  for (let trial = 0; trial < 300; trial++) {
    let text = "";
    for (let i = 0, count = 3 + random(14); i < count; i++) {
      const roll = random(10);
      const before = text.at(-1) ?? "";
      if (roll < 6) {
        const word = han[random(han.length)] as string;
        text += /[A-Za-z]/.test(before) ? ` ${word}` : word;
      } else if (roll < 8) {
        text += `${text && before !== GAP ? " " : ""}${latin[random(latin.length)]}`;
      } else if (roll === 8 && text && before !== GAP) {
        text += ["？", "！", "……", GAP][random(4)];
      } else {
        text += `「${han[random(han.length)]}」`;
      }
    }
    const maxWidth = 6 + random(10);
    const maxRows = 1 + random(2);
    const pages = lay([line(text)], { maxWidth, maxRows });
    const rows = pages.flatMap((page) => page.rows);
    const at = `${JSON.stringify(text)} at ${maxWidth} ems, ${maxRows} rows`;
    const bare = (value: string) => value.replace(/[ \u3000]/g, "");
    assert.equal(bare(rows.map(rowText).join("")), bare(text.trim()), at);
    assert.ok(
      pages.every((page) => page.rows.length <= maxRows),
      at,
    );
    for (const row of rows) {
      const shownText = rowText(row);
      assert.ok(
        row.width <= maxWidth + 1e-9 || !/[ \u3000]/.test(shownText),
        `${at}: ${shownText}`,
      );
      assert.ok(!/^[ \u3000]|[ \u3000]$/.test(shownText), `${at}: ${shownText}`);
      assert.ok(!CLOSING.includes(shownText[0] as string), `${at}: row starts ${shownText}`);
      assert.ok(!OPENING.includes(shownText.at(-1) as string), `${at}: row ends ${shownText}`);
    }
    const whole = rows.flatMap((row) => rowText(row).match(/[A-Za-z]+/g) ?? []);
    assert.deepEqual(whole, text.match(/[A-Za-z]+/g) ?? [], `${at}: an English word split`);
  }
});

test("pages start with their first word, and words are lit from their first frame", () => {
  // 30 fps, 4000 ticks a frame; 0.2 s a word is 6 frames.
  const [page] = lay([line("你好", 1)]);
  assert.equal(page?.start, 30);
  assert.deepEqual(page?.words, [
    { start: 30, end: 36, said: 36 },
    { start: 36, end: 42, said: 42 },
  ]);
  // A word that starts inside a frame is lit from the next frame start.
  const late = line("你好", 1);
  late.words = late.words?.map((word) => ({ ...word, start: word.start + 1 }));
  late.start += 1;
  assert.equal(lay([late])[0]?.start, 31);
});

test("a caption holds after its last word unless the next starts, and never runs past the edit", () => {
  const hold = SECOND / 2;
  const tail = SECOND / 10;
  const first = line("你好", 1);
  const second = line("再見", 1.6);
  const pages = lay([first, second], { hold, tail });
  // The first ends at 1.4 s, held until the second starts at 1.6 s.
  assert.deepEqual(
    pages.map((page) => [page.start, page.end]),
    [
      [30, 48],
      [48, 75],
    ],
  );
  // The second's last word is lit 0.1 s past its sound, then none is.
  assert.deepEqual(pages[1]?.words.at(-1), { start: 54, end: 63, said: 60 });
  assert.deepEqual(
    lay([first, second], { hold, tail, frames: 70 }).map((page) => page.end),
    [48, 70],
  );
});

test("a line the caption font cannot draw, or whose words are not in it, fails naming it", () => {
  assert.throws(
    () => lay([line("好"), line("好😀")]),
    /\/captions\/lines\/1\/text: 😀 \(U\+1F600\)/,
  );
  assert.throws(() => lay([line("{好}")]), /\/captions\/lines\/0\/text: \{ cannot be drawn/);
  const wrong = line("你好");
  wrong.words = [{ text: "再", start: 0, end: 1 }];
  assert.throws(
    () => lay([wrong]),
    /\/captions\/lines\/0\/words\/0: "再" is not in the line's text/,
  );
});

test("a full caption at its resting place stays below the band overlays may draw in", () => {
  const sizes = { "16:9": [1920, 1080], "1:1": [1080, 1080], "9:16": [1080, 1920] } as const;
  const biggest = Math.max(...Object.values(PRESETS).map((preset) => preset.scale));
  for (const [aspect, [width, height]] of Object.entries(sizes)) {
    const type = TYPE_SCALE[aspect as keyof typeof sizes];
    const em = (type.em * biggest * Math.min(width, height)) / height;
    const top = type.bottom - em * (1 + LEADING * (type.rows - 1));
    const overlays =
      1 - layoutFor(aspect as keyof typeof sizes, width, height).safe.bottom / height;
    assert.ok(
      top > overlays,
      `${aspect}: caption top ${top.toFixed(3)} reaches overlays down to ${overlays}`,
    );
  }
});
