// Renders every effect template over synthetic-corpus footage at 16:9 and 9:16, for reviewing
// the templates' design, with a strip of frames from each:
//
//   node scripts/effects-preview.ts <synthetic corpus> <folder>
//
// The corpus is `vebench synth` output analysed by vework (runs/vework/index.json per clip).
// Each edit runs a talking-head clip into a screen recording, with the wipe on the cut and the
// chapter marker and callout over the screen recording.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { catalog, type TemplateId } from "@video-editor/effects";
import type { MediaIndex, Project, Source } from "@video-editor/schema";
import { ffmpeg, run } from "../src/ffmpeg.ts";
import { QUIET } from "../src/graph/encode.ts";
import { render } from "../src/render.ts";
import { loadSources } from "../src/sources.ts";
import { buildTimeline } from "../src/timeline.ts";

const [corpusArg, folderArg] = process.argv.slice(2);
if (!corpusArg || !folderArg) {
  console.error("Usage: node scripts/effects-preview.ts <synthetic corpus> <folder>");
  process.exit(2);
}
const here = process.env.INIT_CWD ?? process.cwd();
const corpus = resolve(here, corpusArg);
const folder = resolve(here, folderArg);
await mkdir(folder, { recursive: true });
const SECOND = 120_000;

/** A corpus clip as a project source, with a copy of its index beside the project. */
async function source(clip: string): Promise<Source> {
  const path = join(corpus, clip, "source.mp4");
  const bytes = await readFile(path);
  const index = JSON.parse(
    await readFile(join(corpus, clip, "runs", "vework", "index.json"), "utf8"),
  ) as MediaIndex;
  // Indexes written before vework recorded colour tags, pixel shape and time zero: the synthetic
  // footage is untagged SDR MP4 with square pixels, which starts at 0.
  index.source.video = {
    transfer: null,
    matrix: null,
    sample_aspect: 1,
    ...index.source.video,
  } as never;
  index.source.start ??= 0;
  await writeFile(join(folder, `${clip}.index.json`), JSON.stringify(index));
  return {
    id: clip,
    kind: "video",
    path: relative(folder, path),
    index: `${clip}.index.json`,
    fingerprint: { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") },
  };
}

const s = (seconds: number) => Math.round(seconds * SECOND);
const overlay = (
  template: TemplateId,
  start: number,
  seconds = catalog[template].seconds.typical,
) => ({
  template,
  params: catalog[template].example,
  start: s(start),
  duration: s(seconds),
});

// The callout outlines the screen recording's "Output folder" field, which the 9:16 frame crops
// to its middle.
const edits = [
  {
    name: "16x9",
    aspect: "16:9",
    width: 1920,
    height: 1080,
    talk: "talk-a1",
    field: [0.266, 0.625],
  },
  { name: "9x16", aspect: "9:16", width: 1080, height: 1920, talk: "phone-c", field: [0.03, 0.94] },
] as const;

for (const edit of edits) {
  const sources = [await source(edit.talk), await source("screen-d")];
  const project: Project = {
    version: 1,
    output: {
      aspect: edit.aspect,
      width: edit.width,
      height: edit.height,
      fps: { num: 30, den: 1 },
      target: { duration: s(24), tolerance: 0.05 },
    },
    sources: sources as Project["sources"],
    main: [
      { source: edit.talk, in: s(10), out: s(22) },
      { source: "screen-d", in: s(6), out: s(18) },
    ],
    overlays: [
      overlay("title", 0.3),
      overlay("lower-third", 3.6),
      overlay("keyword", 8.4),
      overlay("wipe", 12 - 0.3),
      overlay("chapter", 12.4),
      {
        ...overlay("callout", 16.4),
        params: {
          ...catalog.callout.example,
          rect: { x: edit.field[0], y: 0.297, w: edit.field[1], h: 0.064 },
        },
      },
    ],
    audio: { loudness: { integratedLufs: -14, truePeakDbtp: -1 } },
  };
  const path = join(folder, `${edit.name}.project.json`);
  await writeFile(path, JSON.stringify(project, null, 2));
  const started = performance.now();
  const result = await render(path, join(folder, `${edit.name}.mp4`), {
    onProgress: (fraction, message) =>
      process.stderr.write(`${edit.name} ${Math.round(fraction * 100)}% ${message}\n`),
  });
  console.log(`${edit.name}: ${((performance.now() - started) / 1000).toFixed(1)} s`);

  // Frames from the entrance, the hold and the exit of each overlay, side by side.
  const timeline = buildTimeline(project, await loadSources(project, path));
  for (const { overlay, start, end } of timeline.overlays) {
    const length = end - start;
    const frames = [...new Set([2, 5, 9, Math.floor(length / 2), length - 6, length - 3])];
    const pick = frames.map((k) => `eq(n\\,${start + k})`).join("+");
    await run(await ffmpeg(), [
      ...QUIET,
      "-y",
      "-i",
      result.video,
      "-vf",
      `select='${pick}',scale=iw/3:-2,tile=${frames.length}x1:padding=6:color=white`,
      "-frames:v",
      "1",
      "-update",
      "1",
      join(folder, `${edit.name}-${overlay.template}.png`),
    ]);
  }
}
