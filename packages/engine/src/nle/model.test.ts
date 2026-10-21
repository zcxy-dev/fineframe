import assert from "node:assert/strict";
import { test } from "node:test";
import { type FrameRate, ticksPerFrame } from "@video-editor/schema";
import { facts, project, SECOND, sources } from "../testing.ts";
import { buildTimeline } from "../timeline.ts";
import type { Media } from "./media.ts";
import { nleTimeline, OVERLAY } from "./model.ts";

const RATES: FrameRate[] = [
  { num: 24000, den: 1001 },
  { num: 25, den: 1 },
  { num: 30000, den: 1001 },
  { num: 30, den: 1 },
  { num: 60, den: 1 },
];

function media(id: string, rate: FrameRate, overrides: Partial<Media> = {}): Media {
  return {
    id,
    kind: "video",
    path: `/footage/${id}.mp4`,
    width: 1920,
    height: 1080,
    rate,
    duration: 60 * SECOND,
    start: 0,
    timecode: 0,
    channels: 2,
    sampleRate: 48_000,
    ...overrides,
  };
}

const clip = (source: string, start: number, seconds: number) => ({
  source,
  in: Math.round(start * SECOND),
  out: Math.round((start + seconds) * SECOND),
});

for (const fps of RATES) {
  test(`at ${fps.num}/${fps.den} fps every clip lands on the frames the render shows`, () => {
    const ticks = ticksPerFrame(fps);
    const edit = project([clip("a", 1.013, 2.37), clip("b", 4.2, 1.71), clip("a", 9.99, 3.03)]);
    edit.output.fps = fps;
    const timeline = buildTimeline(
      edit,
      sources(facts("a", { frameTicks: ticks }), facts("b", { frameTicks: ticks })),
    );
    const files = new Map([
      ["a", media("a", fps)],
      ["b", media("b", fps)],
    ]);
    const nle = nleTimeline(timeline, files, false);
    const [main] = nle.video;
    assert.deepEqual(
      main?.map((c) => [c.media, c.start, c.end, c.in]),
      timeline.main.map((c) => [c.source.id, c.start, c.end, c.in]),
    );
    // Back to back from frame 0 to the edit's last, each in point on a source frame.
    assert.equal(main?.[0]?.start, 0);
    for (const [k, c] of (main ?? []).entries()) {
      assert.equal(c.start, main?.[k - 1]?.end ?? 0);
      assert.equal(c.in % ticks, 0);
    }
    assert.equal(main?.at(-1)?.end, timeline.frames);
  });
}

test("a dissolve becomes a cross dissolve centred on its middle, each side the render's frames", () => {
  const edit = project([
    clip("a", 0, 2),
    { ...clip("b", 5, 2), transition: { type: "dissolve", duration: SECOND / 2 } },
  ]);
  const timeline = buildTimeline(edit, sources(facts("a"), facts("b")));
  const files = new Map([
    ["a", media("a", { num: 30, den: 1 })],
    ["b", media("b", { num: 30, den: 1 })],
  ]);
  const [main] = nleTimeline(timeline, files, false).video;
  // The render overlaps frames 45–60; the cut falls 7 frames in.
  assert.deepEqual(
    main?.map((c) => [c.start, c.end, c.in, c.dissolve]),
    [
      [0, 52, 0, null],
      [52, 105, 5 * SECOND + 7 * 4000, { before: 7, after: 8 }],
    ],
  );
});

test("a framing cut splits the clip, and each part holds the mean of what it shows", () => {
  const edit = project([
    {
      ...clip("a", 0, 2),
      framing: {
        crop: {
          type: "path",
          keyframes: [
            { t: 0, rect: { x: 0, y: 0, w: 0.5, h: 1 } },
            { t: SECOND, rect: { x: 0, y: 0, w: 0.5, h: 1 } },
            { t: SECOND + 1, rect: { x: 0.5, y: 0, w: 0.5, h: 1 } },
          ],
        },
      },
    },
  ]);
  edit.output = { ...edit.output, aspect: "9:16", width: 720, height: 1280 };
  const timeline = buildTimeline(edit, sources(facts("a")));
  const [main] = nleTimeline(
    timeline,
    new Map([["a", media("a", { num: 30, den: 1 })]]),
    false,
  ).video;
  assert.deepEqual(
    main?.map((c) => [c.start, c.end, c.in]),
    [
      [0, 30, 0],
      [30, 60, SECOND],
    ],
  );
  const [left, right] = (main ?? []).map((c) => c.picture?.view);
  // A 9:16 crop of a 16:9 picture is 0.316 of its width, centred in each half.
  assert.ok(Math.abs((left?.x ?? 0) + (left?.w ?? 0) / 2 - 0.25) < 1e-9);
  assert.ok(Math.abs((right?.x ?? 0) + (right?.w ?? 0) / 2 - 0.75) < 1e-9);
  assert.ok(Math.abs((left?.w ?? 0) - 9 / 16 / (16 / 9)) < 1e-9);
});

test("a split screen is two clips: the top half on the main track, the bottom above it", () => {
  const edit = project([
    {
      ...clip("a", 0, 1),
      framing: {
        crop: {
          type: "static",
          rect: { x: 0, y: 0, w: 0.5, h: 1 },
          below: { x: 0.5, y: 0, w: 0.5, h: 1 },
        },
      },
    },
  ]);
  edit.output = { ...edit.output, aspect: "9:16", width: 720, height: 1280 };
  const timeline = buildTimeline(edit, sources(facts("a")));
  const nle = nleTimeline(timeline, new Map([["a", media("a", { num: 30, den: 1 })]]), false);
  const [main, split] = nle.video;
  assert.deepEqual(main?.[0]?.picture?.box, { x: 0, y: 0, width: 720, height: 640 });
  assert.deepEqual(split?.[0]?.picture?.box, { x: 0, y: 640, width: 720, height: 640 });
  assert.equal(main?.[0]?.picture?.crop, true);
  assert.equal(split?.[0]?.sound, null);
});

test("B-roll, music and the overlay go on tracks of their own", () => {
  const edit = project([clip("a", 0, 10)], {
    broll: [
      { source: "s", in: 0, out: 2 * SECOND, start: SECOND },
      {
        source: "s",
        in: 0,
        out: 2 * SECOND,
        start: 2 * SECOND,
        rect: { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      },
    ],
    audio: {
      loudness: { integratedLufs: -14, truePeakDbtp: -1 },
      music: [
        {
          source: "m",
          license: { name: "CC0 1.0" },
          in: SECOND / 3,
          out: 20 * SECOND,
          start: 0,
          gainDb: -18,
          fadeOut: SECOND,
          ducking: { depthDb: -10, attackMs: 300, releaseMs: 600 },
        },
      ],
    },
  });
  const timeline = buildTimeline(
    edit,
    sources(
      facts("a", { speech: [[2, 4]] }),
      facts("s", { audio: false }),
      facts("m", { kind: "audio", frameTicks: null }),
    ),
  );
  const rate = { num: 30, den: 1 };
  const files = new Map([
    ["a", media("a", rate)],
    ["s", media("s", rate, { channels: 0 })],
    ["m", media("m", rate, { kind: "audio", width: 0, height: 0, rate: null })],
  ]);
  const nle = nleTimeline(timeline, files, true);
  assert.equal(nle.video.length, 4);
  assert.deepEqual(
    nle.video.slice(1, 3).map((track) => track.map((c) => [c.start, c.end, c.sound])),
    [[[30, 90, null]], [[60, 120, null]]],
  );
  assert.equal(nle.video[2]?.[0]?.picture?.crop, true);
  assert.deepEqual(
    nle.video[3]?.map((c) => [c.media, c.start, c.end]),
    [[OVERLAY, 0, 300]],
  );
  const [music] = nle.audio[0] ?? [];
  assert.deepEqual([music?.start, music?.end, music?.in], [0, 300, SECOND / 3]);
  // Down by 10 dB from 0.3 s before the speech to 0.6 s after it, and out over the last second.
  assert.deepEqual(
    music?.sound?.keys.map((key) => [key.frame, Math.round(key.gainDb * 10) / 10]),
    [
      [0, -18],
      [51, -18],
      [60, -28],
      [120, -28],
      [138, -18],
      [270, -18],
      [300, -Infinity],
    ],
  );
});

test("a sound effect ends with its file, short of the 2 s the render may play", () => {
  const edit = project([clip("a", 0, 10)], {
    audio: {
      loudness: { integratedLufs: -14, truePeakDbtp: -1 },
      sfx: [{ source: "tap", start: 5 * SECOND, gainDb: -6 }],
    },
  });
  const timeline = buildTimeline(
    edit,
    sources(facts("a"), facts("tap", { kind: "audio", frameTicks: null })),
  );
  const rate = { num: 30, den: 1 };
  const files = new Map([
    ["a", media("a", rate)],
    [
      "tap",
      media("tap", rate, { kind: "audio", width: 0, height: 0, rate: null, duration: SECOND / 5 }),
    ],
  ]);
  const [tap] = nleTimeline(timeline, files, false).audio[0] ?? [];
  assert.deepEqual(
    [tap?.start, tap?.end, tap?.sound?.gainDb, tap?.sound?.role],
    [150, 156, -6, "effects"],
  );
});
