// Measures colour matching and renders previews of the looks and punch-ins, for review:
//
//   node scripts/finishing-preview.ts <folder> [--scene <clip folder>@<seconds> ...] [--edit <run folder>]
//
// - colour/: one synthetic scene, a colour chart and skin tones beside a face, as four cameras
//   record it with known white balance, exposure, saturation and contrast differences. The four
//   are rendered in one edit as the planner grades it, before and after matching, and the
//   CIEDE2000 difference of every patch from the reference camera's is printed. match.png shows
//   the cameras before (top) and after (bottom).
// - looks.png: each look (columns: none, then the catalog's order) on the reference camera and on
//   each --scene: a corpus clip's folder (source.mp4 and the index.json vework wrote for it) and
//   the second to show.
// - punch-ins.png, with --edit (a plan-corpus run folder with its project.json): for each jump
//   cut, the last frame before it, then the first after it without and with its punch-in;
//   push-ins.png: the start, middle and end of each push-in.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  loadJson,
  type MediaIndex,
  type Project,
  type Source,
  TICKS_PER_SECOND,
  ticksPerFrame,
  validateMediaIndex,
  validateProject,
} from "@video-editor/schema";
import { deltaE2000, type Rgb, rgbToLab } from "../src/colour.ts";
import { ffmpeg, run } from "../src/ffmpeg.ts";
import { autoGrade } from "../src/grade.ts";
import { QUIET } from "../src/graph/encode.ts";
import { lookIds } from "../src/looks.ts";
import { matchColour } from "../src/match.ts";
import { isJumpCut, type ShotFacts } from "../src/punch.ts";
import { render } from "../src/render.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { scene: { type: "string", multiple: true }, edit: { type: "string" } },
});
if (positionals.length !== 1) {
  console.error(
    "Usage: node scripts/finishing-preview.ts <folder> [--scene <clip folder>@<seconds> ...] [--edit <run folder>]",
  );
  process.exit(2);
}
const here = process.env.INIT_CWD ?? process.cwd();
const folder = resolve(here, positionals[0] as string);
const SECOND = TICKS_PER_SECOND;
const [WIDTH, HEIGHT, FPS] = [1280, 720, 25];
const log = (message: string) => process.stderr.write(`${message}\n`);

// ColorChecker colours, roughly, in 8-bit R'G'B', then six skin tones from light to deep.
const CHART = [
  [115, 82, 68], [194, 150, 130], [98, 122, 157], [87, 108, 67], [133, 128, 177], [103, 189, 170],
  [214, 126, 44], [80, 91, 166], [193, 90, 99], [94, 60, 108], [157, 188, 64], [224, 163, 46],
  [56, 61, 150], [70, 148, 73], [175, 54, 60], [231, 199, 31], [187, 86, 149], [8, 133, 161],
  [243, 243, 242], [200, 200, 200], [160, 160, 160], [122, 122, 121], [85, 85, 85], [52, 52, 52],
]; // biome-ignore format: a table
const SKIN = [[241, 194, 167], [224, 172, 140], [198, 145, 115], [160, 110, 80], [110, 72, 52], [70, 45, 35]]; // biome-ignore format: a table
const PATCH = 70;
/** The top-left corner of every patch: the chart in six columns and four rows, the skin tones in
 * a row under it. */
const PATCHES = [
  ...CHART.map((rgb, i) => ({
    rgb,
    x: 660 + (i % 6) * 80,
    y: 120 + Math.floor(i / 6) * 80,
    skin: i < 2,
  })),
  ...SKIN.map((rgb, i) => ({ rgb, x: 660 + i * 80, y: 470, skin: true })),
];

/** The scene: a warm grey wall, a person in a blue shirt and the patches. */
function scene(): Float64Array {
  const pixels = new Float64Array(WIDTH * HEIGHT * 3);
  const set = (x: number, y: number, rgb: readonly number[]) => {
    for (let c = 0; c < 3; c++) pixels[(y * WIDTH + x) * 3 + c] = (rgb[c] ?? 0) / 255;
  };
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const t = y / HEIGHT;
      set(x, y, [150 - 40 * t, 140 - 38 * t, 128 - 33 * t]);
      const dx = (x - 320) / 110;
      const dy = (y - 300) / 140;
      const face = dx * dx + dy * dy;
      if (y > 430 && Math.abs(x - 320) < 200 - (y - 430) * -0.3) set(x, y, [52, 72, 110]);
      if (y > 380 && y <= 460 && Math.abs(x - 320) < 55) set(x, y, [205, 155, 125]);
      const hair = ((x - 320) / 125) ** 2 + ((y - 245) / 120) ** 2;
      if (hair < 1 && y < 250) set(x, y, [40, 30, 25]);
      // Shaded towards the edge of the face, as light falls across it.
      if (face < 1)
        set(
          x,
          y,
          [224, 172, 140].map((v) => v * (1 - 0.18 * face)),
        );
    }
  }
  for (const { rgb, x, y } of PATCHES) {
    for (let j = 0; j < PATCH; j++) for (let i = 0; i < PATCH; i++) set(x + i, y + j, rgb);
  }
  return pixels;
}

interface Camera {
  id: string;
  /** White balance, as linear-light gains. */
  balance: [number, number, number];
  stops: number;
  saturation: number;
  contrast: number;
}
const CAMERAS: Camera[] = [
  { id: "a-reference", balance: [1, 1, 1], stops: 0, saturation: 1, contrast: 1 },
  { id: "b-warm-dark", balance: [1.18, 1, 0.8], stops: -0.4, saturation: 1, contrast: 1 },
  { id: "c-cool-flat", balance: [0.88, 1, 1.15], stops: 0.3, saturation: 0.9, contrast: 0.85 },
  { id: "d-punchy-green", balance: [1, 1.06, 1], stops: 0, saturation: 1.2, contrast: 1.12 },
];

/** The scene as a camera records it: white balance and exposure in linear light, then its colour
 * matrix and tone curve, clipped to 8 bits. */
function shoot(pixels: Float64Array, camera: Camera): Uint8Array {
  const out = new Uint8Array(pixels.length);
  for (let i = 0; i < pixels.length; i += 3) {
    const rgb = [0, 1, 2].map(
      (c) =>
        ((pixels[i + c] ?? 0) ** 2.4 * (camera.balance[c] ?? 1) * 2 ** camera.stops) ** (1 / 2.4),
    );
    const luma = 0.2126 * (rgb[0] ?? 0) + 0.7152 * (rgb[1] ?? 0) + 0.0722 * (rgb[2] ?? 0);
    for (let c = 0; c < 3; c++) {
      const v = 0.5 + camera.contrast * (luma + camera.saturation * ((rgb[c] ?? 0) - luma) - 0.5);
      out[i + c] = Math.round(Math.min(1, Math.max(0, v)) * 255);
    }
  }
  return out;
}

/** Encodes a still as `seconds` of 25 fps H.264 tagged BT.709, with a little moving grain, and
 * writes the media index vework would write for it. */
async function record(
  dir: string,
  id: string,
  frame: Uint8Array,
  seconds: number,
): Promise<Source> {
  const raw = join(dir, `${id}.rgb`);
  await writeFile(raw, frame);
  const file = join(dir, `${id}.mp4`);
  await run(await ffmpeg(), [
    ...QUIET,
    "-y",
    "-stream_loop",
    "-1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-s",
    `${WIDTH}x${HEIGHT}`,
    "-framerate",
    String(FPS),
    "-i",
    raw,
    "-t",
    String(seconds),
    "-vf",
    "scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p,noise=alls=2:allf=t",
    "-c:v",
    "libx264",
    "-crf",
    "16",
    ...["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"],
    file,
  ]);
  const index: MediaIndex = {
    version: 1,
    source: {
      name: `${id}.mp4`,
      duration: seconds,
      start: 0,
      video: {
        width: WIDTH,
        height: HEIGHT,
        sample_aspect: 1,
        fps: FPS,
        rotation: 0,
        codec: "h264",
        transfer: 1,
        matrix: 1,
      },
      audio: [],
    },
    transitions: [],
    speech: [],
    transcript: { language: null, text: "", words: [] },
  };
  await writeFile(join(dir, `${id}.index.json`), JSON.stringify(index));
  const bytes = await readFile(file);
  return {
    id,
    kind: "video",
    path: `${id}.mp4`,
    index: `${id}.index.json`,
    fingerprint: { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") },
  };
}

/** Frame `n` of a video, picked by its number: a seek drops every frame that starts before the
 * time sought, so seeking into the middle of frame n lands on frame n + 1. */
const pick = (n: number) => `select=eq(n\\,${n})`;

/** Frame `n` of a video, as R'G'B' bytes. */
async function frameAt(file: string, n: number): Promise<Uint8Array> {
  const raw = `${file}.${n}.rgb`;
  await run(await ffmpeg(), [
    ...QUIET,
    "-y",
    "-i",
    file,
    "-vf",
    pick(n),
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    raw,
  ]);
  return new Uint8Array(await readFile(raw));
}

/** Frame `n` of a video, as a PNG `width` wide. */
async function still(file: string, n: number, png: string, width = 480): Promise<string> {
  await run(await ffmpeg(), [
    ...QUIET,
    "-y",
    "-i",
    file,
    "-vf",
    `${pick(n)},scale=${width}:-2:flags=lanczos`,
    "-frames:v",
    "1",
    png,
  ]);
  return png;
}

/** Stills side by side in rows, rows one above another; every still in a row the same height. */
async function sheet(rows: string[][], png: string): Promise<void> {
  const inputs = rows.flat().flatMap((file) => ["-i", file]);
  let k = 0;
  const graph: string[] = [];
  for (const [r, row] of rows.entries()) {
    const labels = row.map(() => `[${k++}:v]`).join("");
    graph.push(
      row.length > 1 ? `${labels}hstack=inputs=${row.length}[r${r}]` : `${labels}null[r${r}]`,
    );
  }
  const all = rows.map((_, r) => `[r${r}]`).join("");
  graph.push(rows.length > 1 ? `${all}vstack=inputs=${rows.length}[out]` : `${all}null[out]`);
  await run(await ffmpeg(), [
    ...QUIET,
    "-y",
    ...inputs,
    "-filter_complex",
    graph.join(";"),
    "-map",
    "[out]",
    png,
  ]);
}

/** The mean colour inside each patch, away from its edges, as CIELAB. */
function patchLabs(frame: Uint8Array) {
  return PATCHES.map(({ x, y }) => {
    const sum = [0, 0, 0];
    let count = 0;
    for (let j = 18; j < PATCH - 18; j++) {
      for (let i = 18; i < PATCH - 18; i++) {
        const at = ((y + j) * WIDTH + x + i) * 3;
        for (let c = 0; c < 3; c++) sum[c] = (sum[c] ?? 0) + (frame[at + c] ?? 0) / 255;
        count++;
      }
    }
    return rgbToLab(sum.map((v) => v / count) as Rgb);
  });
}

async function colour(): Promise<Source[]> {
  const dir = join(folder, "colour");
  await mkdir(dir, { recursive: true });
  const pixels = scene();
  const sources: Source[] = [];
  for (const camera of CAMERAS)
    sources.push(await record(dir, camera.id, shoot(pixels, camera), 4));
  // Each camera for 2 s, then the reference again, so it is the source the edit uses longest.
  const clips = [...CAMERAS, CAMERAS[0] as Camera].map((camera, i) => ({
    source: camera.id,
    in: i < CAMERAS.length ? 0 : 2 * SECOND,
    out: i < CAMERAS.length ? 2 * SECOND : 4 * SECOND,
  }));
  const project: Project = {
    version: 1,
    output: {
      aspect: "16:9",
      width: WIDTH,
      height: HEIGHT,
      fps: { num: FPS, den: 1 },
      target: { duration: clips.length * 2 * SECOND, tolerance: 0.05 },
    },
    sources: sources as Project["sources"],
    main: clips as Project["main"],
    audio: { loudness: { integratedLufs: -14, truePeakDbtp: -1 } },
  };
  const path = join(dir, "project.json");
  await writeFile(path, JSON.stringify(project));
  const before = await autoGrade(project, path);
  const { project: after, reports } = await matchColour(before, path);
  for (const report of reports) {
    log(
      `${report.source}: residual ${report.fit.residual.toFixed(4)}, ${report.problem ?? "matched"}`,
    );
  }
  const withLook = (edit: Project): Project =>
    ({
      ...edit,
      main: edit.main.map((clip) => ({
        ...clip,
        grade: { ...clip.grade, look: { id: "clean", intensity: 1 } },
      })),
    }) as Project;
  const variants = { before, after, "after, clean look": withLook(after) };
  const table: string[] = [
    "| Camera | Before: mean / max / skin | After | After, with the clean look |",
    "|---|---|---|---|",
  ];
  const results = new Map<string, string[]>();
  const strips: string[][] = [];
  for (const [name, edit] of Object.entries(variants)) {
    const file = join(dir, `${name.replaceAll(/[ ,]+/g, "-")}.mp4`);
    await writeFile(path, JSON.stringify(edit, null, 2));
    await render(path, file);
    // The middle frame of each clip; the reference's first clip is the one compared against.
    const labs = [];
    const row: string[] = [];
    for (let i = 0; i < CAMERAS.length; i++) {
      const n = i * 2 * FPS + FPS;
      labs.push(patchLabs(await frameAt(file, n)));
      row.push(await still(file, n, join(dir, `${name.replaceAll(/[ ,]+/g, "-")}-${i}.png`), 320));
    }
    if (name !== "after, clean look") strips.push(row);
    const reference = labs[0] ?? [];
    for (const [i, camera] of CAMERAS.entries()) {
      if (i === 0) continue;
      const deltas = (labs[i] ?? []).map((lab, p) => deltaE2000(lab, reference[p] ?? lab));
      const skin = deltas.filter((_, p) => PATCHES[p]?.skin);
      const mean = (list: number[]) => list.reduce((sum, v) => sum + v, 0) / list.length;
      const cell = `${mean(deltas).toFixed(2)} / ${Math.max(...deltas).toFixed(2)} / ${mean(skin).toFixed(2)}`;
      results.set(camera.id, [...(results.get(camera.id) ?? []), cell]);
    }
  }
  for (const [camera, cells] of results) table.push(`| ${camera} | ${cells.join(" | ")} |`);
  await writeFile(join(dir, "delta-e.md"), `${table.join("\n")}\n`);
  console.log(table.join("\n"));
  await sheet(strips, join(folder, "match.png"));
  return sources;
}

/** Each look on a clip of each source: rows are sources, columns none and then each look. */
async function looks(
  scenes: { source: Source; base: string; at: number; output: Project["output"] }[],
) {
  const dir = join(folder, "looks");
  await mkdir(dir, { recursive: true });
  const rows: string[][] = [];
  for (const { source, base, at, output } of scenes) {
    const row: string[] = [];
    for (const look of [null, ...lookIds]) {
      const project: Project = {
        version: 1,
        output: { ...output, target: { duration: SECOND, tolerance: 0.05 } },
        sources: [
          {
            ...source,
            path: relative(dir, join(base, source.path)),
            ...(source.index ? { index: relative(dir, join(base, source.index)) } : {}),
          },
        ] as Project["sources"],
        main: [
          {
            source: source.id,
            in: Math.round(at * SECOND),
            out: Math.round(at * SECOND) + SECOND,
            ...(look ? { grade: { look: { id: look, intensity: 1 } } } : {}),
          },
        ] as Project["main"],
        audio: { loudness: { integratedLufs: -14, truePeakDbtp: -1 } },
      };
      const path = join(dir, `${source.id}-${look ?? "none"}.json`);
      await writeFile(path, JSON.stringify(project));
      const file = join(dir, `${source.id}-${look ?? "none"}.mp4`);
      await render(path, file);
      // Half a second in.
      row.push(
        await still(file, Math.floor(output.fps.num / output.fps.den / 2), `${file}.png`, 320),
      );
    }
    rows.push(row);
  }
  await sheet(rows, join(folder, "looks.png"));
}

/** A corpus clip's folder as a source of a project in `base`, under `id`. */
async function corpusSource(
  clip: string,
  id: string,
): Promise<{ source: Source; output: Project["output"] }> {
  const path = join(clip, "source.mp4");
  const bytes = await readFile(path);
  const index = JSON.parse(await readFile(join(clip, "index.json"), "utf8")) as MediaIndex;
  const video = index.source.video;
  return {
    source: {
      id,
      kind: "video",
      path: relative(folder, path),
      index: relative(folder, join(clip, "index.json")),
      fingerprint: {
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    },
    output: {
      aspect: "16:9",
      width: 640,
      height: 360,
      fps: { num: Math.round(video?.fps ?? 30), den: 1 },
      target: { duration: SECOND, tolerance: 0.05 },
    },
  };
}

/** Frames either side of each jump cut of a planned edit, without and with its punch-ins, and
 * across each push-in. Each is rendered as a short excerpt: the clips around it, cut to a second
 * either side. */
async function punchIns(edit: string) {
  const dir = join(folder, "punch-ins");
  await mkdir(dir, { recursive: true });
  const project = await loadJson(join(edit, "project.json"), validateProject);
  const frame = ticksPerFrame(project.output.fps);
  const shots = new Map<string, ShotFacts>();
  for (const source of project.sources) {
    if (!source.index) continue;
    const index = await loadJson(join(edit, source.index), validateMediaIndex);
    const { width = 0, height = 0 } = index.source.video ?? {};
    shots.set(source.id, { width, height, transitions: index.transitions });
  }
  const around = Math.round(SECOND / frame) * frame;
  type Clip = Project["main"][number];
  const unscaled = (clip: Clip): Clip => {
    const { scale: _, ...rest } = clip.framing ?? {};
    const { framing: __, transition: ___, ...plain } = clip;
    return Object.keys(rest).length > 0 ? { ...plain, framing: rest } : plain;
  };
  /** Renders `clips` alone, relative to the project's folder, and returns the file. */
  const excerpt = async (name: string, clips: Clip[]) => {
    const length = clips.reduce((sum, clip) => sum + clip.out - clip.in, 0);
    const path = join(dir, `${name}.json`);
    const { broll: _, overlays: __, captions: ___, plan: ____, ...rest } = project;
    const move = (file: string) => relative(dir, join(edit, file));
    const short: Project = {
      ...rest,
      sources: project.sources.map((source) => ({
        ...source,
        path: move(source.path),
        ...(source.index ? { index: move(source.index) } : {}),
      })) as Project["sources"],
      output: { ...project.output, target: { duration: length, tolerance: 0.05 } },
      main: clips.map(({ transition: _, ...clip }) => clip) as Project["main"],
    };
    await writeFile(path, JSON.stringify(short));
    const file = join(dir, `${name}.mp4`);
    await render(path, file);
    return file;
  };
  const at = (file: string, n: number) => still(file, n, `${file}.${n}.png`);
  const rows: string[][] = [];
  const pushes: string[][] = [];
  for (const [i, clip] of project.main.entries()) {
    const before = project.main[i - 1];
    const facts = shots.get(clip.source);
    if (before && facts && isJumpCut(before, clip, facts, frame)) {
      const tail = { ...before, in: Math.max(before.in, before.out - around) };
      const head = { ...clip, out: Math.min(clip.out, clip.in + around) };
      const cut = Math.round((tail.out - tail.in) / frame);
      const punched = await excerpt(`cut-${i}`, [tail, head]);
      const plain = await excerpt(`cut-${i}-plain`, [unscaled(tail), unscaled(head)]);
      rows.push([await at(punched, cut - 1), await at(plain, cut), await at(punched, cut)]);
    }
    const scale = clip.framing?.scale;
    if (typeof scale === "object") {
      const from = scale.keyframes[0].t;
      const to = (scale.keyframes.at(-1) as (typeof scale.keyframes)[number]).t;
      const part = {
        ...clip,
        in: Math.max(clip.in, from - around),
        out: Math.min(clip.out, to + around),
      };
      const file = await excerpt(`push-${i}`, [part]);
      const n = (t: number) =>
        Math.min(Math.round((t - part.in) / frame), Math.round((part.out - part.in) / frame) - 1);
      pushes.push([
        await at(file, n(from)),
        await at(file, n((from + to) / 2)),
        await at(file, n(to)),
      ]);
    }
  }
  log(`${rows.length} jump cuts with a punch-in, ${pushes.length} push-ins`);
  if (rows.length > 0) await sheet(rows, join(folder, "punch-ins.png"));
  if (pushes.length > 0) await sheet(pushes, join(folder, "push-ins.png"));
}

await mkdir(folder, { recursive: true });
const cameras = await colour();
const scenes: Parameters<typeof looks>[0] = [
  {
    source: cameras[0] as Source,
    base: join(folder, "colour"),
    at: 1,
    output: {
      aspect: "16:9",
      width: WIDTH / 2,
      height: HEIGHT / 2,
      fps: { num: FPS, den: 1 },
      target: { duration: SECOND, tolerance: 0.05 },
    },
  },
];
for (const [k, scene] of (values.scene ?? []).entries()) {
  const at = scene.lastIndexOf("@");
  const { source, output } = await corpusSource(resolve(here, scene.slice(0, at)), `scene-${k}`);
  scenes.push({ source, base: folder, at: Number(scene.slice(at + 1)), output });
}
await looks(scenes);
if (values.edit) await punchIns(resolve(here, values.edit));
log(`Wrote ${relative(here, folder) || "."}`);
