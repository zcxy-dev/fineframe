import assert from "node:assert/strict";
import { test } from "node:test";
import { factsFromIndex, gridTicks } from "./sources.ts";
import { facts, project, SECOND, sources } from "./testing.ts";
import { buildTimeline, ticksToSamples } from "./timeline.ts";

const both = sources(facts("a"), facts("b"));
const clip = (source: string, start: number, seconds: number) => ({
  source,
  in: Math.round(start * SECOND),
  out: Math.round((start + seconds) * SECOND),
});

test("clips are rounded onto the frame grid along the whole edit, so rounding never adds up", () => {
  // 1.01 s clips: 30.3 frames each. Rounding each clip alone would give 30 + 30 + 30.
  const timeline = buildTimeline(
    project([clip("a", 0, 1.01), clip("b", 0, 1.01), clip("a", 3, 1.01)]),
    both,
  );
  assert.deepEqual(
    timeline.main.map((c) => [c.start, c.end]),
    [
      [0, 30],
      [30, 61],
      [61, 91],
    ],
  );
  assert.equal(timeline.frames, 91);
  assert.equal(timeline.samples, 91 * 1600);
  assert.deepEqual(timeline.cuts, [1, 61 / 30]);
});

test("the sound's length follows the frame grid at NTSC rates, to the nearest sample", () => {
  const ntsc = project([clip("a", 0, 1)]);
  ntsc.output.fps = { num: 30000, den: 1001 };
  const timeline = buildTimeline(ntsc, both);
  assert.equal(timeline.frames, 30);
  assert.equal(timeline.samples, Math.round(30 * 1601.6));
  assert.equal(ticksToSamples(4004), 1602);
});

test("a clip's in point snaps to its source's frame grid; a variable-rate source keeps it", () => {
  const edit = project([clip("a", 1.013, 1), clip("b", 1.013, 1)]);
  const timeline = buildTimeline(edit, sources(facts("a"), facts("b", { frameTicks: null })));
  assert.equal(timeline.main[0]?.in, 30 * 4000);
  assert.equal(timeline.main[1]?.in, Math.round(1.013 * SECOND));
});

test("a dissolve overlaps the two clips by its length in frames", () => {
  const timeline = buildTimeline(
    project([
      clip("a", 0, 2),
      { ...clip("b", 0, 2), transition: { type: "dissolve", duration: SECOND / 2 } },
    ]),
    both,
  );
  const [first, second] = timeline.main;
  assert.deepEqual([first?.start, first?.end, second?.start, second?.end], [0, 60, 45, 105]);
  assert.equal(first?.dissolveOut, 15);
  assert.equal(second?.dissolveIn, 15);
  assert.deepEqual(timeline.cuts, [1.75]);
});

test("a dissolve shorter than half a frame becomes a cut", () => {
  const timeline = buildTimeline(
    project([
      clip("a", 0, 2),
      { ...clip("b", 0, 2), transition: { type: "dissolve", duration: 1 } },
    ]),
    both,
  );
  assert.equal(timeline.main[1]?.dissolveIn, 0);
  assert.equal(timeline.main[1]?.start, 60);
});

test("a dip fades out over half its length and in over the rest, without overlapping", () => {
  const timeline = buildTimeline(
    project([
      clip("a", 0, 2),
      { ...clip("b", 0, 2), transition: { type: "dip", duration: SECOND / 2, color: "#102030" } },
    ]),
    both,
  );
  const [first, second] = timeline.main;
  assert.deepEqual(first?.dipOut, { frames: 8, color: "#102030" });
  assert.deepEqual(second?.dipIn, { frames: 8, color: "#102030" });
  assert.equal(second?.start, first?.end);
});

test("B-roll past the end of the main track is cut where the edit ends", () => {
  const timeline = buildTimeline(
    project([clip("a", 0, 2)], {
      broll: [{ source: "b", in: 0, out: 2 * SECOND, start: SECOND, fade: SECOND / 10 }],
    }),
    both,
  );
  assert.deepEqual(
    timeline.broll.map((b) => [b.start, b.end, b.fade]),
    [[30, 60, 3]],
  );
});

test("B-roll that starts after the edit ends fails", () => {
  const edit = project([clip("a", 0, 2)], {
    broll: [{ source: "b", in: 0, out: SECOND, start: 3 * SECOND }],
  });
  assert.throws(() => buildTimeline(edit, both), /broll\/0: starts after the edit ends/);
});

test("an overlay covers the frames whose start falls within its time, cut where the edit ends", () => {
  const overlay = (start: number, seconds: number) => ({
    template: "keyword",
    params: { text: "x" },
    start: Math.round(start * SECOND),
    duration: Math.round(seconds * SECOND),
  });
  // At 30 fps a frame is 4000 ticks: 1.01 s is 30.3 frames, so frame 31 is the first to start
  // inside the overlay, and 2.51 s is 75.3, so frame 75 is the last.
  const edit = project([clip("a", 0, 3)], {
    overlays: [overlay(1.01, 1.5), overlay(2, 1), overlay(0, 1)],
  });
  assert.deepEqual(
    buildTimeline(edit, both).overlays.map((o) => [o.index, o.start, o.end]),
    [
      [0, 31, 76],
      [1, 60, 90],
      [2, 0, 30],
    ],
  );
  const late = project([clip("a", 0, 2)], { overlays: [overlay(2, 1)] });
  assert.throws(() => buildTimeline(late, both), /overlays\/0: starts after the edit ends/);
  // Cut to 0.8 s of its 1.5 s, the keyword still has room for its motion; cut to 0.1 s, it has not.
  const cut = project([clip("a", 0, 2)], { overlays: [overlay(1.2, 1.5)] });
  assert.deepEqual(
    buildTimeline(cut, both).overlays.map((o) => [o.start, o.end]),
    [[36, 60]],
  );
  const stub = project([clip("a", 0, 2)], { overlays: [overlay(1.9, 1.5)] });
  assert.throws(
    () => buildTimeline(stub, both),
    /overlays\/0: the edit ends 0\.1 s into it, under keyword's minimum of 0\.8 s/,
  );
});

test("music sits on the sample grid, cut where the edit ends, with its fades in samples", () => {
  const music = sources(facts("a"), facts("b"), facts("m", { kind: "audio", frameTicks: null }));
  const edit = project([clip("a", 0, 2)], {});
  const license = { name: "CC0 1.0" };
  edit.audio.music = [
    { source: "m", license, in: 0, out: SECOND, start: 0, gainDb: -6, fadeIn: SECOND / 10 },
    {
      source: "m",
      license,
      in: SECOND,
      out: 3 * SECOND,
      start: SECOND,
      gainDb: -6,
      fadeOut: SECOND,
    },
  ];
  const [first, second] = buildTimeline(edit, music).music;
  assert.deepEqual(
    [first?.start, first?.samples, first?.fadeIn, first?.fadeOut],
    [0, 48_000, 4800, 0],
  );
  // 2 s of music from 1 s into a 2 s edit: the second half is cut, and its fade-out with it.
  assert.deepEqual([second?.start, second?.samples, second?.fadeOut], [48_000, 48_000, 24_000]);
  edit.audio.music = [{ source: "m", license, in: 0, out: SECOND, start: 2 * SECOND, gainDb: 0 }];
  assert.throws(() => buildTimeline(edit, music), /\/audio\/music\/0: starts after the edit ends/);
});

test("speech plays where its clips put it on the output timeline", () => {
  const talk = sources(
    facts("a", {
      speech: [
        [0.5, 1.5],
        [2.5, 4],
      ],
    }),
    facts("b", { speech: [[0, 0.4]] }),
  );
  const edit = project([clip("a", 1, 2), clip("b", 0, 1)]);
  edit.broll = [{ source: "b", in: 0, out: SECOND, start: SECOND / 2, gainDb: -12 }];
  // a's 1-1.5 and 2.5-3 s at 0-0.5 and 1.5-2 s; b's 0-0.4 s after the cut at 2 s, and as heard
  // B-roll from 0.5 s. Speech that touches merges.
  assert.deepEqual(buildTimeline(edit, talk).speech, [
    [0, 0.9],
    [1.5, 2.4],
  ]);
  delete edit.broll[0]?.gainDb;
  assert.deepEqual(buildTimeline(edit, talk).speech, [
    [0, 0.5],
    [1.5, 2.4],
  ]);
});

test("an edit outside its target's tolerance fails", () => {
  const edit = project([clip("a", 0, 2)]);
  edit.output.target = { duration: 3 * SECOND, tolerance: 0.05 };
  assert.throws(() => buildTimeline(edit, both), /lasts 2\.000 s, outside 3\.000 s ± 5 %/);
});

test("a clip shorter than half a frame, or past its source's end, fails", () => {
  assert.throws(
    () => buildTimeline(project([clip("a", 0, 1), { source: "b", in: 0, out: 100 }]), both),
    /main\/1: shorter than one output frame/,
  );
  const short = sources(facts("a", { duration: 5 }), facts("b"));
  assert.throws(
    () => buildTimeline(project([clip("a", 4, 2)]), short),
    /main\/0: runs past the end of a/,
  );
});

test("whole-tick frame rates have a grid; variable rates do not", () => {
  assert.equal(gridTicks(30), 4000);
  assert.equal(gridTicks(25), 4800);
  assert.equal(gridTicks(30000 / 1001), 4004);
  assert.equal(gridTicks(23.976), 5005);
  assert.equal(gridTicks(60), 2000);
  assert.equal(gridTicks((30 * 60) / 77), null);
  assert.equal(gridTicks(0), null);
});

test("the media index gives the colour tags, the matrix for untagged footage, pixel shape and time zero", () => {
  const index = (video: object, start?: number) => ({
    version: 1 as const,
    source: {
      name: "a.mp4",
      duration: 10,
      start,
      video: {
        ...{ width: 1920, height: 1080, sample_aspect: 1, fps: 25, rotation: 0, codec: "hevc" },
        ...video,
      },
      audio: [],
    },
    transitions: [],
    speech: [],
    transcript: { language: null, text: "", words: [] },
  });
  const source = project([clip("a", 0, 1)]).sources[0];
  const facts = (video: object) => factsFromIndex(source, "/a.mp4", index(video, 0));
  const hdr = (transfer?: number | null) => facts({ transfer, matrix: 9 }).hdr;
  assert.equal(hdr(16), "pq");
  assert.equal(hdr(18), "hlg");
  assert.equal(hdr(1), null);
  assert.equal(hdr(null), null);
  assert.throws(() => hdr(undefined), /predates colour information/);
  assert.throws(() => facts({ transfer: 1 }), /predates colour information/);
  // Untagged: BT.709 from 1280 wide or above 576 high as stored, else BT.601.
  const matrix = (video: object) => facts({ transfer: null, matrix: null, ...video }).matrix;
  assert.equal(matrix({}), "bt709");
  assert.equal(matrix({ width: 720, height: 576 }), "bt601");
  assert.equal(matrix({ width: 576, height: 720, rotation: 90 }), "bt601");
  assert.equal(matrix({ width: 720, height: 1280, rotation: 270 }), "bt709");
  assert.equal(facts({ transfer: 1, matrix: 1 }).matrix, null);
  const plain = facts({ transfer: 1, matrix: 1 });
  assert.deepEqual([plain.audio, plain.frameTicks, plain.duration], [false, 4800, 10]);
  const video = { transfer: 1, matrix: 1 };
  assert.equal(factsFromIndex(source, "/a.mp4", index(video, 1.4)).zero, 1.4);
  assert.throws(() => factsFromIndex(source, "/a.mp4", index(video)), /predates its time zero/);
  const unshaped = { ...video, sample_aspect: undefined };
  assert.throws(() => facts(unshaped), /predates its pixel shape/);
  // Captions see faces in the picture as displayed: 1440 × 1080 with 4:3 pixels is 16:9.
  const hdv = { ...video, width: 1440, sample_aspect: 4 / 3 };
  const framing = { fps: 5, shots: [] };
  const faces = factsFromIndex(source, "/a.mp4", { ...index(hdv, 0), framing }).faces;
  assert.equal(faces?.aspect, 16 / 9);
});
