import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { test } from "node:test";
import { SchemaError } from "@video-editor/schema";
import { type CardId, cardIds, cards } from "./cards.ts";
import { ICONS, LOGOS } from "./icons.ts";
import { type Aspect, cardLayout, ems, fitRuns, type Placement } from "./layout.ts";
import { type CardJob, cardKey, renderCards } from "./render.ts";
import { cardProblems, validateCards } from "./validate.ts";

test("every card describes itself and accepts its own example", () => {
  assert.equal(cardIds.length, 27);
  for (const id of cardIds) {
    const card = cards[id];
    assert.ok(card.purpose.length > 20 && card.whenToUse.length > 20, id);
    const { min, typical, max } = card.seconds;
    assert.ok(min > 0 && min <= typical && typical <= max, id);
    assert.deepEqual(cardProblems([{ card: id, params: card.example, seconds: typical }]), [], id);
  }
});

test("card params are checked against their card, with the JSON path of each problem", () => {
  const problems = cardProblems([
    { card: "sparkles", params: {} },
    { card: "stat", params: { value: "73", label: "" } },
    { card: "steps", params: { steps: [{ label: "一", icon: "unicorn" }] } },
    { card: "list", params: { items: [{ text: "一" }, { text: "二" }], active: 3 } },
    {
      card: "highlight",
      params: { text: "AI 不會取代你", highlights: ["會用 AI", "取代你", "代"] },
    },
    {
      card: "table",
      params: {
        columns: [{ name: "A" }, { name: "B" }],
        rows: [
          { label: "x", values: [true] },
          { label: "y", values: [1, 2] },
        ],
      },
    },
    { card: "section", params: { title: "一" }, seconds: 9 },
  ]);
  assert.deepEqual(problems, [
    `/cards/0/card: no card sparkles; one of ${cardIds.join(", ")}`,
    "/cards/1/params/value: must be number\n" +
      "/cards/1/params/label: must NOT have fewer than 1 characters\n" +
      '/cards/1/params/label: must match pattern "\\S"',
    "/cards/2/params/steps: must NOT have fewer than 2 items\n" +
      "/cards/2/params/steps/0/icon: must be equal to one of the allowed values",
    "/cards/3/params/active: 3 is past the last of 2",
    "/cards/4/params/highlights/0: not in the text",
    "/cards/4/params/highlights/2: overlaps an earlier highlight",
    "/cards/5/params/rows/0/values: must NOT have fewer than 2 items\n" +
      "/cards/5/params/rows/1/values/0: must be boolean\n" +
      "/cards/5/params/rows/1/values/0: must be string\n" +
      "/cards/5/params/rows/1/values/0: must match exactly one schema in oneOf\n" +
      "/cards/5/params/rows/1/values/1: must be boolean\n" +
      "/cards/5/params/rows/1/values/1: must be string\n" +
      "/cards/5/params/rows/1/values/1: must match exactly one schema in oneOf",
    "/cards/6/seconds: 9 s, outside section's 1.2 to 4 s",
  ]);
  assert.deepEqual(
    cardProblems([
      {
        card: "table",
        params: {
          columns: [{ name: "A" }, { name: "B" }, { name: "C" }],
          rows: [
            { label: "x", values: [true, false] },
            { label: "y", values: [true, "$5", false] },
          ],
          highlight: 4,
        },
      },
    ]),
    [
      "/cards/0/params/highlight: 4 is past the last of 3",
      "/cards/0/params/rows/0/values: 2 values for 3 columns",
    ],
  );
  assert.throws(() => validateCards([{ card: "logo", params: {} }]), SchemaError);
});

test("every icon and logo a card can name is bundled", () => {
  for (const [name, nodes] of Object.entries(ICONS)) assert.ok(nodes.length > 0, name);
  for (const [name, logo] of Object.entries(LOGOS)) {
    assert.match(logo.hex, /^#[0-9A-F]{6}$/, name);
    assert.ok(logo.path.length > 20, name);
  }
});

test("a card's content box stays inside its area and clear of the captions", () => {
  const areas: [Aspect, Placement, number, number][] = [
    ["9:16", "full", 1080, 1920],
    ["9:16", "panel", 1080, 880],
    ["1:1", "full", 1080, 1080],
    ["1:1", "panel", 1080, 540],
    ["16:9", "full", 1920, 1080],
    ["16:9", "panel", 1920, 540],
  ];
  for (const [aspect, placement, width, height] of areas) {
    const { box, u } = cardLayout(aspect, placement, width, height);
    assert.ok(box.left > 0 && box.top > 0, `${aspect} ${placement}`);
    assert.ok(
      box.left + box.width < width && box.top + box.height < height,
      `${aspect} ${placement}`,
    );
    assert.ok(u >= Math.min(box.width, box.height) / 100, `${aspect} ${placement}`);
  }
  // A full 9:16 card ends above the captions, which rest at 62 to 72 % of the frame's height.
  const portrait = cardLayout("9:16", "full", 1080, 1920).box;
  assert.ok(portrait.top + portrait.height <= 0.62 * 1920);
  // A 9:16 panel clears the apps' header, measured on the frame.
  assert.ok(cardLayout("9:16", "panel", 1080, 880).box.top >= 0.11 * 1920);
});

test("a card's cache key ignores key order and changes with its placement", () => {
  const job: CardJob = {
    card: "stat",
    params: { value: 3, label: "倍" },
    placement: "full",
    aspect: "9:16",
    width: 1080,
    height: 1920,
    fps: { num: 30, den: 1 },
    frames: 90,
  };
  const key = cardKey(job, "code");
  assert.equal(cardKey({ ...job, params: { label: "倍", value: 3 } }, "code"), key);
  assert.notEqual(cardKey({ ...job, placement: "panel", height: 880 }, "code"), key);
  assert.notEqual(cardKey({ ...job, params: { value: 4, label: "倍" } }, "code"), key);
});

// Renders each card's example at five frames a second, so a few frames span its whole build, at
// a small full 9:16 frame and a small 16:9 panel: the two shapes furthest apart.
test("every card renders through Remotion, full and as a panel", {
  skip: process.env.CI ? "renders with Chrome: run it locally" : false,
  timeout: 600_000,
}, async () => {
  const jobs = cardIds.flatMap((card: CardId): CardJob[] => {
    const frames = Math.ceil(cards[card].seconds.typical * 5);
    const base = { card, params: cards[card].example, fps: { num: 5, den: 1 }, frames };
    return [
      { ...base, placement: "full", aspect: "9:16", width: 270, height: 480 },
      { ...base, placement: "panel", aspect: "16:9", width: 480, height: 136 },
    ];
  });
  const files = await renderCards(jobs);
  assert.equal(files.length, jobs.length);
  for (const file of files) assert.ok((await stat(file)).size > 1000, file);
});

test("a long English statement shrinks until its words, wrapped whole, fit the card", () => {
  const { box, type } = cardLayout("9:16", "full", 1080, 1920);
  const text = "A visual flare forecast: to our knowledge, a first.";
  const words = text.split(" ");
  const size = fitRuns(words, type("display"), box.width * 0.96, box.height, 1.32);
  // Lay the words out greedily at that size, in heavy type, as the browser does.
  let lines = 1;
  let used = 0;
  for (const word of words) {
    const w = ems(word) * 1.08 * size;
    const next = used === 0 ? w : used + ems(" ") * size + w;
    if (next > box.width * 0.96 && used > 0) {
      lines += 1;
      used = w;
    } else used = next;
  }
  assert.ok(lines * 1.32 * size <= box.height, `${lines} lines of ${size} px overflow ${box.height}`); // biome-ignore format: one line
  // The old estimate, by characters, let this statement run past the box at a larger size.
  assert.ok(size < type("display"));
});
