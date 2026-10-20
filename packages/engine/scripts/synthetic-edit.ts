// Renders synthetic edits for vebench, until a hand-checked corpus exists:
//
//   node scripts/synthetic-edit.ts <folder> [--width 1280 --height 720]
//   cd ../../bench && uv run vebench report <folder>
//
// Sources: test patterns at 24, 25, 30 and 60 fps, a variable-rate one, a rotated phone clip,
// 10-bit HDR (PQ), one without an audio stream and one with a silent track, each with its own
// tone so every cut splices two different waveforms.
// - hard-cuts/: 14 clips joined by cuts, rendered by the engine, by the engine with effect
//   overlays across the cuts, and by encoding each clip on its own and joining the files with
//   `-c copy`.
// - transitions/: dissolves, dips, B-roll, framing and auto grade, rendered by the engine.
// - finishing/: the hard cuts again under what the planner adds on top of them: punch-ins,
//   push-ins, a colour match and a look, rendered by the engine.

import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { catalog, type TemplateId } from "@video-editor/effects";
import type { Project, Source } from "@video-editor/schema";
import { ffmpeg, QUIET, run } from "../src/ffmpeg.ts";
import { everyKind, makeSource, projectOf, type SyntheticSpec } from "../src/fixtures.ts";
import { autoGrade } from "../src/grade.ts";
import { render } from "../src/render.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { width: { type: "string" }, height: { type: "string" } },
});
if (positionals.length !== 1) {
  console.error("Usage: node scripts/synthetic-edit.ts <folder> [--width 1280 --height 720]");
  process.exit(2);
}
const folder = resolve(process.env.INIT_CWD ?? process.cwd(), positionals[0] as string);
const width = Number(values.width ?? 1280);
const height = Number(values.height ?? 720);
const fps = { num: 30, den: 1 };
const SECOND = 120_000;

const specs = everyKind(width, height, 12);

const media = join(folder, "media");
await mkdir(media, { recursive: true });
const sources: Source[] = [];
for (const spec of specs) sources.push(await makeSource(media, spec));

/** A clip of `seconds` from `at` seconds into the nth source. */
const clip = (n: number, at: number, seconds: number): Project["main"][number] => ({
  source: (sources[n] as Source).id,
  in: Math.round(at * SECOND),
  out: Math.round((at + seconds) * SECOND),
});

// Odd starts and lengths, so cuts fall between frames of every source rate.
const cuts = [
  clip(0, 1.013, 1.37),
  clip(1, 2.21, 0.93),
  clip(2, 0.517, 1.12),
  clip(3, 3.33, 0.81),
  clip(4, 1.7, 1.24),
  clip(5, 4.05, 1.06),
  clip(6, 2.6, 0.97),
  clip(7, 5.5, 0.88),
  clip(0, 6.31, 1.19),
  clip(8, 3.9, 0.74),
  clip(1, 7.77, 1.31),
  clip(2, 8.2, 0.66),
  clip(3, 9.15, 1.02),
  clip(5, 9.9, 1.15),
] as Project["main"];

const transitions = [
  clip(0, 1, 2),
  { ...clip(4, 2, 2), transition: { type: "dissolve", duration: SECOND / 2 } },
  { ...clip(6, 3, 2), transition: { type: "dip", duration: SECOND / 2, color: "#000000" } },
  {
    ...clip(1, 4, 2),
    framing: { crop: { type: "static", rect: { x: 0.25, y: 0.1, w: 0.5, h: 0.8 } }, scale: 1.12 },
  },
  { ...clip(5, 5, 2), transition: { type: "dissolve", duration: SECOND / 3 } },
  clip(2, 6, 1.5),
] as Project["main"];

// A push-in across every third clip, a punch-in on every other one, the clean look on all, and
// one source matched to another.
const finishing = cuts.map((item, i) => {
  const scale =
    i % 3 === 1
      ? {
          type: "path",
          keyframes: [
            { t: item.in, scale: 1 },
            { t: item.out, scale: 1.06 },
          ],
        }
      : i % 2 === 1
        ? 1.12
        : undefined;
  const match = {
    reference: "a30",
    matrix: [
      [1.05, 0, 0],
      [0, 1, 0],
      [0, 0, 0.92],
    ],
    offset: [0, 0, 0.01],
  };
  return {
    ...item,
    ...(scale ? { framing: { scale } } : {}),
    grade: { look: { id: "clean", intensity: 1 }, ...(item.source === "b25" ? { match } : {}) },
  };
}) as Project["main"];

const output = { aspect: "16:9", width, height, fps } as const;

async function engine(name: string, main: Project["main"], extra: Partial<Project> = {}) {
  const dir = join(folder, name);
  await mkdir(join(dir, "truth"), { recursive: true });
  const base = projectOf(sources, main, output);
  const project = {
    ...base,
    ...extra,
    sources: base.sources.map((source) => ({
      ...source,
      path: relative(dir, join(media, source.path)),
      index: relative(dir, join(media, source.index ?? "")),
    })),
  } as Project;
  const path = join(dir, "project.json");
  await writeFile(path, JSON.stringify(await autoGrade(project, path), null, 2));
  const started = Date.now();
  const result = await render(path, join(dir, "runs", "engine", "output.mp4"));
  console.log(`${name}: engine ${((Date.now() - started) / 1000).toFixed(1)} s`, result);
  return project;
}

/** The edit again with every effect template over it, the wipe centred on its eighth cut. */
async function withEffects(name: string, project: Project) {
  const dir = join(folder, name);
  const cut = project.main.slice(0, 8).reduce((sum, clip) => sum + clip.out - clip.in, 0) / SECOND;
  const at = (template: TemplateId, start: number) => ({
    template,
    params: catalog[template].example,
    start: Math.round(start * SECOND),
    duration: Math.round(catalog[template].seconds.typical * SECOND),
  });
  const overlays = [
    at("title", 0.2),
    at("lower-third", 4.8),
    at("wipe", cut - catalog.wipe.seconds.typical / 2),
    at("chapter", 8.8),
    at("callout", 10.6),
  ];
  const path = join(dir, "project.with-effects.json");
  await writeFile(path, JSON.stringify({ ...project, overlays }, null, 2));
  const started = Date.now();
  const result = await render(path, join(dir, "runs", "engine-with-effects", "output.mp4"));
  console.log(`${name}: with effects ${((Date.now() - started) / 1000).toFixed(1)} s`, result);
}

/** Each clip encoded on its own with 30 ms fades, joined with `-c copy`. */
async function segmentsJoined(name: string, project: Project) {
  const bin = await ffmpeg();
  const dir = join(folder, name, "runs", "copy-joined");
  await mkdir(dir, { recursive: true });
  const list: string[] = [];
  const times: number[] = [];
  let elapsed = 0;
  for (const [i, item] of project.main.entries()) {
    const source = sources.find((s) => s.id === item.source) as Source;
    const spec = specs.find((s) => s.id === item.source) as SyntheticSpec;
    const start = item.in / SECOND;
    const seconds = (item.out - item.in) / SECOND;
    const segment = join(dir, `seg${String(i).padStart(2, "0")}.mp4`);
    const fit = [
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
      "setsar=1",
    ].join(",");
    const fades = `afade=t=in:st=0:d=0.03,afade=t=out:st=${(seconds - 0.03).toFixed(3)}:d=0.03`;
    // A segment of a source without sound would have none, and the join would then fail; give
    // it silence so the comparison is about the join alone.
    const silent = spec.sound === null;
    await run(bin, [
      ...QUIET,
      "-y",
      "-ss",
      start.toFixed(3),
      "-i",
      join(media, source.path),
      ...(silent ? ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"] : []),
      "-t",
      seconds.toFixed(3),
      "-vf",
      fit,
      "-af",
      fades,
      ...(silent ? ["-map", "0:v", "-map", "1:a", "-shortest"] : []),
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "20",
      "-pix_fmt",
      "yuv420p",
      "-r",
      "30",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "48000",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      segment,
    ]);
    list.push(`file '${segment}'`);
    if (i > 0) times.push(Number(elapsed.toFixed(6)));
    elapsed += seconds;
  }
  await writeFile(join(dir, "list.txt"), `${list.join("\n")}\n`);
  await run(bin, [
    ...QUIET,
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    join(dir, "list.txt"),
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    join(dir, "output.mp4"),
  ]);
  await writeFile(join(dir, "edit_cuts.json"), JSON.stringify({ cuts: times }));
}

const hardCuts = await engine("hard-cuts", cuts);
await withEffects("hard-cuts", hardCuts);
await segmentsJoined("hard-cuts", hardCuts);
await engine("transitions", transitions, {
  broll: [
    {
      source: "d60",
      in: 2 * SECOND,
      out: 4 * SECOND,
      start: 3 * SECOND,
      rect: { x: 0.6, y: 0.05, w: 0.35, h: 0.35 },
      fade: SECOND / 4,
    },
    { source: "b25", in: 5 * SECOND, out: 6.5 * SECOND, start: 7.5 * SECOND, gainDb: -6 },
  ],
});
await engine("finishing", finishing);
