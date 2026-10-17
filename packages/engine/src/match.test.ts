import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { Framing, Grade, Project } from "@video-editor/schema";
import { makeSource, projectOf } from "./fixtures.ts";
import { type ColourSample, MAX_RESIDUAL, matchColour, matchProblem, solveMatch } from "./match.ts";
import { SECOND, scratch } from "./testing.ts";

/** A small deterministic generator, so the scenes are the same on every run. */
function random(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ColorChecker colours, roughly, in 8-bit R'G'B'.
const CHART = [
  [115, 82, 68], [194, 150, 130], [98, 122, 157], [87, 108, 67], [133, 128, 177], [103, 189, 170],
  [214, 126, 44], [80, 91, 166], [193, 90, 99], [94, 60, 108], [157, 188, 64], [224, 163, 46],
  [56, 61, 150], [70, 148, 73], [175, 54, 60], [231, 199, 31], [187, 86, 149], [8, 133, 161],
  [243, 243, 242], [200, 200, 200], [160, 160, 160], [122, 122, 121], [85, 85, 85], [52, 52, 52],
]; // biome-ignore format: a table

/** A scene's pixels as floats: chart colours with a little noise, and blends between them. */
function scene(pixels: number, seed: number): number[][] {
  const next = random(seed);
  const pick = () => CHART[Math.floor(next() * CHART.length)] as number[];
  return Array.from({ length: pixels }, () => {
    const a = pick();
    const b = pick();
    const t = next() < 0.5 ? 0 : next();
    return a.map((v, c) => ((1 - t) * v + t * (b[c] as number) + (next() - 0.5) * 4) / 255);
  });
}

interface Camera {
  /** White balance, as linear-light gains. */
  balance: [number, number, number];
  stops: number;
  saturation: number;
  contrast: number;
}

/** A camera's rendering of the scene: white balance and exposure in linear light, then its
 * colour matrix and tone, clipped and quantised to 8 bits as it records. */
function shoot(pixels: number[][], camera: Camera): ColourSample {
  const out = new Uint8Array(pixels.length * 3);
  for (const [i, rgb] of pixels.entries()) {
    const balanced = rgb.map(
      (v, c) =>
        (Math.max(0, v) ** 2.4 * (camera.balance[c] as number) * 2 ** camera.stops) ** (1 / 2.4),
    );
    const luma =
      0.2126 * (balanced[0] ?? 0) + 0.7152 * (balanced[1] ?? 0) + 0.0722 * (balanced[2] ?? 0);
    for (const [c, v] of balanced.entries()) {
      const saturated = luma + camera.saturation * (v - luma);
      const toned = 0.5 + camera.contrast * (saturated - 0.5);
      out[i * 3 + c] = Math.round(Math.min(1, Math.max(0, toned)) * 255);
    }
  }
  return out;
}

const neutral: Camera = { balance: [1, 1, 1], stops: 0, saturation: 1, contrast: 1 };

/** The mean difference, in 8-bit levels, between the matched source and the reference, pixel by
 * pixel: they show the same scene. */
function error(source: ColourSample, reference: ColourSample, fit: ReturnType<typeof solveMatch>) {
  let sum = 0;
  for (let i = 0; i < source.length; i += 3) {
    for (let c = 0; c < 3; c++) {
      const row = fit.matrix[c as 0 | 1 | 2];
      const v =
        row[0] * ((source[i] ?? 0) / 255) +
        row[1] * ((source[i + 1] ?? 0) / 255) +
        row[2] * ((source[i + 2] ?? 0) / 255) +
        fit.offset[c as 0 | 1 | 2];
      sum += Math.abs(Math.min(1, Math.max(0, v)) * 255 - (reference[i + c] ?? 0));
    }
  }
  return sum / source.length;
}

test("a camera's white balance, exposure, saturation and contrast are undone", () => {
  const pixels = scene(20_000, 1);
  const reference = shoot(pixels, neutral);
  const cameras: Camera[] = [
    { balance: [1.18, 1, 0.8], stops: -0.4, saturation: 1, contrast: 1 },
    { balance: [0.88, 1, 1.15], stops: 0.3, saturation: 0.9, contrast: 0.85 },
    { balance: [1, 1.06, 1], stops: 0, saturation: 1.2, contrast: 1.12 },
  ];
  for (const camera of cameras) {
    const source = shoot(pixels, camera);
    const fit = solveMatch(source, reference);
    const at = JSON.stringify(camera);
    assert.equal(matchProblem(fit), null, at);
    assert.ok(fit.residual < 0.01, `${at}: residual ${fit.residual}`);
    // Before: several levels off on average; after, about one, from rounding and clipping.
    assert.ok(
      error(source, reference, {
        ...fit,
        matrix: [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
        offset: [0, 0, 0],
      }) > 5,
    );
    assert.ok(
      error(source, reference, fit) < 1.5,
      `${at}: ${error(source, reference, fit)} levels`,
    );
    assert.ok(Math.abs(fit.saturation - 1 / camera.saturation) < 0.03, `${at}: ${fit.saturation}`);
  }
});

test("sources that show different things are left as they are", () => {
  const talk = shoot(scene(20_000, 2), neutral);
  // A screen recording: a white page, dark text and a blue bar.
  const next = random(3);
  const screen = new Uint8Array(20_000 * 3).map((_, i) => {
    const pixel = Math.floor(i / 3);
    const kind = (pixel * 7919) % 100;
    const c = i % 3;
    if (kind < 80) return 246 + Math.round(next() * 3);
    if (kind < 95) return 34;
    return [30, 90, 200][c] as number;
  });
  const fit = solveMatch(screen, talk);
  assert.ok(fit.residual > MAX_RESIDUAL, String(fit.residual));
  assert.match(matchProblem(fit) ?? "", /show different things/);
});

test("every main-track source is matched to the one the edit uses longest", async (t) => {
  const dir = await scratch(t, "match-");
  const spec = { pattern: "testsrc2", width: 160, height: 90, fps: 30, seconds: 1, sound: null };
  const a = await makeSource(dir, { ...spec, id: "a" });
  // The same picture through a warmer, darker camera, and once more unchanged.
  const b = await makeSource(dir, {
    ...spec,
    id: "b",
    filter: "colorchannelmixer=rr=0.92:gg=0.85:bb=0.75",
  });
  const c = await makeSource(dir, { ...spec, id: "c" });
  const whole = (source: string) => ({ source, in: 0, out: SECOND });
  const project = projectOf(
    [a, b, c],
    [
      whole("a"),
      { ...whole("b"), grade: { look: { id: "warm", intensity: 1 } } },
      whole("c"),
      whole("a"),
    ],
    { aspect: "16:9", width: 160, height: 90, fps: { num: 30, den: 1 } },
  );
  const path = join(dir, "project.json");
  await writeFile(path, JSON.stringify(project));
  const samples = new Map<string, ColourSample>();
  const { project: matched, reports } = await matchColour(project, path, samples);
  assert.deepEqual(
    reports.map((report) => [report.source, report.reference, report.problem]),
    [
      ["b", "a", null],
      ["c", "a", null],
    ],
  );
  const [first, second, third] = matched.main;
  assert.equal(first?.grade, undefined);
  assert.equal(second?.grade?.match?.reference, "a");
  assert.deepEqual(second?.grade?.look, { id: "warm", intensity: 1 });
  // Undoing the mixer: about 1/0.92, 1/0.85 and 1/0.75 on the diagonal.
  const diagonal = second?.grade?.match?.matrix.map((row, i) => row[i as 0 | 1 | 2]) ?? [];
  for (const [i, expected] of [1 / 0.92, 1 / 0.85, 1 / 0.75].entries()) {
    assert.ok(Math.abs((diagonal[i] ?? 0) - expected) < 0.05, `${diagonal}`);
  }
  // c is a itself, so there is nothing to match.
  assert.equal(third?.grade, undefined);
  // Each distinct clip is measured once, and a second run measures nothing again.
  assert.equal(samples.size, 3);
  await matchColour(matched, path, samples);
  assert.equal(samples.size, 3);
  // A different output frames the clips differently, so they are measured again.
  const portrait = {
    ...matched,
    output: { ...matched.output, aspect: "9:16", width: 90, height: 160 },
  };
  await matchColour(portrait as Project, path, samples);
  assert.equal(samples.size, 6);
});

test("B-roll from a matched source carries its match", async (t) => {
  const dir = await scratch(t, "match-broll-");
  const spec = { pattern: "testsrc2", width: 160, height: 90, fps: 30, seconds: 2, sound: null };
  const a = await makeSource(dir, { ...spec, id: "a" });
  const b = await makeSource(dir, {
    ...spec,
    id: "b",
    filter: "colorchannelmixer=rr=0.92:gg=0.85:bb=0.75",
  });
  const project = projectOf(
    [a, b],
    [
      { source: "a", in: 0, out: 2 * SECOND },
      { source: "b", in: 0, out: SECOND },
    ],
    { aspect: "16:9", width: 160, height: 90, fps: { num: 30, den: 1 } },
  );
  project.broll = [
    {
      source: "b",
      in: SECOND,
      out: 2 * SECOND,
      start: 0,
      grade: {
        match: {
          reference: "a",
          matrix: [
            [1, 0, 0],
            [0, 1, 0],
            [0, 0, 1],
          ],
          offset: [0.5, 0, 0],
        },
      },
    },
    { source: "a", in: 0, out: SECOND, start: SECOND },
  ];
  const path = join(dir, "project.json");
  await writeFile(path, JSON.stringify(project));
  const { project: matched } = await matchColour(project, path);
  const match = matched.main[1]?.grade?.match;
  assert.ok(match);
  assert.deepEqual(matched.broll?.[0]?.grade?.match, match);
  assert.equal(matched.broll?.[1]?.grade, undefined);
});

test("clips whose framing follows a crop path are measured", async (t) => {
  const dir = await scratch(t, "match-path-");
  const spec = { pattern: "testsrc2", width: 160, height: 90, fps: 30, seconds: 1, sound: null };
  const a = await makeSource(dir, { ...spec, id: "a" });
  const b = await makeSource(dir, {
    ...spec,
    id: "b",
    filter: "colorchannelmixer=rr=0.92:gg=0.85:bb=0.75",
  });
  // A virtual camera that pans across the frame, as face framing writes it.
  const pan: Framing = {
    crop: {
      type: "path",
      keyframes: [
        { t: 0, rect: { x: 0, y: 0, w: 0.8, h: 0.8 } },
        { t: SECOND, rect: { x: 0.2, y: 0.2, w: 0.8, h: 0.8 } },
      ],
    },
  };
  const project = projectOf(
    [a, b],
    [
      { source: "a", in: 0, out: SECOND, framing: pan },
      { source: "b", in: 0, out: SECOND / 2, framing: pan },
    ],
    { aspect: "16:9", width: 160, height: 90, fps: { num: 30, den: 1 } },
  );
  const path = join(dir, "project.json");
  await writeFile(path, JSON.stringify(project));
  const { reports } = await matchColour(project, path);
  assert.deepEqual(
    reports.map((report) => [report.source, report.reference]),
    [["b", "a"]],
  );
});

test("an edit from one source is not measured", async (t) => {
  const dir = await scratch(t, "match-one-");
  const spec = { pattern: "testsrc2", width: 160, height: 90, fps: 30, seconds: 1, sound: null };
  const a = await makeSource(dir, { ...spec, id: "a" });
  const stale: Grade["match"] = {
    reference: "b",
    matrix: [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ],
    offset: [0.1, 0, 0],
  };
  const project = projectOf([a], [{ source: "a", in: 0, out: SECOND, grade: { match: stale } }], {
    aspect: "16:9",
    width: 160,
    height: 90,
    fps: { num: 30, den: 1 },
  }) as Project;
  const path = join(dir, "project.json");
  await writeFile(path, JSON.stringify(project));
  const samples = new Map<string, ColourSample>();
  const { project: matched, reports } = await matchColour(project, path, samples);
  assert.equal(samples.size, 0);
  assert.deepEqual(reports, []);
  assert.equal(matched.main[0]?.grade, undefined);
});
