// Callouts on a screen recording: the synthetic talk drawn as a screen with two still buttons and
// a bar that moves, its index saying the whole file is a screen recording.

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { type MediaIndex, type Overlay, secondsToTicks } from "@video-editor/schema";
import { makeSource } from "../fixtures.ts";
import { scratch } from "../testing.ts";
import { recordedClaude } from "./claude.ts";
import { type CalloutWish, calloutRect } from "./locate.ts";
import { type PlannedEdit, type PlanSource, plan } from "./plan.ts";
import { type Decisions, planSchema, planSystem } from "./prompt.ts";
import { makeTalk, talkWords } from "./talk.ts";

const recorded = async (): Promise<Decisions> =>
  JSON.parse(await readFile(new URL("fixtures/talk-plan.json", import.meta.url), "utf8"))[0];

/** When "video" is said, on line 4 (那個工具叫做 video editor。). */
const SAID = talkWords().find((w) => w.text === "video")?.start ?? 0;
// On a 320 x 180 screen: a button in the middle, inside a 9:16 crop of it, one near the right
// edge, outside that crop, and a bar on the left that moves down 80 pixels a second after
// "video" is said, as a page scrolls.
const MIDDLE = { left: 140, top: 120, right: 180, bottom: 144 };
const RIGHT = { left: 250, top: 40, right: 300, bottom: 64 };
const BAR = { left: 20, top: 20, right: 120, bottom: 40 };
const SCREEN = [
  "drawbox=x=140:y=120:w=40:h=24:color=blue:t=fill",
  "drawbox=x=250:y=40:w=50:h=24:color=red:t=fill",
  `drawbox=x=20:y=20:w=100:h=20:color=white:t=fill:enable='lt(t,${SAID + 1})'`,
  `drawbox=x=20:y=100:w=100:h=20:color=white:t=fill:enable='gte(t,${SAID + 1})'`,
].join(",");

const wish = (target: string, label = ""): CalloutWish => ({
  source: "talk",
  line: 4,
  text: "video editor",
  target,
  label,
  reason: "It is named.",
});
const found = (box: typeof MIDDLE) => ({ found: true, ...box });

/** The talk as a screen recording, planned with Claude asked to point at `wishes`, each answered
 * in turn with the box in `replies`; answers are cached under `cache`. */
async function edit(
  dir: string,
  aspect: "16:9" | "9:16",
  wishes: CalloutWish[],
  replies: object[],
  cache: string,
): Promise<{ edit: PlannedEdit; asked: number }> {
  const path = await makeTalk(dir, "talk", { width: 320, height: 180 });
  const media = JSON.parse(await readFile(path, "utf8")) as MediaIndex;
  const end = media.source.duration;
  media.framing = { fps: 5, shots: [{ start: 0, end, layout: "screen", faces: [], speakers: [] }] };
  // makeTalk draws a test pattern: the screen goes in its place.
  const { duration } = media.source;
  await makeSource(dir, { id: "talk", pattern: "color", width: 320, height: 180, fps: 25, seconds: duration, sound: 440, filter: SCREEN }); // biome-ignore format: one line
  await writeFile(path, JSON.stringify(media));
  const decisions: Decisions = { ...(await recorded()), callouts: wishes };
  const { claude, requests } = recordedClaude({ plan: [decisions], locate: replies });
  process.env.XDG_CACHE_HOME = cache;
  const out = join(dir, `${aspect.replace(":", "x")}.json`);
  const planned = await plan({ inputs: [path], length: 15, aspect, out, claude });
  return { edit: planned, asked: requests.filter((r) => r.purpose === "locate").length };
}

const callouts = (planned: PlannedEdit) =>
  (planned.project.overlays ?? []).filter((o) => o.template === "callout");

test("a callout points at what Claude boxed on the frame where it is named, mapped into the crop", async (t) => {
  const dir = await scratch(t, "locate-");
  const cache = join(dir, "cache");
  const saved = process.env.XDG_CACHE_HOME;
  t.after(() => {
    process.env.XDG_CACHE_HOME = saved;
  });
  const wishes = [wish("the blue button", "就是這裡"), wish("the red button")];
  const first = await edit(dir, "9:16", wishes, [found(MIDDLE), found(RIGHT)], cache);
  assert.equal(first.asked, 2);
  // The red button is outside the 9:16 crop of the middle: left out.
  const [callout, ...more] = callouts(first.edit) as Overlay[];
  assert.ok(callout);
  assert.deepEqual(more, []);
  const crop = first.edit.project.main[0]?.framing?.crop;
  assert.ok(crop?.type === "static");
  const rect = callout.params.rect as { x: number; y: number; w: number; h: number };
  const near = (a: number, b: number) => Math.abs(a - b) < 2e-3;
  assert.ok(near(rect.x, (140 / 320 - crop.rect.x) / crop.rect.w), JSON.stringify(rect));
  assert.ok(near(rect.w, 40 / 320 / crop.rect.w) && near(rect.y, 120 / 180) && near(rect.h, 24 / 180)); // biome-ignore format: one line
  assert.equal(callout.params.label, "就是這裡");
  // It starts 0.3 s before "video" is said, on the output timeline, and on a frame.
  const video = first.edit.state.sources.get("talk")?.words.findIndex((w) => w.text === "video");
  const where = (first.edit.state.regions.values().next().value ?? assert.fail()).word;
  assert.equal(where, video);
  assert.equal(callout.start % (secondsToTicks(1) / 25), 0);
  // The plan and the two requests to find the buttons, each with its cost.
  assert.deepEqual(
    first.edit.state.usage.map((u) => u.purpose),
    ["plan", "locate", "locate"],
  );

  // Planned again: the answers come from the cache, with no request.
  const again = await edit(dir, "9:16", wishes, [], cache);
  assert.equal(again.asked, 0);
  assert.deepEqual(callouts(again.edit), callouts(first.edit));
});

test("a callout is left out where the thing is not found, is not one thing or moves", async (t) => {
  const dir = await scratch(t, "locate-left-");
  const saved = process.env.XDG_CACHE_HOME;
  t.after(() => {
    process.env.XDG_CACHE_HOME = saved;
  });
  const wishes = [wish("the blue button"), wish("the screen"), wish("the bar")];
  const nothing = { found: false, left: 0, top: 0, right: 0, bottom: 0 };
  const whole = found({ left: 0, top: 0, right: 320, bottom: 180 });
  const left = await edit(dir, "16:9", wishes, [nothing, whole, found(BAR)], join(dir, "cache"));
  assert.equal(left.asked, 3);
  assert.deepEqual(callouts(left.edit), []);
  // A thing that holds still on the same screen is pointed at.
  const still = await edit(
    dir,
    "16:9",
    [wish("the blue button")],
    [found(MIDDLE)],
    join(dir, "c2"),
  );
  assert.equal(callouts(still.edit).length, 1);
});

test("a callout plays on across a jump cut in the screen recording, never into another source or a change", async (t) => {
  const dir = await scratch(t, "locate-cut-");
  const seconds = Math.ceil(SAID + 8);
  await makeSource(dir, { id: "screen", pattern: "color", width: 320, height: 180, fps: 25, seconds, sound: 440, filter: SCREEN }); // biome-ignore format: one line
  const media = JSON.parse(await readFile(join(dir, "screen.index.json"), "utf8")) as MediaIndex;
  const shot = { start: 0, end: seconds, layout: "screen" as const, faces: [], speakers: [] };
  media.framing = { fps: 5, shots: [shot] };
  const words = [{ text: "video", start: SAID, end: SAID + 0.4 }];
  const source = { id: "screen", path: join(dir, "screen.mp4"), index: media, words } as unknown as PlanSource; // biome-ignore format: one line
  const T = secondsToTicks(1);
  // The word 0.3 s into the edit's first clip, which ends 1 s later; the edit jumps on 2 s.
  const first = { source: "screen", in: (SAID - 0.3) * T, out: (SAID + 0.7) * T };
  const jump = { source: "screen", in: (SAID + 2.7) * T, out: (SAID + 6) * T };
  const output = { width: 320, height: 180, frame: T / 25 };
  const at = (box: typeof MIDDLE) => ({ x: box.left / 320, y: box.top / 180, w: (box.right - box.left) / 320, h: (box.bottom - box.top) / 180 }); // biome-ignore format: one line
  const place = (box: typeof MIDDLE, main: object[]) =>
    calloutRect(source, main as never, { source: "screen", word: 0, rect: at(box) }, 0, 3 * T, output, new Map()); // biome-ignore format: one line
  const placed = (await place(MIDDLE, [first, jump])) ?? assert.fail("not placed");
  for (const k of ["x", "y", "w", "h"] as const)
    assert.ok(Math.abs(placed[k] - at(MIDDLE)[k]) < 1e-4);
  // The bar has moved on by the frames after the jump.
  assert.equal(await place(BAR, [first, jump]), undefined);
  // Another source after the cut.
  assert.equal(await place(MIDDLE, [first, { ...jump, source: "other" }]), undefined);
});

test("callouts are offered to the planner only for footage with a screen recording", () => {
  const extras = { music: false, title: false, chapters: false, people: false };
  assert.doesNotMatch(planSystem({ ...extras, callouts: false }), /callout/);
  assert.match(planSystem({ ...extras, callouts: true }), /- callouts, on screen recordings/);
  assert.ok(!(planSchema({ ...extras, callouts: false }).required as string[]).includes("callouts")); // biome-ignore format: one line
  assert.ok((planSchema({ ...extras, callouts: true }).required as string[]).includes("callouts"));
});
