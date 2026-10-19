// Renders a planned edit with every caption preset at every aspect, for checking captions by eye:
//
//   node scripts/caption-samples.ts <project.json> <out folder>
//
// The project is one `pnpm plan` wrote; each clip is framed again for each aspect from its media
// index, as the planner frames it. Beside each <preset>-<aspect>.mp4 and its .srt goes
// <preset>-<aspect>-strip.png: eight frames on which a word starts, English words first, each
// labelled with its frame, time and word, so the highlight can be checked against the words'
// times.

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  type Clip,
  loadJson,
  type MediaIndex,
  type Project,
  validateMediaIndex,
  validateProject,
} from "@video-editor/schema";
import { assTime } from "../src/captions/ass.ts";
import { family, fontFile } from "../src/captions/fonts.ts";
import { FONTS, PRESETS, stageFonts } from "../src/captions/index.ts";
import { ffmpeg, QUIET, run } from "../src/ffmpeg.ts";
import { cropPath } from "../src/framing.ts";
import { rebase, render } from "../src/render.ts";

const { positionals } = parseArgs({ allowPositionals: true });
if (positionals.length !== 2) {
  console.error("Usage: node scripts/caption-samples.ts <project.json> <out folder>");
  process.exit(2);
}
const here = process.env.INIT_CWD ?? process.cwd();
const planned = resolve(here, positionals[0] as string);
const out = resolve(here, positionals[1] as string);
const SIZES = { "9:16": [1080, 1920], "1:1": [1080, 1080], "16:9": [1920, 1080] } as const;
const STRIP_WIDTH = 480;

await mkdir(out, { recursive: true });
const bin = await ffmpeg();
const project = rebase(await loadJson(planned, validateProject), planned, out);
const indexes = new Map<string, MediaIndex>();
for (const source of project.sources) {
  if (source.index) {
    indexes.set(source.id, await loadJson(resolve(out, source.index), validateMediaIndex));
  }
}

// The strip's labels are drawn by libass in the Bold caption face, run in the output folder.
Object.assign(process.env, await stageFonts(out, [await fontFile(700)]));
process.chdir(out);

for (const [aspect, [width, height]] of Object.entries(SIZES) as [
  keyof typeof SIZES,
  readonly [number, number],
][]) {
  const output = { ...project.output, aspect, width, height };
  const framed = ({ framing, ...clip }: Clip): Clip => {
    const { crop: _, ...rest } = framing ?? {};
    const index = indexes.get(clip.source);
    const crop = index && cropPath(index, clip, output);
    const kept = crop ? { ...rest, crop } : rest;
    return Object.keys(kept).length > 0 ? { ...clip, framing: kept } : clip;
  };
  for (const preset of Object.keys(PRESETS)) {
    const name = `${preset}-${aspect.replace(":", "x")}`;
    const edit: Project = {
      ...project,
      output,
      main: project.main.map(framed) as Project["main"],
      captions: { ...(project.captions as NonNullable<Project["captions"]>), preset, srt: true },
    };
    const path = join(out, `${name}.json`);
    await writeFile(path, JSON.stringify(edit, null, 2));
    const started = Date.now();
    const result = await render(path, join(out, `${name}.mp4`));
    console.log(`${name}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
    await strip(edit, result.video, join(out, `${name}-strip.png`));
  }
}

/** Eight frames on which a word starts, from the second second on, labelled. */
async function strip(edit: Project, video: string, png: string): Promise<void> {
  const { width, height, fps } = edit.output;
  const frameTicks = (120_000 * fps.den) / fps.num;
  const seconds = (frame: number) => (frame * fps.den) / fps.num;
  const words = (edit.captions?.lines ?? [])
    .flatMap((line) => line.words ?? [])
    .map((word) => ({ ...word, frame: Math.ceil(word.start / frameTicks) }))
    .filter((word) => seconds(word.frame) >= 1);
  const english = words.filter((word) => /[A-Za-z]/.test(word.text)).slice(0, 4);
  const picked = [...english, ...words.filter((word) => !english.includes(word))]
    .slice(0, 8)
    .sort((a, b) => a.frame - b.frame);
  const size = Math.round(Math.min(width, height) * 0.035);
  const labels = picked.map(({ text, frame }) => {
    const label = `frame ${frame} · ${seconds(frame).toFixed(3)} s · ${text}`;
    return `Dialogue: 0,${assTime(frame, frameTicks)},${assTime(frame + 1, frameTicks)},Label,,0,0,0,,${label}`;
  });
  await writeFile(
    "labels.ass",
    [
      "[Script Info]",
      "ScriptType: v4.00+",
      `PlayResX: ${width}`,
      `PlayResY: ${height}`,
      "",
      "[V4+ Styles]",
      "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
      `Style: Label,${family(700)},${size},&H00FFFFFF,&H00FFFFFF,&H40000000,&H40000000,1,0,0,0,100,100,0,0,3,${Math.round(size / 3)},0,7,${size},${size},${size},1`,
      "",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      ...labels,
      "",
    ].join("\n"),
  );
  const select = picked.map(({ frame }) => `eq(n\\,${frame})`).join("+");
  await run(bin, [
    ...QUIET,
    "-y",
    "-i",
    video,
    "-vf",
    `ass=filename=labels.ass:fontsdir=${FONTS},select='${select}',scale=${STRIP_WIDTH}:-2,tile=4x2:padding=8:color=white`,
    "-frames:v",
    "1",
    "-update",
    "1",
    png,
  ]);
}
