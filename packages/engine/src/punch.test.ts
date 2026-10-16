import assert from "node:assert/strict";
import { test } from "node:test";
import type { FaceFraming, FaceTrack, FramedShot, Project } from "@video-editor/schema";
import { scaleAt, smallestScale } from "./framing.ts";
import { headroom, punchIns, type ShotFacts } from "./punch.ts";
import { project, SECOND } from "./testing.ts";

const clip = (source: string, start: number, end: number): Project["main"][number] => ({
  source,
  in: Math.round(start * SECOND),
  out: Math.round(end * SECOND),
});
/** 1440p sources, a third more pixels than the 1280×720 output. */
const shots = (transitions: ShotFacts["transitions"] = []) =>
  new Map<string, ShotFacts>([
    ["a", { width: 2560, height: 1440, transitions }],
    ["b", { width: 2560, height: 1440, transitions: [] }],
  ]);
const scales = (edit: Project) => edit.main.map((c) => c.framing?.scale ?? 1);

test("headroom is the crop's pixels over the box's, after narrowing the crop to the box's shape", () => {
  const uhd = { width: 3840, height: 2160 };
  assert.equal(headroom(uhd, undefined, { width: 1920, height: 1080 }), 2);
  assert.equal(headroom({ width: 1280, height: 720 }, undefined, { width: 1280, height: 720 }), 1);
  // A portrait box keeps a 1215-pixel-wide strip of a landscape source.
  assert.equal(headroom(uhd, undefined, { width: 1080, height: 1920 }), 1.125);
  const crop = { type: "static", rect: { x: 0.1, y: 0, w: 0.3, h: 1 } } as const;
  assert.ok(Math.abs(headroom(uhd, { crop }, { width: 1080, height: 1920 }) - 1152 / 1080) < 1e-9);
  // HDV's 1440 × 1080 has 4:3 pixels: a portrait strip of it is 456 of them wide, not 608.
  const hdv = { width: 1440, height: 1080, sampleAspect: 4 / 3 };
  assert.ok(
    Math.abs(headroom(hdv, undefined, { width: 1080, height: 1920 }) - 455.625 / 1080) < 1e-9,
  );
});

test("jump cuts inside one shot alternate between wide and punched in", () => {
  const edit = punchIns(
    project([
      clip("a", 0, 2),
      clip("a", 2.4, 4), // filler cut out: a jump
      clip("a", 4.5, 6), // another
      clip("b", 1, 3), // another source: a real cut
      clip("a", 6.6, 8), // back to a, after b
      clip("a", 8.2, 9), // a jump again
    ]),
    shots(),
  );
  assert.deepEqual(scales(edit), [1, 1.12, 1, 1, 1, 1.12]);
});

test("cuts across a shot change, transitions and contiguous ranges are not jump cuts", () => {
  const edit = punchIns(
    project([
      clip("a", 0, 2),
      clip("a", 3, 4), // a shot starts at 2.5 s, between the two
      { ...clip("a", 4.5, 6), transition: { type: "dissolve", duration: SECOND / 4 } },
      clip("a", 6, 7), // follows on without a gap
      clip("a", 9, 10), // a dissolve spans 8-9.2 s
      clip("a", 10.5, 11), // after the dissolve, within one shot: a jump
    ]),
    shots([
      { start: 2.5, end: 2.5 },
      { start: 8, end: 9.2 },
    ]),
  );
  assert.deepEqual(scales(edit), [1, 1, 1, 1, 1, 1.12]);
});

test("footage without pixels to spare still punches in, enlarged a little further", () => {
  const sized = (width: number, height: number) =>
    new Map<string, ShotFacts>([["a", { width, height, transitions: [] }]]);
  const jump = project([clip("a", 0, 2), clip("a", 3, 5)]);
  assert.deepEqual(scales(punchIns(jump, sized(1280, 720))), [1, 1.12]);
  // 1080p edited at 9:16 is already enlarged to fill the frame.
  const portrait = {
    ...jump,
    output: { ...jump.output, aspect: "9:16" as const, width: 1080, height: 1920 },
  };
  assert.deepEqual(scales(punchIns(portrait, sized(1920, 1080))), [1, 1.12]);
  // So is a crop already narrowed to a speaker.
  const cropped = project([
    {
      ...clip("a", 0, 2),
      framing: { crop: { type: "static", rect: { x: 0, y: 0, w: 0.5, h: 0.5 } } },
    },
    {
      ...clip("a", 3, 5),
      framing: { crop: { type: "static", rect: { x: 0, y: 0, w: 0.5, h: 0.5 } } },
    },
  ]);
  assert.deepEqual(scales(punchIns(cropped, shots())), [1, 1.12]);
  // Images and sources without facts stay wide.
  assert.deepEqual(scales(punchIns(jump, new Map())), [1, 1]);
});

test("a push-in eases in on an emphasis moment, and the next jump cut steps away from it", () => {
  const base = project([clip("a", 10, 14), clip("a", 14.5, 17), clip("a", 17.4, 20)]);
  // The moment is 1-2.5 s into the edit: the push runs from 0.5 s before it to its end.
  base.plan = {
    model: "m",
    rationale: "",
    dropped: [],
    fit: { duration: 0, passes: 0 },
    emphasis: [{ start: SECOND, end: 2.5 * SECOND, text: "x", reason: "y" }],
  };
  const edit = punchIns(base, shots());
  const [first, second, third] = edit.main;
  assert.deepEqual(first?.framing?.scale, {
    type: "path",
    keyframes: [
      { t: 10.5 * SECOND, scale: 1 },
      { t: 12.5 * SECOND, scale: 1.06 },
    ],
  });
  // Pushed in to 1.06, the clip is too close to both wide and 1.12 for either to hide the next
  // cut, which punches in by 12 % from there; then the cut after goes wide again.
  assert.deepEqual([second?.framing?.scale ?? 1, third?.framing?.scale ?? 1], [1.1872, 1]);
  // Halfway through the push the scale is halfway, and it starts and ends without a jolt.
  const scale = first?.framing?.scale;
  assert.ok(Math.abs(scaleAt(scale, 11.5 * SECOND) - 1.03) < 1e-9);
  const step = (t: number) => scaleAt(scale, t + SECOND / 100) - scaleAt(scale, t);
  assert.ok(step(10.5 * SECOND) < step(11.5 * SECOND) / 50);
  assert.ok(step(12.49 * SECOND) < step(11.5 * SECOND) / 50);
  assert.equal(scaleAt(scale, 9 * SECOND), 1);
  assert.equal(scaleAt(scale, 13 * SECOND), 1.06);
  assert.equal(smallestScale(scale), 1);
  assert.equal(smallestScale(1.12), 1.12);
});

test("a push-in near the end of its clip is shorter and smaller, or left out", () => {
  const near = (end: number) => {
    const base = project([clip("a", 0, end)]);
    base.plan = {
      model: "m",
      rationale: "",
      dropped: [],
      fit: { duration: 0, passes: 0 },
      emphasis: [{ start: 2 * SECOND, end: 2.2 * SECOND, text: "x", reason: "y" }],
    };
    return punchIns(base, shots()).main[0]?.framing?.scale;
  };
  // From 1.5 s to the clip's end at 2.5 s: 1 s of push at 3 % a second.
  assert.deepEqual(near(2.5), {
    type: "path",
    keyframes: [
      { t: 1.5 * SECOND, scale: 1 },
      { t: 2.5 * SECOND, scale: 1.03 },
    ],
  });
  assert.equal(near(2.1), undefined);
});

test("a cut that plays on from where the clip before stopped keeps its framing", () => {
  // Joined without a gap, as a review that keeps more of a pause can leave two clips: the
  // picture plays straight through, so a change of framing there would be a jolt, not a cut.
  const edit = punchIns(
    project([clip("a", 0, 2), clip("a", 3, 5), clip("a", 5, 7), clip("a", 7.5, 9)]),
    shots(),
  );
  assert.deepEqual(scales(edit), [1, 1.12, 1.12, 1]);
  // After a push-in, it holds where the push ended.
  const pushed = project([clip("a", 0, 4), clip("a", 4, 7)]);
  pushed.plan = {
    model: "m",
    rationale: "",
    dropped: [],
    fit: { duration: 0, passes: 0 },
    emphasis: [{ start: SECOND, end: 2.5 * SECOND, text: "x", reason: "y" }],
  };
  assert.equal(punchIns(pushed, shots()).main[1]?.framing?.scale, 1.06);
});

test("every emphasis moment in a clip pushes in, each from where the one before ended", () => {
  const base = project([clip("a", 0, 10)]);
  base.plan = {
    model: "m",
    rationale: "",
    dropped: [],
    fit: { duration: 0, passes: 0 },
    emphasis: [
      { start: 6 * SECOND, end: 6.5 * SECOND, text: "y", reason: "y" },
      { start: SECOND, end: 1.5 * SECOND, text: "x", reason: "x" },
    ],
  };
  assert.deepEqual(punchIns(base, shots()).main[0]?.framing?.scale, {
    type: "path",
    keyframes: [
      { t: 0.5 * SECOND, scale: 1 },
      { t: 2.5 * SECOND, scale: 1.06 },
      { t: 5.5 * SECOND, scale: 1.06 },
      { t: 7.5 * SECOND, scale: 1.1236 },
    ],
  });
  // Footage without pixels to spare pushes in no further than UPSCALE: a fourth push is left
  // out, as it would be under 2 %.
  const long = project([clip("a", 0, 16)]);
  long.plan = {
    ...(base.plan as NonNullable<Project["plan"]>),
    emphasis: [1, 6, 10, 13.5].map((t) => ({
      start: t * SECOND,
      end: (t + 0.5) * SECOND,
      text: "x",
      reason: "x",
    })),
  };
  const hd = new Map([["a", { width: 1280, height: 720, transitions: [] }]]);
  const scale = punchIns(long, hd).main[0]?.framing?.scale;
  assert.ok(typeof scale === "object");
  assert.equal(scale.keyframes.length, 6);
  assert.equal(scale.keyframes.at(-1)?.scale, 1.191);
});

test("a moment during a dissolve pushes in only the clip coming in", () => {
  const base = project([
    clip("a", 0, 4),
    { ...clip("b", 10, 14), transition: { type: "dissolve", duration: SECOND } },
  ]);
  base.plan = {
    model: "m",
    rationale: "",
    dropped: [],
    fit: { duration: 0, passes: 0 },
    emphasis: [{ start: 3.2 * SECOND, end: 3.6 * SECOND, text: "x", reason: "y" }],
  };
  const edit = punchIns(base, shots());
  assert.equal(edit.main[0]?.framing, undefined);
  assert.equal(typeof edit.main[1]?.framing?.scale, "object");
});

/** Faces through one 20 s shot, sampled twice a second: each still at its box, as [x, y, w, h],
 * and speaking over its spans. */
const faces = (
  layout: FramedShot["layout"],
  boxes: [number, number, number, number][],
  speakers: { start: number; end: number; face: number }[] = [],
): FaceFraming => ({
  fps: 2,
  shots: [
    {
      start: 0,
      end: 20,
      layout,
      faces: boxes.map(([x, y, w, h], id) => ({
        id,
        boxes: Array.from({ length: 41 }, (_, i) => ({
          t: i / 2,
          x,
          y,
          w,
          h,
        })) as FaceTrack["boxes"],
      })),
      speakers,
    },
  ],
});
const framed = (framing: FaceFraming, width = 2560, height = 1440) =>
  new Map<string, ShotFacts>([["a", { width, height, transitions: [], framing }]]);

test("a punch-in zooms about the face of whoever speaks, which keeps its place on screen", () => {
  const jump = project([clip("a", 0, 2), clip("a", 3, 5)]);
  const one = faces("talking_head", [[0.2, 0.2, 0.2, 0.3]]);
  const edit = punchIns(jump, framed(one));
  assert.equal(edit.main[0]?.framing, undefined);
  assert.deepEqual(edit.main[1]?.framing, { scale: 1.12, anchor: { x: 0.3, y: 0.35 } });
  // Two people: the one speaking during the clip, not the biggest face.
  const two = faces(
    "two_shot",
    [
      [0.1, 0.2, 0.25, 0.35],
      [0.6, 0.3, 0.2, 0.3],
    ],
    [
      { start: 0, end: 2, face: 0 },
      { start: 3.2, end: 5, face: 1 },
    ],
  );
  assert.deepEqual(punchIns(jump, framed(two)).main[1]?.framing?.anchor, { x: 0.7, y: 0.45 });
  // Within a crop, the anchor is where the face is in the crop once narrowed to the output's
  // shape: a 0.5-wide strip from x 0.1 of a 5K picture, narrowed to 16:9 between y 0.25 and 0.75.
  const crop = { type: "static", rect: { x: 0.1, y: 0, w: 0.5, h: 1 } } as const;
  const cropped = project([
    { ...clip("a", 0, 2), framing: { crop } },
    { ...clip("a", 3, 5), framing: { crop } },
  ]);
  const anchor = punchIns(cropped, framed(one, 5120, 2880)).main[1]?.framing?.anchor;
  assert.ok(anchor && Math.abs(anchor.x - 0.4) < 1e-9 && Math.abs(anchor.y - 0.2) < 1e-9);
  // A push-in zooms about the speaker too.
  const pushed = project([clip("a", 0, 6)]);
  pushed.plan = {
    model: "m",
    rationale: "",
    dropped: [],
    fit: { duration: 0, passes: 0 },
    emphasis: [{ start: 2 * SECOND, end: 3 * SECOND, text: "x", reason: "y" }],
  };
  assert.deepEqual(punchIns(pushed, framed(one)).main[0]?.framing?.anchor, { x: 0.3, y: 0.35 });
});

test("a screen recording keeps its jump cuts and its whole picture", () => {
  const edit = project([clip("a", 0, 2), clip("a", 3, 5), clip("a", 6, 9)]);
  edit.plan = {
    model: "m",
    rationale: "",
    dropped: [],
    fit: { duration: 0, passes: 0 },
    emphasis: [{ start: 3 * SECOND, end: 4 * SECOND, text: "x", reason: "y" }],
  };
  for (const layout of ["screen", "screen_cam"] as const) {
    const screen = faces(layout, layout === "screen" ? [] : [[0.8, 0.75, 0.15, 0.2]]);
    assert.deepEqual(scales(punchIns(edit, framed(screen))), [1, 1, 1], layout);
  }
});

test("a clip that runs on into a screen recording keeps its whole picture", () => {
  const camera = faces("talking_head", [[0.2, 0.2, 0.2, 0.3]]);
  const [shot] = camera.shots as [FramedShot];
  const split: FaceFraming = {
    ...camera,
    shots: [
      { ...shot, end: 5 },
      { start: 5, end: 20, layout: "screen", faces: [], speakers: [] },
    ],
  };
  // The second clip starts on camera after a jump cut and runs on into the screen at 5 s.
  const edit = project([clip("a", 0, 2), clip("a", 3, 12)]);
  edit.plan = {
    model: "m",
    rationale: "",
    dropped: [],
    fit: { duration: 0, passes: 0 },
    emphasis: [{ start: 4 * SECOND, end: 5 * SECOND, text: "x", reason: "y" }],
  };
  assert.deepEqual(scales(punchIns(edit, framed(split))), [1, 1]);
});
