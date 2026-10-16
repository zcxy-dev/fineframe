import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type CropPath,
  type FaceTrack,
  type FramedShot,
  type MediaIndex,
  type StaticCrop,
  validateMediaIndex,
  validateProject,
} from "@video-editor/schema";
import { CAMERA, cropPath } from "./framing.ts";
import { project, SECOND } from "./testing.ts";

const PORTRAIT = { width: 1080, height: 1920 };
const SQUARE = { width: 1080, height: 1080 };
const LANDSCAPE = { width: 1920, height: 1080 };
/** A 9:16 crop of a 16:9 source, as a share of the source's width. */
const NARROW = 9 / 16 / (16 / 9);

/** A media index for a source of `size` whose framing is `shots`. */
function indexOf(shots: FramedShot[], size = LANDSCAPE): MediaIndex {
  const end = Math.max(...shots.map((shot) => shot.end));
  return validateMediaIndex({
    version: 1,
    source: {
      name: "talk.mp4",
      duration: end,
      video: { ...size, fps: 25, rotation: 0, codec: "h264" },
      audio: [],
    },
    transitions: shots.slice(1).map((shot) => ({ start: shot.start, end: shot.start })),
    speech: [],
    transcript: { language: null, text: "", words: [] },
    framing: { fps: 5, shots },
  });
}

/** A face sampled five times a second over [from, to), centred where `at(t)` says. */
function face(id: number, from: number, to: number, at: (t: number) => number, y = 0.3): FaceTrack {
  const boxes = [];
  for (let k = Math.round(from * 5); k < Math.round(to * 5); k++) {
    const t = k / 5;
    boxes.push({ t, x: at(t) - 0.03, y, w: 0.06, h: 0.11 });
  }
  const [first, ...rest] = boxes;
  assert.ok(first);
  return { id, boxes: [first, ...rest] };
}

const clip = (from: number, to: number) => ({ in: from * SECOND, out: to * SECOND });

/** The crop's centre on its moving axis at a source time in ticks, as the renderer reads a path:
 * linear between keyframes, held before the first and after the last. */
function centre(crop: StaticCrop | CropPath | undefined, ticks: number, axis: "x" | "y" = "x") {
  assert.ok(crop);
  const middle = (rect: StaticCrop["rect"]) =>
    axis === "x" ? rect.x + rect.w / 2 : rect.y + rect.h / 2;
  if (crop.type === "static") return middle(crop.rect);
  const keys = crop.keyframes;
  const i = keys.findIndex((key) => key.t > ticks);
  const after = keys[i];
  const before = keys[i - 1];
  if (i < 0) return middle(keys[keys.length - 1]?.rect ?? crop.keyframes[0].rect);
  if (!before || !after) return middle(keys[0].rect);
  const f = (ticks - before.t) / (after.t - before.t);
  return middle(before.rect) + (middle(after.rect) - middle(before.rect)) * f;
}

/** The fastest the crop moves between two output frames at 30 fps, in crop widths per second. */
function topSpeed(crop: StaticCrop | CropPath | undefined, from: number, to: number) {
  let fastest = 0;
  for (let t = from * SECOND; t + 4000 <= to * SECOND; t += 4000) {
    const moved = Math.abs(centre(crop, t + 4000) - centre(crop, t)) / NARROW;
    fastest = Math.max(fastest, moved * 30);
  }
  return fastest;
}

test("a face that jitters inside the dead zone gets a still crop on it", () => {
  let seed = 7;
  const jitter = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647 - 0.5) * 0.02;
  };
  const shot: FramedShot = {
    start: 0,
    end: 10,
    layout: "talking_head",
    faces: [face(0, 0, 10, () => 0.3 + jitter())],
    speakers: [{ face: 0, start: 1, end: 9 }],
  };
  const crop = cropPath(indexOf([shot]), clip(0, 10), PORTRAIT);
  assert.equal(crop?.type, "static");
  assert.ok(Math.abs(centre(crop, 0) - 0.3) < 0.01);
  assert.ok(Math.abs((crop?.type === "static" ? crop.rect.w : 0) - NARROW) < 1e-5);
});

test("a two-shot too wide for the crop follows whoever speaks and cuts between them", () => {
  const shot: FramedShot = {
    start: 0,
    end: 8,
    layout: "two_shot",
    faces: [face(0, 0, 8, () => 0.25), face(1, 0, 8, () => 0.75)],
    speakers: [
      { face: 0, start: 0.5, end: 3 },
      { face: 1, start: 3.5, end: 6 },
    ],
  };
  const crop = cropPath(indexOf([shot]), clip(0, 8), PORTRAIT);
  assert.equal(crop?.type, "path");
  for (const t of [0.2, 2, 3.2])
    assert.ok(Math.abs(centre(crop, t * SECOND) - 0.25) < 0.01, `${t}`);
  // Held on the last speaker through the pause, and after the last span.
  for (const t of [3.6, 5, 7.9])
    assert.ok(Math.abs(centre(crop, t * SECOND) - 0.75) < 0.01, `${t}`);
  // The switch is a cut: no output frame shows a position between the two speakers.
  for (let t = 0; t < 8 * SECOND; t += 4000) {
    const x = centre(crop, t);
    assert.ok(Math.abs(x - 0.25) < 0.01 || Math.abs(x - 0.75) < 0.01, `${t / SECOND} s at ${x}`);
  }
});

test("a clip that ends where the camera cuts to the other speaker holds the first to its end", () => {
  const shot: FramedShot = {
    start: 0,
    end: 4,
    layout: "two_shot",
    faces: [face(0, 0, 4, () => 0.25), face(1, 0, 4, () => 0.75)],
    speakers: [
      { face: 0, start: 0, end: 2 },
      { face: 1, start: 2, end: 4 },
    ],
  };
  const crop = cropPath(indexOf([shot]), clip(0, 2), PORTRAIT);
  assert.equal(crop?.type, "static", JSON.stringify(crop));
  assert.ok(Math.abs(centre(crop, 0) - 0.25) < 0.01);
});

test("a quick reply does not move the camera off the person who holds the floor", () => {
  const shot: FramedShot = {
    start: 0,
    end: 8,
    layout: "two_shot",
    faces: [face(0, 0, 8, () => 0.25), face(1, 0, 8, () => 0.75)],
    speakers: [
      { face: 0, start: 0.5, end: 3 },
      { face: 1, start: 3, end: 4 },
      { face: 0, start: 4, end: 7 },
    ],
  };
  const crop = cropPath(indexOf([shot]), clip(0, 8), PORTRAIT);
  assert.equal(crop?.type, "static", JSON.stringify(crop));
  assert.ok(Math.abs(centre(crop, 0) - 0.25) < 0.01);
});

test("someone who talks in short phrases holds the floor like one long turn", () => {
  // Speech detection splits speech at a tenth of a second of silence, so a long turn can come
  // as phrases each shorter than a quick reply.
  const phrases = [0, 1, 2, 3, 4].map((k) => ({
    face: 1,
    start: 4.2 + 1.4 * k,
    end: 5.4 + 1.4 * k,
  }));
  const shot: FramedShot = {
    start: 0,
    end: 12,
    layout: "two_shot",
    faces: [face(0, 0, 12, () => 0.25), face(1, 0, 12, () => 0.75)],
    speakers: [{ face: 0, start: 0.5, end: 4 }, ...phrases],
  };
  const crop = cropPath(indexOf([shot]), clip(0, 12), PORTRAIT);
  assert.ok(Math.abs(centre(crop, 2 * SECOND) - 0.25) < 0.01);
  for (const t of [4.3, 6, 8.5, 11.9])
    assert.ok(Math.abs(centre(crop, t * SECOND) - 0.75) < 0.01, `${t}`);
});

test("quick replies a second or more apart do not move the camera", () => {
  const shot: FramedShot = {
    start: 0,
    end: 10,
    layout: "two_shot",
    faces: [face(0, 0, 10, () => 0.25), face(1, 0, 10, () => 0.75)],
    speakers: [
      { face: 0, start: 0.5, end: 3 },
      { face: 1, start: 3.2, end: 3.8 },
      { face: 1, start: 5, end: 5.6 },
      { face: 0, start: 7, end: 9.5 },
    ],
  };
  const crop = cropPath(indexOf([shot]), clip(0, 10), PORTRAIT);
  assert.equal(crop?.type, "static", JSON.stringify(crop));
  assert.ok(Math.abs(centre(crop, 0) - 0.25) < 0.01);
});

test("a speaker within reach is followed with an eased pan no faster than the camera", () => {
  const shot: FramedShot = {
    start: 0,
    end: 8,
    layout: "two_shot",
    faces: [face(0, 0, 8, () => 0.4), face(1, 0, 8, () => 0.6)],
    speakers: [
      { face: 0, start: 0, end: 3 },
      { face: 1, start: 3, end: 8 },
    ],
  };
  const crop = cropPath(indexOf([shot]), clip(0, 8), PORTRAIT);
  assert.ok(Math.abs(centre(crop, 2.9 * SECOND) - 0.4) < 0.002, "still before the switch");
  assert.ok(Math.abs(centre(crop, 5 * SECOND) - 0.6) < 0.01, "arrived two seconds later");
  assert.ok(topSpeed(crop, 0, 8) <= CAMERA.maxSpeed * 1.01);
  // Eased: the first frame after the switch moves far slower than the top speed.
  assert.ok(topSpeed(crop, 3, 3.04) < CAMERA.maxSpeed / 4);
  assert.ok(topSpeed(crop, 3, 5) > CAMERA.maxSpeed / 2);
});

test("a two-shot that fits in the crop keeps both faces in it", () => {
  const shot: FramedShot = {
    start: 0,
    end: 6,
    layout: "two_shot",
    faces: [face(0, 0, 6, () => 0.4), face(1, 0, 6, () => 0.6)],
    speakers: [
      { face: 0, start: 0, end: 3 },
      { face: 1, start: 3, end: 6 },
    ],
  };
  const crop = cropPath(indexOf([shot]), clip(0, 6), SQUARE);
  assert.equal(crop?.type, "static");
  const rect = crop?.type === "static" ? crop.rect : { x: 0, w: 0 };
  assert.ok(rect.x < 0.37 && rect.x + rect.w > 0.63, JSON.stringify(rect));
});

test("a group follows whoever speaks, unless everyone fits in the crop", () => {
  const group = (spread: number): FramedShot => ({
    start: 0,
    end: 8,
    layout: "group",
    faces: [-1, 0, 1].map((side, i) => face(i, 0, 8, () => 0.5 + side * spread)),
    speakers: [
      { face: 0, start: 0.5, end: 3 },
      { face: 2, start: 3.5, end: 6 },
    ],
  });
  const crop = cropPath(indexOf([group(0.3)]), clip(0, 8), PORTRAIT);
  for (const t of [1, 2.9]) assert.ok(Math.abs(centre(crop, t * SECOND) - 0.2) < 0.01, `${t}`);
  for (const t of [4, 7.9]) assert.ok(Math.abs(centre(crop, t * SECOND) - 0.8) < 0.01, `${t}`);
  const close = cropPath(indexOf([group(0.1)]), clip(0, 8), SQUARE);
  assert.equal(close?.type, "static");
  const rect = close?.type === "static" ? close.rect : { x: 0, w: 0 };
  assert.ok(rect.x < 0.37 && rect.x + rect.w > 0.63, JSON.stringify(rect));
});

test("a subject that runs is caught up with at the camera's top speed", () => {
  const at = (t: number) => (t < 2 ? 0.2 : t < 3 ? 0.2 + 0.6 * (t - 2) : 0.8);
  const shot: FramedShot = {
    start: 0,
    end: 8,
    layout: "talking_head",
    faces: [face(0, 0, 8, at)],
    speakers: [],
  };
  const crop = cropPath(indexOf([shot]), clip(0, 8), PORTRAIT);
  const fastest = topSpeed(crop, 0, 8);
  assert.ok(fastest <= CAMERA.maxSpeed * 1.01 && fastest > CAMERA.maxSpeed * 0.95, `${fastest}`);
  assert.ok(Math.abs(centre(crop, 7 * SECOND) - 0.8) < 0.01);
});

test("each shot is framed on its own, with a cut where the shot changes", () => {
  const shots: FramedShot[] = [
    { start: 0, end: 4, layout: "talking_head", faces: [face(0, 0, 4, () => 0.2)], speakers: [] },
    { start: 4, end: 8, layout: "talking_head", faces: [face(1, 4, 8, () => 0.7)], speakers: [] },
  ];
  const crop = cropPath(indexOf(shots), clip(1, 7), PORTRAIT);
  assert.ok(Math.abs(centre(crop, 4 * SECOND - 1) - 0.2) < 1e-6);
  assert.ok(Math.abs(centre(crop, 4 * SECOND) - 0.7) < 1e-6);
});

test("a shot of no length between two others changes nothing", () => {
  const shots: FramedShot[] = [
    { start: 0, end: 2, layout: "talking_head", faces: [face(0, 0, 2, () => 0.2)], speakers: [] },
    { start: 2, end: 2, layout: "screen", faces: [], speakers: [] },
    { start: 2, end: 4, layout: "talking_head", faces: [face(1, 2, 4, () => 0.8)], speakers: [] },
  ];
  const crop = cropPath(indexOf(shots), clip(0, 4), PORTRAIT);
  for (const t of [0, 1, 1.99]) assert.ok(Math.abs(centre(crop, t * SECOND) - 0.2) < 1e-6, `${t}`);
  assert.ok(Math.abs(centre(crop, 2 * SECOND) - 0.8) < 1e-6);
});

test("screens and a webcam over a screen keep a still crop in the middle", () => {
  for (const layout of ["screen", "screen_cam"] as const) {
    const shot: FramedShot = {
      start: 0,
      end: 5,
      layout,
      faces: layout === "screen_cam" ? [face(0, 0, 5, () => 0.9, 0.8)] : [],
      speakers: [],
    };
    const crop = cropPath(indexOf([shot]), clip(0, 5), PORTRAIT);
    assert.equal(crop?.type, "static");
    assert.ok(Math.abs(centre(crop, 0) - 0.5) < 1e-6);
  }
});

test("a portrait source in a landscape box moves up and down, with room above the face", () => {
  const shot: FramedShot = {
    start: 0,
    end: 4,
    layout: "talking_head",
    faces: [face(0, 0, 4, () => 0.5, 0.3 - 0.055)],
    speakers: [],
  };
  const crop = cropPath(indexOf([shot], PORTRAIT), clip(0, 4), LANDSCAPE);
  assert.equal(crop?.type, "static");
  const rect = crop?.type === "static" ? crop.rect : { x: 1, y: 0, w: 0, h: 0 };
  assert.equal(rect.x, 0);
  assert.equal(rect.w, 1);
  // The face's centre, at 0.3 of the source's height, sits 40 % of the way down the crop.
  assert.ok(Math.abs((0.3 - rect.y) / rect.h - 0.4) < 0.01, JSON.stringify(rect));
});

test("there is no crop without framing, or when the box has the source's shape", () => {
  const shot: FramedShot = { start: 0, end: 2, layout: "screen", faces: [], speakers: [] };
  assert.equal(cropPath(indexOf([shot]), clip(0, 2), LANDSCAPE), undefined);
  const { framing: _, ...unframed } = indexOf([shot]);
  assert.equal(cropPath(unframed, clip(0, 2), PORTRAIT), undefined);
});

test("a source with non-square pixels is cropped by its shape as displayed", () => {
  const shot: FramedShot = { start: 0, end: 2, layout: "screen", faces: [], speakers: [] };
  // HDV: 1440 × 1080 with 4:3 pixels, shown as 16:9.
  const hdv = { ...LANDSCAPE, width: 1440, sample_aspect: 4 / 3 };
  const crop = cropPath(indexOf([shot], hdv), clip(0, 2), PORTRAIT);
  assert.ok(crop?.type === "static" && Math.abs(crop.rect.w - NARROW) < 1e-6, JSON.stringify(crop));
  assert.equal(cropPath(indexOf([shot], hdv), clip(0, 2), LANDSCAPE), undefined);
});

test("clips cut from one shot frame it the same way, as a valid project crop", () => {
  const shot: FramedShot = {
    start: 0,
    end: 10,
    layout: "two_shot",
    faces: [face(0, 0, 10, () => 0.4), face(1, 0, 10, (t) => 0.55 + 0.01 * t)],
    speakers: [
      { face: 0, start: 1, end: 4 },
      { face: 1, start: 4.2, end: 9 },
    ],
  };
  const index = indexOf([shot]);
  const whole = cropPath(index, clip(0, 10), PORTRAIT);
  const part = cropPath(index, clip(3.5, 7.3), PORTRAIT);
  for (let t = 3.5 * SECOND; t < 7.3 * SECOND; t += 4000) {
    assert.ok(Math.abs(centre(whole, t) - centre(part, t)) < 0.001, `${t / SECOND}`);
  }
  assert.ok(part?.type === "path");
  const keyframes = part.keyframes;
  assert.equal(keyframes[0].t, 3.5 * SECOND);
  assert.equal(keyframes.at(-1)?.t, 7.3 * SECOND);
  const edit = project([{ source: "a", ...clip(3.5, 7.3), framing: { crop: part } }]);
  edit.output = { ...edit.output, aspect: "9:16", width: 720, height: 1280 };
  validateProject(edit);
});
