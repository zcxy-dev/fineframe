import assert from "node:assert/strict";
import { test } from "node:test";
import type { Project } from "@video-editor/schema";
import { cutPieces, EDGE_FADE_SAMPLES } from "./pieces.ts";
import { facts, project, SECOND, sources } from "./testing.ts";
import { buildTimeline } from "./timeline.ts";

const both = sources(facts("a"), facts("b"));
const clip = (source: string, start: number, seconds: number) => ({
  source,
  in: start * SECOND,
  out: (start + seconds) * SECOND,
});
const pieces = (main: Project["main"], extra: Partial<Project> = {}) => {
  const timeline = buildTimeline(project(main, extra), both);
  return { timeline, pieces: cutPieces(timeline) };
};

test("each clip of a cut edit is one piece, with a short fade at every cut", () => {
  const { pieces: cut } = pieces([clip("a", 0, 1), clip("b", 0, 1)]);
  assert.deepEqual(
    cut.map((p) => [p.start, p.end, p.samples, p.main[0].fadeIn, p.main[0].fadeOut]),
    [
      [0, 30, 48000, EDGE_FADE_SAMPLES, EDGE_FADE_SAMPLES],
      [30, 60, 48000, EDGE_FADE_SAMPLES, EDGE_FADE_SAMPLES],
    ],
  );
});

test("a dissolve is its own piece, blending the end of one clip with the start of the next", () => {
  const { pieces: cut } = pieces([
    clip("a", 0, 2),
    { ...clip("b", 5, 2), transition: { type: "dissolve", duration: SECOND / 2 } },
  ]);
  assert.deepEqual(
    cut.map((p) => [p.start, p.end, p.main.map((l) => [l.clip.index, l.fromFrame, l.frames])]),
    [
      [0, 45, [[0, 0, 45]]],
      [
        45,
        60,
        [
          [0, 45, 15],
          [1, 0, 15],
        ],
      ],
      [60, 105, [[1, 15, 45]]],
    ],
  );
  // Sound fades only at the edit's edges: inside the dissolve the clips cross-fade.
  assert.deepEqual(
    cut.map((p) => p.main.map((l) => [l.fadeIn, l.fadeOut])),
    [
      [[EDGE_FADE_SAMPLES, 0]],
      [
        [0, 0],
        [0, 0],
      ],
      [[0, EDGE_FADE_SAMPLES]],
    ],
  );
  const [, blend] = cut;
  assert.deepEqual(
    blend?.main.map((l) => [l.fromSample, l.samples]),
    [
      [72000, 24000],
      [0, 24000],
    ],
  );
});

test("a clip wholly inside a dissolve still fades at the hard cut on its other side", () => {
  const dissolve = { type: "dissolve", duration: SECOND / 2 } as const;
  // b lasts exactly its incoming dissolve, then cuts to the next clip.
  const { pieces: into } = pieces([
    clip("a", 0, 1.2),
    { ...clip("b", 0, 0.5), transition: dissolve },
    clip("a", 5, 1.2),
  ]);
  assert.deepEqual(
    into.map((p) => p.main.map((l) => [l.clip.index, l.fadeIn, l.fadeOut])),
    [
      [[0, EDGE_FADE_SAMPLES, 0]],
      [
        [0, 0, 0],
        [1, 0, EDGE_FADE_SAMPLES],
      ],
      [[2, EDGE_FADE_SAMPLES, EDGE_FADE_SAMPLES]],
    ],
  );
  // b follows a hard cut and lasts exactly its outgoing dissolve.
  const { pieces: out } = pieces([
    clip("a", 0, 1.2),
    clip("b", 0, 0.5),
    { ...clip("a", 5, 1.2), transition: dissolve },
  ]);
  assert.deepEqual(
    out.map((p) => p.main.map((l) => [l.clip.index, l.fadeIn, l.fadeOut])),
    [
      [[0, EDGE_FADE_SAMPLES, EDGE_FADE_SAMPLES]],
      [
        [1, EDGE_FADE_SAMPLES, 0],
        [2, 0, 0],
      ],
      [[2, 0, EDGE_FADE_SAMPLES]],
    ],
  );
});

test("a dip fades the picture and the sound out and in together", () => {
  const { pieces: cut } = pieces([
    clip("a", 0, 2),
    { ...clip("b", 0, 2), transition: { type: "dip", duration: SECOND / 2, color: "#000000" } },
  ]);
  const [first, second] = cut.map((p) => p.main[0]);
  assert.equal(first?.dipOut?.frames, 8);
  assert.equal(first?.fadeOut, 8 * 1600);
  assert.equal(second?.dipIn?.frames, 8);
  assert.equal(second?.fadeIn, 8 * 1600);
});

test("B-roll is split at piece boundaries and keeps its own time across them", () => {
  const { pieces: cut } = pieces(
    [
      clip("a", 0, 2),
      { ...clip("b", 5, 2), transition: { type: "dissolve", duration: SECOND / 2 } },
    ],
    { broll: [{ source: "b", in: 0, out: SECOND, start: (4 / 3) * SECOND }] },
  );
  assert.deepEqual(
    cut.map((p) => p.broll.map((b) => [b.fromFrame, b.frames, b.atFrame, b.atSample])),
    [[[0, 5, 40, 64000]], [[5, 15, 0, 0]], [[20, 10, 0, 0]]],
  );
});

test("an overlay is split at piece boundaries and keeps its own frame count across them", () => {
  const { pieces: cut } = pieces(
    [
      clip("a", 0, 2),
      { ...clip("b", 5, 2), transition: { type: "dissolve", duration: SECOND / 2 } },
      clip("a", 4, 1),
    ],
    { overlays: [{ template: "wipe", params: {}, start: SECOND, duration: 3 * SECOND }] },
  );
  // Pieces: frames 0-45, the dissolve 45-60, 60-105 and 105-135; the overlay covers 30-120.
  assert.deepEqual(
    cut.map((p) => p.overlays.map((o) => [o.fromFrame, o.frames, o.atFrame])),
    [[[0, 15, 30]], [[15, 15, 0]], [[30, 45, 0]], [[75, 15, 0]]],
  );
});

test("the pieces' samples add up to the edit's at NTSC rates", () => {
  const ntsc = project([
    clip("a", 0, 1.3),
    { ...clip("b", 2, 1.7), transition: { type: "dissolve", duration: SECOND / 3 } },
    clip("a", 5, 0.9),
  ]);
  ntsc.output.fps = { num: 30000, den: 1001 };
  const timeline = buildTimeline(ntsc, both);
  const cut = cutPieces(timeline);
  assert.equal(
    cut.reduce((sum, p) => sum + p.samples, 0),
    timeline.samples,
  );
  assert.equal(
    cut.reduce((sum, p) => sum + p.end - p.start, 0),
    timeline.frames,
  );
  for (const p of cut) for (const layer of p.main) assert.equal(layer.samples, p.samples);
});
