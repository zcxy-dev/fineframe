// Exports a synthetic edit end to end with the pinned FFmpeg and ffprobe.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { Project, Source } from "@video-editor/schema";
import { ffmpeg, QUIET, run } from "../ffmpeg.ts";
import { makeSource, projectOf } from "../fixtures.ts";
import { SECOND, scratch } from "../testing.ts";
import { exportEdit } from "./export.ts";

/** A VP9 overlay of `frames` frames, opaque white on its left half and clear on its right. */
async function halfWhite(file: string, frames: number, width: number, height: number) {
  await run(await ffmpeg(), [
    ...QUIET,
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=white:s=${width}x${height}:r=30`,
    "-vf",
    "format=yuva420p,geq=lum='p(X,Y)':cb=128:cr=128:a='if(lt(X,W/2),255,0)',setparams=colorspace=bt709:range=tv",
    "-frames:v",
    String(frames),
    "-c:v",
    "libvpx-vp9",
    "-lossless",
    "1",
    file,
  ]);
  return file;
}

/** An opaque grey VP9 graphic of `frames` frames, as a full-frame graphic renders. */
async function opaque(file: string, frames: number, width: number, height: number) {
  await run(await ffmpeg(), [
    ...QUIET,
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=gray:s=${width}x${height}:r=30`,
    "-frames:v",
    String(frames),
    "-c:v",
    "libvpx-vp9",
    file,
  ]);
  return file;
}

/** A file source, fingerprinted, that needs no media index: music, or an image. */
async function plain(dir: string, id: string, name: string, kind: Source["kind"], input: string[]) {
  const path = join(dir, name);
  await run(await ffmpeg(), [...QUIET, "-y", ...input, path]);
  const bytes = await readFile(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { id, kind, path: name, fingerprint: { bytes: bytes.length, sha256 } } as Source;
}

/** Each frame's alpha, `width` × `height`, as the overlay video decodes. */
async function alpha(file: string, width: number, height: number): Promise<Uint8Array[]> {
  const raw = `${file}.alpha`;
  await run(await ffmpeg(), [
    ...QUIET,
    "-y",
    "-i",
    file,
    "-vf",
    "alphaextract,format=gray",
    "-f",
    "rawvideo",
    raw,
  ]);
  const bytes = await readFile(raw);
  const size = width * height;
  return Array.from({ length: bytes.length / size }, (_, n) =>
    bytes.subarray(n * size, (n + 1) * size),
  );
}

test("an edit exports its timelines, its captions, the files they play and its overlay", async (t) => {
  const dir = await scratch(t, "export-");
  const speaker = await makeSource(dir, {
    id: "speaker",
    pattern: "testsrc2",
    width: 64,
    height: 36,
    fps: 30,
    seconds: 6,
    sound: 220,
  });
  const music = await plain(dir, "music", "配樂 一.wav", "audio", [
    "-f",
    "lavfi",
    "-i",
    "sine=f=330:sample_rate=48000:d=8",
  ]);
  const page = await plain(dir, "page", "page.png", "image", [
    "-f",
    "lavfi",
    "-i",
    "smptebars=s=64x36",
    "-frames:v",
    "1",
  ]);
  page.credit = { what: "Screenshot of example.com", source: "https://example.com" };
  const project: Project = projectOf(
    [speaker, music, page],
    [
      { source: "speaker", in: 0, out: 2 * SECOND },
      { source: "speaker", in: 3 * SECOND, out: 5 * SECOND },
    ],
    { aspect: "16:9", width: 64, height: 36, fps: { num: 30, den: 1 } },
  );
  project.broll = [{ source: "page", in: 0, out: SECOND, start: SECOND }];
  project.graphics = [
    {
      layout: "label",
      html: "<b>1</b>",
      css: "",
      box: { x: 0, y: 0, w: 0.5, h: 0.5 },
      start: SECOND,
      duration: SECOND,
    },
    { layout: "full", html: "<b>2</b>", css: "", start: 2.5 * SECOND, duration: SECOND / 2 },
  ];
  project.audio.music = [
    {
      source: "music",
      license: { name: "CC0 1.0" },
      in: 0,
      out: 4 * SECOND,
      start: 0,
      gainDb: -12,
    },
  ];
  project.captions = {
    preset: "bold",
    srt: true,
    lines: [{ start: SECOND / 2, end: SECOND, language: "en", text: "Hello" }],
  };
  const path = join(dir, "edit.project.json");
  await writeFile(path, JSON.stringify(project));
  const out = join(dir, "export");
  const result = await exportEdit(path, out, {
    renderGraphics: async (jobs) => {
      assert.deepEqual(
        jobs.map((job) => [job.layout, job.box?.width, job.box?.height, job.frames]),
        [
          ["label", 32, 18, 30],
          ["full", undefined, undefined, 15],
        ],
      );
      return [
        await halfWhite(join(dir, "label.webm"), 30, 32, 18),
        await opaque(join(dir, "full.webm"), 15, 64, 36),
      ];
    },
  });
  assert.equal(result.folder, out);
  assert.deepEqual((await readdir(out)).sort(), [
    "README.txt",
    "edit.fcpxml",
    "edit.srt",
    "edit.xml",
    "media",
  ]);
  assert.deepEqual((await readdir(join(out, "media"))).sort(), [
    "overlay.mov",
    "page.png",
    "配樂 一.wav",
  ]);
  assert.match(await readFile(join(out, "edit.srt"), "utf8"), /Hello/);

  // The label on frames 30-59 at its box's left half, and the full-frame graphic, opaque, over
  // frames 75-89 once it has slid in; transparency everywhere else.
  const frames = await alpha(join(out, "media", "overlay.mov"), 64, 36);
  assert.equal(frames.length, 120);
  for (const [n, frame] of frames.entries()) {
    const label = frame[5 * 64 + 8] ?? 0;
    const beside = frame[5 * 64 + 24] ?? 0;
    const below = frame[30 * 64 + 8] ?? 0;
    if (n >= 85 && n < 90) {
      assert.ok(Math.min(label, beside, below) > 250, `frame ${n}: the full-frame graphic`);
    } else if (n < 75 || n >= 90) {
      if (n >= 30 && n < 60) assert.ok(label > 250, `frame ${n}: the label (${label})`);
      else assert.ok(label < 5, `frame ${n}: clear (${label})`);
      assert.ok(beside < 5 && below < 5, `frame ${n}: clear around the label`);
    }
  }

  // Every file each timeline names is the footage where it is, or a copy beside it.
  for (const name of ["edit.fcpxml", "edit.xml"]) {
    const text = await readFile(join(out, name), "utf8");
    const urls = [...text.matchAll(/(?:src="|<pathurl>)([^"<]+)/g)].map((m) => m[1]);
    assert.deepEqual(
      [...new Set(urls)].sort(),
      [
        `file://${name.endsWith(".xml") ? "localhost" : ""}${encodeURI(join(dir, "speaker.mp4"))}`,
        "media/%E9%85%8D%E6%A8%82%20%E4%B8%80.wav",
        "media/overlay.mov",
        "media/page.png",
      ].sort(),
      name,
    );
  }
});

test("an export refuses a folder that holds anything", async (t) => {
  const dir = await scratch(t, "export-full-");
  await writeFile(join(dir, "keep.txt"), "mine");
  await assert.rejects(exportEdit(join(dir, "missing.project.json"), dir), /not empty/);
});
