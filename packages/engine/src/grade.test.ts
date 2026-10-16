import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { ffmpeg, run } from "./ffmpeg.ts";
import { makeSource, projectOf } from "./fixtures.ts";
import { autoGrade, gradeFromStats, parseSignalstats } from "./grade.ts";
import { SECOND, scratch } from "./testing.ts";

const frame = (avg: number, min: number, max: number, sat: number, depth = 8) =>
  `frame:0    pts:0       pts_time:0\nlavfi.signalstats.YMIN=${min}\nlavfi.signalstats.YAVG=${avg}\n` +
  `lavfi.signalstats.YMAX=${max}\nlavfi.signalstats.UAVG=1\nlavfi.signalstats.SATAVG=${sat}\n` +
  `lavfi.signalstats.YBITDEPTH=${depth}\n`;

test("signalstats of 8-bit frames are averaged over frames and scaled to 0..1", () => {
  const stats = parseSignalstats(frame(100, 10, 200, 50) + frame(155, 30, 240, 70));
  assert.ok(stats);
  assert.ok(Math.abs(stats.luma - 127.5 / 255) < 1e-9);
  assert.ok(Math.abs(stats.range - 200 / 255) < 1e-9);
  assert.ok(Math.abs(stats.saturation - 60 / 255) < 1e-9);
  assert.equal(parseSignalstats(""), null);
});

test("dark frames stay dark: YBITDEPTH counts the bits in use, not the format's depth", () => {
  // signalstats reports 7 bits for a frame whose luma never reaches 128.
  const stats = parseSignalstats(frame(61.6, 16, 115, 10, 7));
  assert.ok(Math.abs((stats?.luma ?? 0) - 61.6 / 255) < 1e-9);
});

test("the auto grade lifts dark, flat footage and holds balanced footage near neutral", () => {
  assert.deepEqual(gradeFromStats({ luma: 0.48, range: 0.75, saturation: 0.25 }), {
    contrast: 1.03,
    gamma: 1,
    saturation: 0.98,
  });
  assert.deepEqual(gradeFromStats({ luma: 0.2, range: 0.4, saturation: 0.1 }), {
    contrast: 1.08,
    gamma: 1.1,
    saturation: 1.04,
  });
  assert.deepEqual(gradeFromStats({ luma: 0.36, range: 0.575, saturation: 0.5 }), {
    contrast: 1.055,
    gamma: 1.06,
    saturation: 0.96,
  });
  assert.equal(gradeFromStats({ luma: 0.7, range: 0.8, saturation: 0.3 }).gamma, 0.97);
});

test("autoGrade measures each clip and writes grade.auto, keeping the rest of the grade", async (t) => {
  const dir = await scratch(t, "grade-");
  const dark = await makeSource(dir, {
    id: "dark",
    pattern: "testsrc2",
    width: 160,
    height: 90,
    fps: 30,
    seconds: 2,
    sound: null,
    dark: true,
  });
  const project = projectOf(
    [dark],
    [{ source: "dark", in: 0, out: SECOND, grade: { look: { id: "clean", intensity: 0.5 } } }],
    { aspect: "16:9", width: 160, height: 90, fps: { num: 30, den: 1 } },
  );
  const path = join(dir, "project.json");
  await writeFile(path, JSON.stringify(project));
  const graded = await autoGrade(project, path);
  const grade = graded.main[0].grade;
  assert.deepEqual(grade?.look, { id: "clean", intensity: 0.5 });
  assert.ok(grade?.auto && grade.auto.gamma > 1, JSON.stringify(grade));
  assert.ok(grade.auto.contrast > 1.03, JSON.stringify(grade));
});

test("autoGrade measures a still image too", async (t) => {
  const dir = await scratch(t, "grade-still-");
  const path = join(dir, "dark.png");
  await run(await ffmpeg(), [
    ...["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=160x90,eq=brightness=-0.2:contrast=0.5"],
    ...["-frames:v", "1", path],
  ]);
  const bytes = await readFile(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const project = projectOf(
    [{ id: "dark", kind: "image", path: "dark.png", fingerprint: { bytes: bytes.length, sha256 } }],
    [{ source: "dark", in: 0, out: SECOND }],
    { aspect: "16:9", width: 160, height: 90, fps: { num: 30, den: 1 } },
  );
  const graded = await autoGrade(project, join(dir, "project.json"));
  const grade = graded.main[0].grade;
  assert.ok(grade?.auto && grade.auto.gamma > 1, JSON.stringify(grade));
});
