import assert from "node:assert/strict";
import { test } from "node:test";
import { checkGraphics } from "@video-editor/effects";
import { chrome } from "../chrome.ts";
import type { TimedWord } from "./captions.ts";
import { findQuote, type GraphicWish, placeGraphics } from "./graphics.ts";

const SECOND = 120_000;
const FRAME = SECOND / 30;

/** One word a second from 0.5 s: 我 現 在 二 十 七 歲 … */
const words: TimedWord[] = [..."我現在二十七歲，我放所有心思在解決我二十七歲的問題"].map(
  (text, index) => ({
    source: "a",
    index,
    text,
    start: (index + 0.5) * SECOND,
    end: (index + 0.9) * SECOND,
  }),
);

test("a quote is found among the words nearest where Claude said it lands", () => {
  // 二十七歲 is said twice; the one nearest the time given wins.
  assert.deepEqual(findQuote(words, "二十七歲", 0), [3, 6]);
  assert.deepEqual(findQuote(words, "二十七歲", 20 * SECOND), [18, 21]);
  // Punctuation and spaces do not matter; words not said are not found.
  assert.deepEqual(findQuote(words, "所有 心思!", 0), [10, 13]);
  assert.equal(findQuote(words, "三十歲", 0), null);
});

const wish = (overrides: Partial<GraphicWish>): GraphicWish => ({
  layout: "label",
  anchor: { source: "a", index: 3 },
  words: [],
  seconds: 3,
  shows: "x",
  html: "<b>x</b>",
  css: "",
  sfx: "none",
  ...overrides,
});

test("graphics land on their words, one at a time, clear of what they may not cover", () => {
  const why: string[] = [];
  const placed = placeGraphics(
    [
      // On 二, said at 3.5 s: from 3.1 s for its 3 s.
      wish({ anchor: { source: "a", index: 3 }, words: [{ source: "a", word: 3 }] }),
      // Too close after the first.
      wish({ anchor: { source: "a", index: 5 } }),
      // Its words were cut.
      wish({ anchor: { source: "a", index: 99 } }),
      wish({ anchor: { source: "a", index: 9 }, words: [{ source: "a", word: 98 }] }),
      // Over something taken.
      wish({ anchor: { source: "a", index: 12 } }),
      // A full frame stays at least 4 s and ends where something taken starts.
      wish({ layout: "full", anchor: { source: "a", index: 16 }, seconds: 20 }),
    ],
    words,
    40 * SECOND,
    FRAME,
    [
      { start: 11 * SECOND, end: 13 * SECOND },
      { start: 24 * SECOND, end: 26 * SECOND },
    ],
    (message) => why.push(message),
  );
  const at = placed.map((p) => ({
    layout: p.graphic.layout,
    start: p.graphic.start / SECOND,
    seconds: p.graphic.duration / SECOND,
  }));
  assert.deepEqual(at[0], { layout: "label", start: 3.1, seconds: 3 });
  assert.equal(at[1]?.layout, "full");
  assert.ok(Math.abs((at[1]?.start ?? 0) - 16.1) < 1e-9);
  // Until 0.4 s before what is taken from 24 s.
  assert.ok(Math.abs((at[1]?.seconds ?? 0) - (23.6 - 16.1)) < 0.05, `${at[1]?.seconds}`);
  assert.equal(placed.length, 2);
  assert.match(why.join("\n"), /too close to the graphic before/);
  assert.match(why.join("\n"), /the words it lands on were cut/);
  assert.match(why.join("\n"), /it shows words the edit no longer says/);
  assert.match(why.join("\n"), /it would start over B-roll or an effect/);
  for (const { graphic } of placed) {
    assert.equal(graphic.start % FRAME, 0);
    assert.equal(graphic.duration % FRAME, 0);
  }
});

test("a label gives way to a panel that wants its time, and full frames keep to a quarter of the edit", () => {
  const why: string[] = [];
  const placed = placeGraphics(
    [
      wish({ anchor: { source: "a", index: 2 } }),
      wish({ layout: "panel", anchor: { source: "a", index: 4 }, seconds: 4 }),
      wish({ layout: "full", anchor: { source: "a", index: 10 }, seconds: 5 }),
      wish({ layout: "full", anchor: { source: "a", index: 17 }, seconds: 5 }),
    ],
    words,
    26 * SECOND,
    FRAME,
    [],
    (message) => why.push(message),
  );
  assert.deepEqual(
    placed.map((p) => p.graphic.layout),
    ["panel", "full"],
  );
  assert.match(why.join("\n"), /gives way to the panel graphic/);
  assert.match(why.join("\n"), /more than 25 % of the edit/);
});

// Checks run in Chrome Headless Shell, which downloads on the first run; CI skips them.
const browser = { skip: process.env.CI ? "checks in Chrome: run it locally" : false };

test("each graphic is checked as drawn", browser, async () => {
  const output = { aspect: "9:16" as const, width: 1080, height: 1920, fps: { num: 30, den: 1 } };
  const around = {
    captions: [{ x: 0, y: 1180, width: 1080, height: 220 }],
    faces: [{ x: 300, y: 200, width: 450, height: 500 }],
  };
  const chip = (left: number, top: number, size = 6) =>
    `<div class="ff-chip" style="position:absolute;left:${left}px;top:${top}px;animation:ff-from-left .5s var(--enter) .1s both"><span style="font-size:calc(var(--u)*${size})">二十七歲</span></div>`;
  const [good, onFace, bad, small, empty, marked, emoji, iconic] = await checkGraphics(
    [
      { layout: "label", html: chip(90, 760), css: "", output, frames: 90, ...around },
      { layout: "label", html: chip(350, 400), css: "", output, frames: 90, ...around },
      {
        layout: "full",
        html: '<div class="ff-stage"></div><div style="position:absolute;left:100px;top:100px;font-size:20px;animation:ff-rise 2s both">小字</div><div style="position:absolute;left:900px;top:1300px;font-size:120px;animation:gone .5s 1s both">出界的文字</div>',
        css: "@keyframes gone { to { opacity: 0 } }",
        output,
        frames: 90,
        ...around,
      },
      { layout: "label", html: chip(90, 760, 3.5), css: "", output, frames: 90, ...around },
      {
        layout: "label",
        html: chip(90, 760).replace("<span ", '<span class="late" '),
        css: ".late { display: inline-block; animation: ff-fade .5s 1.5s both }",
        output,
        frames: 90,
        ...around,
      },
      {
        layout: "label",
        html: chip(90, 760).replace(
          "<span",
          '<img src="icons/accent/rocket.svg" style="width:calc(var(--u)*5);height:calc(var(--u)*5)"><span',
        ),
        css: "",
        output,
        frames: 90,
        ...around,
      },
      {
        layout: "label",
        html: chip(90, 760).replace("二十七歲", "二十七歲😀"),
        css: "",
        output,
        frames: 90,
        ...around,
      },
      // A full frame whose icon and number together span most of it.
      {
        layout: "full",
        html: '<div class="ff-stage"></div><div style="position:absolute;left:10%;right:10%;top:20%;height:40%;display:flex;align-items:center;justify-content:space-between;animation:ff-pop .5s both"><img src="icons/accent/rocket.svg" style="width:40%;height:100%"><b style="font-size:calc(var(--u)*20)">27</b></div>',
        css: "",
        output,
        frames: 90,
        ...around,
      },
    ],
    await chrome(),
  );
  assert.deepEqual(good?.problems, []);
  assert.equal(good?.text, "二十七歲");
  // Its box, with room for its glow, on even pixels.
  assert.ok(good?.box && good.box.x < 90 && good.box.y < 760 && good.box.width % 2 === 0);
  assert.ok(good?.shot && good.shot.length > 1000);
  assert.deepEqual(onFace?.problems, ["It covers the speaker's face."]);
  const problems = bad?.problems.join("\n") ?? "";
  for (const expected of [
    /An entrance lasts 2\.00 s/,
    /"出界的文字" disappears before the end/,
    /"出界的文字" runs off the frame/,
    /"小字" is set under the smallest size/,
    /"出界的文字" lies under the captions/,
    /leaves too much of the frame empty/,
    /Its largest text is .* units/,
  ]) {
    assert.match(problems, expected);
  }
  assert.match(small?.problems.join("\n") ?? "", /Its largest text is 3\.5 units/);
  // A bundled icon loads and draws; a character no font has would show as a box.
  assert.deepEqual(marked?.problems, []);
  assert.ok((marked?.box?.width ?? 0) > (good?.box?.width ?? 0));
  assert.deepEqual(emoji?.problems, [
    'The fonts have no "😀": it would show as a box; use words, digits or common punctuation.',
  ]);
  // The icon counts as part of what fills the frame.
  assert.deepEqual(iconic?.problems, []);
  // The chip is in by 0.6 s, its text only at 2 s.
  assert.deepEqual(empty?.problems, [
    "A box shows empty for 1.4 s before its text enters: bring the text in with its box, within 0.8 s.",
  ]);
});
