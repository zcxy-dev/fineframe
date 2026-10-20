// Renders synthetic footage end to end with the pinned FFmpeg, small enough to run in CI.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { COLORS, catalog, type OverlayJob, templateIds } from "@video-editor/effects";
import {
  type CropPath,
  type FaceBox,
  type FramedShot,
  loadJson,
  type Project,
  type ScalePath,
  type Source,
  validateMediaIndex,
  validateProject,
} from "@video-editor/schema";
import { family, fontFile } from "./captions/fonts.ts";
import { buildCaptions, PRESETS, stageFonts } from "./captions/index.ts";
import type { Rgb } from "./colour.ts";
import { ffmpeg, QUIET, run } from "./ffmpeg.ts";
import { everyKind, makeSource, projectOf } from "./fixtures.ts";
import { cropPath } from "./framing.ts";
import { captionFilter, RAW_AUDIO, RAW_VIDEO } from "./graph/encode.ts";
import {
  masterAudio,
  measureLoudness,
  parseMeasurement,
  parseTruePeak,
  truePeakFilter,
} from "./graph/master.ts";
import { pieceAudio } from "./graph/piece.ts";
import { gradeColour } from "./looks.ts";
import { cutPieces } from "./pieces.ts";
import { limitPeak, render, unrendered } from "./render.ts";
import { loadSources } from "./sources.ts";
import { project as fakeProject, SECOND, scratch } from "./testing.ts";
import { buildTimeline } from "./timeline.ts";

const execFileAsync = promisify(execFile);
const tiny = { aspect: "16:9", width: 160, height: 90, fps: { num: 30, den: 1 } } as const;
const clip = (source: string, start: number, seconds: number): Project["main"][number] => ({
  source,
  in: Math.round(start * SECOND),
  out: Math.round((start + seconds) * SECOND),
});

async function write(dir: string, project: Project): Promise<string> {
  const path = join(dir, "project.json");
  await writeFile(path, JSON.stringify(project));
  return path;
}

/** The left channel of every piece's sound, back to back, before the loudness pass. */
async function pieceSound(dir: string, project: Project): Promise<Float32Array> {
  const timeline = buildTimeline(project, await loadSources(project, await write(dir, project)));
  const parts: Buffer[] = [];
  for (const piece of cutPieces(timeline)) {
    const file = join(dir, "piece.f32");
    await run(await ffmpeg(), [...pieceAudio(piece, timeline).slice(0, -1), "-y", file]);
    parts.push(await readFile(file));
  }
  const bytes = Buffer.concat(parts);
  const stereo = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  return stereo.filter((_, i) => i % 2 === 0);
}

/** A still image source, which has no media index. */
async function still(dir: string, id: string): Promise<Source> {
  const path = join(dir, `${id}.png`);
  await run(await ffmpeg(), [
    ...QUIET,
    "-f",
    "lavfi",
    "-i",
    "smptebars=s=320x240",
    "-frames:v",
    "1",
    path,
  ]);
  const bytes = await readFile(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { id, kind: "image", path: `${id}.png`, fingerprint: { bytes: bytes.length, sha256 } };
}

/** Frames, samples and stream descriptions of a rendered file, as FFmpeg decodes it. */
async function inspect(file: string) {
  const bin = await ffmpeg();
  const frames = await run(bin, [
    ...QUIET,
    "-i",
    file,
    "-map",
    "0:v",
    "-c",
    "copy",
    "-f",
    "framecrc",
    "-",
  ]);
  const pcm = `${file}.f32`;
  await run(bin, [...QUIET, "-y", "-i", file, "-map", "0:a", "-ac", "1", "-f", "f32le", pcm]);
  const bytes = await readFile(pcm);
  const samples = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
  const info = await run(bin, ["-hide_banner", "-i", file, "-frames:v", "1", "-f", "null", "-"]);
  return {
    frames: frames.stdout.split("\n").filter((line) => /^\d/.test(line)).length,
    samples,
    info: info.stderr,
  };
}

/** Each output frame as 8-bit grey, `width` × `height`. */
async function grey(file: string, width: number, height: number): Promise<Uint8Array[]> {
  const raw = `${file}.gray`;
  await run(await ffmpeg(), [
    ...QUIET,
    "-y",
    "-i",
    file,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "gray",
    raw,
  ]);
  const bytes = await readFile(raw);
  const size = width * height;
  return Array.from({ length: bytes.length / size }, (_, i) =>
    bytes.subarray(i * size, (i + 1) * size),
  );
}

test("an edit across every kind of source renders every frame and sample exactly", async (t) => {
  const dir = await scratch(t, "render-");
  const sources: Source[] = [];
  for (const spec of everyKind(160, 90, 4)) sources.push(await makeSource(dir, spec));
  sources.push(await still(dir, "title"));
  const project = projectOf(
    sources,
    [
      clip("a30", 0.513, 0.47),
      clip("b25", 1.21, 0.33),
      clip("c24", 0.517, 0.42),
      clip("d60", 1.33, 0.31),
      clip("e-phone", 0.7, 0.44),
      clip("f-vfr", 2.05, 0.46),
      clip("g-hdr", 1.6, 0.37),
      clip("h-mute", 2.5, 0.38),
      { ...clip("a30", 2.31, 0.59), transition: { type: "dissolve", duration: SECOND / 5 } },
      clip("i-silent", 1.9, 0.34),
      {
        ...clip("b25", 2.77, 0.51),
        transition: { type: "dip", duration: SECOND / 5, color: "#000000" },
      },
      clip("c24", 3.2, 0.36),
      clip("d60", 2.15, 0.42),
      clip("title", 0, 0.4),
      clip("f-vfr", 0.9, 0.45),
    ] as Project["main"],
    tiny,
  );
  project.broll = [
    {
      source: "d60",
      in: SECOND,
      out: 2 * SECOND,
      start: 2 * SECOND,
      gainDb: -6,
      fade: SECOND / 10,
    },
  ];
  const path = await write(dir, project);
  const result = await render(path, join(dir, "out", "edit.mp4"));

  const timeline = buildTimeline(project, await loadSources(project, path));
  assert.equal(result.frames, timeline.frames);
  const { frames, samples, info } = await inspect(result.video);
  assert.equal(frames, timeline.frames);
  // The sound decodes to exactly the picture's length: 1600 samples per 30 fps frame.
  assert.equal(samples.length, timeline.frames * 1600);
  assert.match(info, /Video: h264 \(High\).*yuv420p\(tv, bt709, progressive\), 160x90/);
  assert.match(info, /Audio: aac \(LC\).*48000 Hz, stereo/);

  const cuts = JSON.parse(await readFile(result.cuts, "utf8"));
  assert.equal(cuts.cuts.length, 14);
  assert.deepEqual(
    cuts.cuts,
    timeline.cuts.map((t) => Number(t.toFixed(6))),
  );
  assert.equal(result.cuts, join(dir, "out", "edit_cuts.json"));

  // The copy beside the video renders the same edit: its paths lead to the same files.
  const copy = await loadJson(result.project, validateProject);
  assert.equal(result.project, join(dir, "out", "edit.project.json"));
  for (const source of copy.sources) {
    const path = resolve(dirname(result.project), source.path);
    await access(path);
    assert.equal(path, join(dir, `${source.id}.${source.kind === "image" ? "png" : "mp4"}`));
  }
  assert.deepEqual(copy.main, project.main);
});

test("picture and sound stay in step whatever the source's frame rate", async (t) => {
  const dir = await scratch(t, "sync-");
  // [frame rate, variable, how far the sound may lead or trail the picture]: a frame rate that
  // differs from the output's shows each source frame up to one output frame late.
  const rates = [
    [30, false, 0],
    [25, false, 1 / 30],
    [30, true, 1 / 30],
  ] as const;
  for (const [fps, variable, tolerance] of rates) {
    const id = `marks${fps}${variable ? "v" : ""}`;
    // A white frame where each beep starts, 0.6 s into every second.
    const flash = "geq=lum='if(gte(mod(T,1),0.599)*lt(mod(T,1),0.62),235,16)':cb=128:cr=128";
    const spec = { id, pattern: "color", width: 64, height: 36, fps, seconds: 4, variable };
    const source = await makeSource(dir, { ...spec, sound: "beeps", filter: flash });
    const project = projectOf([source], [clip(id, 1.13, 1.5)], { ...tiny, width: 64, height: 36 });
    const result = await render(await write(dir, project), join(dir, `${id}.out.mp4`));
    const picture = await grey(result.video, 64, 36);
    const white = picture.findIndex((frame) => (frame[0] ?? 0) > 128);
    const { samples } = await inspect(result.video);
    const loudest = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    const beep = samples.findIndex((value) => Math.abs(value) > loudest * 0.3);
    assert.ok(white > 0 && beep > 0, `${id}: flash at frame ${white}, beep at sample ${beep}`);
    const lead = white / 30 - beep / 48000;
    assert.ok(lead >= -0.002 && lead <= tolerance + 0.002, `${id}: picture - sound = ${lead} s`);
  }
});

test("a clip that starts where its source's picture ends holds the last frame", async (t) => {
  const dir = await scratch(t, "held-");
  const sources: Source[] = [];
  for (const spec of everyKind(64, 36, 3).slice(0, 2)) sources.push(await makeSource(dir, spec));
  // a30's last frame starts at 2.967 s; the timeline allows a clip to run past a source's end.
  const project = projectOf(sources, [clip("b25", 0, 1), clip("a30", 3, 0.3), clip("b25", 1, 1)], {
    ...tiny,
    width: 64,
    height: 36,
  });
  const result = await render(await write(dir, project), join(dir, "out.mp4"));
  const { frames, samples } = await inspect(result.video);
  assert.equal(result.frames, 69);
  assert.equal(frames, 69);
  assert.equal(samples.length, 69 * 1600);
});

test("sound split between pieces joins sample for sample", async (t) => {
  const dir = await scratch(t, "seams-");
  const [tone, , , , , , , mute] = everyKind(64, 36, 4);
  assert.ok(tone && mute);
  const talk = { ...tone, id: "talk", noisy: 0.05 };
  const sources = [
    await makeSource(dir, tone),
    await makeSource(dir, mute),
    await makeSource(dir, talk),
  ];
  const edit = (main: Project["main"], broll: Project["broll"] = []) => ({
    ...projectOf(sources, main, { ...tiny, width: 64, height: 36 }),
    broll,
  });
  const sound = (project: Project) => pieceSound(dir, project);
  /** The split sound matches the sound decoded in one piece around a seam. */
  const joins = (split: Float32Array, whole: Float32Array, seam: number) => {
    for (let i = seam - 32; i < seam + 32; i++) {
      const error = Math.abs((split[i] ?? 0) - (whole[i] ?? 0));
      assert.ok(error < 1e-5, `sample ${i}: ${split[i]} against ${whole[i]}`);
    }
  };
  // In points whose seeks split a sample, so a seek of their own would shift the sound.
  const tonal = { source: "a30", in: 20_000, out: 140_000 };
  const dissolve = { type: "dissolve", duration: SECOND / 5 } as const;

  // The tone's body, then its tail under a dissolve to a clip without sound, which begins with
  // the tone at full level; against the tone cut straight to that clip.
  joins(
    await sound(edit([tonal, { ...clip("h-mute", 0, 1), transition: dissolve }])),
    await sound(edit([tonal, clip("h-mute", 0, 1)])),
    0.8 * 48_000,
  );
  // B-roll of the tone across a cut between two clips without sound, against one such clip.
  const broll = [{ source: "a30", in: 20_000, out: 140_000, start: SECOND / 2, gainDb: 0 }];
  joins(
    await sound(edit([clip("h-mute", 0, 1), clip("h-mute", 2, 1)], broll)),
    await sound(edit([clip("h-mute", 0, 2)], broll)),
    48_000,
  );
  // The same through every stage of a voice chain, whose filters carry state: each piece runs
  // the chain from the clip's first instant, so the tail still joins its body exactly.
  const voiced = (main: Project["main"]) => {
    const project = edit(main);
    project.audio.voice = [{ source: "talk", measurements: { recorded: measured }, chain }];
    return project;
  };
  const talking = { ...tonal, source: "talk" };
  joins(
    await sound(voiced([talking, { ...clip("h-mute", 0, 1), transition: dissolve }])),
    await sound(voiced([talking, clip("h-mute", 0, 1)])),
    0.8 * 48_000,
  );
});

test("sound from Matroska and WebM lands where vework places it, to the millisecond", async (t) => {
  // FFmpeg 7.0 starts these files at the codec priming, 21 ms (AAC) and 7 ms (Opus) before the
  // time zero vework's decoder reads; the beeps start 0.6 s into every second of vework's time.
  const dir = await scratch(t, "matroska-");
  const spec = { pattern: "testsrc2", width: 64, height: 36, fps: 30, seconds: 3 } as const;
  for (const container of ["mkv", "webm"] as const) {
    const source = await makeSource(dir, { ...spec, id: container, sound: "beeps", container });
    // From the file's start, and after a seek: 0.3 s before a beep in both.
    for (const start of [0.3, 1.3]) {
      const project = projectOf([source], [clip(container, start, 0.6)], {
        ...tiny,
        width: 64,
        height: 36,
      });
      const sound = await pieceSound(dir, project);
      const late = sound.findIndex((sample) => Math.abs(sample) > 0.02) - 0.3 * 48_000;
      // 1 ms, and the sample the codec blurs the beep's first cycle by. Matroska times packets
      // in whole milliseconds, so after a seek FFmpeg can still place Opus up to 1 ms off.
      assert.ok(Math.abs(late) <= 49, `${container} from ${start} s: ${late} samples late`);
    }
  }
});

/** A source's speech as vework would record it, for decisions written by hand. */
const measured = { loudnessLufs: -14, loudnessRangeLu: 3, clippedShare: 0 };
/** Every stage of a voice chain. */
const chain = {
  denoise: { attenuationLimitDb: 20 },
  dereverb: { amount: 0.5, thresholdDb: -40 },
  highpassHz: 80,
  eq: [{ type: "peak", frequencyHz: 300, gainDb: -3, q: 1 }],
  level: { targetDb: -20, windowSeconds: 3, maxGainDb: 12 },
  compressor: { thresholdDb: -20, ratio: 3, attackMs: 10, releaseMs: 120, makeupDb: 2 },
  deesser: { frequencyHz: 6000, intensity: 0.4, thresholdDb: -38 },
  limiter: { ceilingDb: -9 },
} satisfies NonNullable<Project["audio"]["voice"]>[number]["chain"];

test("a clip's voice chain has settled by its first instant, as it has partway through the source", async (t) => {
  const dir = await scratch(t, "settle-");
  const spec = { id: "quiet", pattern: "testsrc2", width: 64, height: 36, fps: 30, seconds: 10 };
  const source = await makeSource(dir, { ...spec, sound: 220 });
  // The tone sits 18 dB under the leveller's target, so it is raised by the whole 12 dB.
  const levelled = (start: number, seconds: number) => {
    const project = projectOf([source], [clip("quiet", start, seconds)], {
      ...{ ...tiny, width: 64, height: 36 },
    });
    const level = { targetDb: -3, windowSeconds: 3, maxGainDb: 12 };
    project.audio.voice = [
      { source: "quiet", measurements: { recorded: measured }, chain: { level } },
    ];
    return project;
  };
  const late = await pieceSound(dir, levelled(6.1, 2));
  const early = await pieceSound(dir, levelled(4, 4.1));
  /** dB RMS of the 100 ms from `at` seconds. */
  const level = (samples: Float32Array, at: number) => {
    const from = Math.round(at * 48_000);
    const window = samples.subarray(from, from + 4_800);
    return 10 * Math.log10(window.reduce((sum, x) => sum + x * x, 0) / window.length);
  };
  // The same source seconds, 6.4 to 8.1, in both, past the clip's edge fade.
  for (let at = 0.3; at < 2; at += 0.1) {
    const [a, b] = [level(late, at), level(early, at + 2.1)];
    assert.ok(Math.abs(a - b) < 1, `${at.toFixed(1)} s into the clip: ${a} against ${b} dB`);
  }
});

test("a voice chain plays the denoised speech with the recording mixed back at its limit", async (t) => {
  const dir = await scratch(t, "voice-");
  const spec = { id: "talk", pattern: "testsrc2", width: 64, height: 36, fps: 30, seconds: 4 };
  const source = await makeSource(dir, { ...spec, sound: 220, noisy: 0.05 });
  const plain = projectOf([source], [clip("talk", 0.5, 3)], { ...tiny, width: 64, height: 36 });
  const denoised: Project = {
    ...plain,
    audio: {
      ...plain.audio,
      voice: [
        {
          source: "talk",
          measurements: { recorded: measured },
          chain: { denoise: { attenuationLimitDb: 20 } },
        },
      ],
    },
  };
  /** The noise between the tones against the tones, in dB. */
  const noiseUnderTone = async (project: Project, name: string) => {
    const result = await render(await write(dir, project), join(dir, `${name}.mp4`));
    const { samples, frames } = await inspect(result.video);
    assert.equal(samples.length, frames * 1600);
    const power = (from: number, to: number) => {
      let sum = 0;
      let count = 0;
      for (let i = 0; i < samples.length; i++) {
        // The clip starts 0.5 s into its source: tones sound 0.25-0.75 s into each source second.
        const phase = (i / 48_000 + 0.5) % 1;
        if (phase >= from && phase < to) {
          sum += (samples[i] ?? 0) ** 2;
          count++;
        }
      }
      return sum / count;
    };
    return 10 * Math.log10(power(0.85, 0.95) / power(0.35, 0.65));
  };
  const before = await noiseUnderTone(plain, "plain");
  const after = await noiseUnderTone(denoised, "denoised");
  assert.ok(Math.abs(before - after - 20) < 1.5, `noise fell ${before - after} dB`);
});

test("a chain that denoises mixes the recording back as vework decoded it, from the stem", async (t) => {
  // Two decoders' samples need not line up exactly (the renderer places Matroska sound only to
  // the millisecond), so the recording the renderer decodes itself need not line up with the
  // denoised speech. Here the stem's recording differs from the source's sound outright: the
  // render must play the stem's.
  const dir = await scratch(t, "stem-");
  const spec = { id: "talk", pattern: "testsrc2", width: 64, height: 36, fps: 30, seconds: 4 };
  const source = await makeSource(dir, { ...spec, sound: 220, noisy: 0.05 });
  const recorded = "0.3*sin(2*PI*1000*t)";
  await run(await ffmpeg(), [
    ...QUIET,
    ...["-y", "-f", "lavfi", "-i", `aevalsrc='${recorded}|0':s=48000:d=4`],
    ...["-c:a", "pcm_f32le", join(dir, "talk.voice.wav")],
  ]);
  const project = projectOf([source], [clip("talk", 0.5, 3)], { ...tiny, width: 64, height: 36 });
  const denoise = { attenuationLimitDb: 6 };
  project.audio.voice = [
    { source: "talk", measurements: { recorded: measured }, chain: { denoise } },
  ];
  const sound = await pieceSound(dir, project);
  const kept = 10 ** (-6 / 20);
  // Past the clip's edge fades; the clip starts on a whole number of the tone's cycles.
  for (let i = 4_800; i < sound.length - 4_800; i++) {
    const expected = kept * 0.3 * Math.sin((2 * Math.PI * 1000 * i) / 48_000);
    assert.ok(
      Math.abs((sound[i] ?? 0) - expected) < 1e-4,
      `sample ${i}: ${sound[i]}, not ${expected}`,
    );
  }
});

test("a chain that denoises fails when the media index has no denoised speech", async (t) => {
  const dir = await scratch(t, "no-stem-");
  const [spec] = everyKind(64, 36, 2);
  assert.ok(spec);
  const source = await makeSource(dir, spec);
  const project = projectOf([source], [clip(source.id, 0, 1)], { ...tiny, width: 64, height: 36 });
  project.audio.voice = [{ source: source.id, measurements: { recorded: measured }, chain }];
  await assert.rejects(
    render(await write(dir, project), join(dir, "out.mp4")),
    /a30: its voice chain denoises, but its media index has no denoised speech/,
  );
});

test("rotated phone footage comes out upright", async (t) => {
  const dir = await scratch(t, "rotate-");
  // Stored landscape, white across its top half, with a display matrix that turns it portrait.
  const top = "geq=lum='if(lt(Y,H/2),235,16)':cb=128:cr=128";
  const spec = { id: "phone", pattern: "color", width: 64, height: 36, fps: 30, seconds: 2 };
  const source = await makeSource(dir, { ...spec, sound: null, filter: top, rotate: true });
  const portrait = { aspect: "9:16", width: 36, height: 64, fps: { num: 30, den: 1 } } as const;
  const project = projectOf([source], [clip("phone", 0, 1)], portrait);
  const result = await render(await write(dir, project), join(dir, "out.mp4"));
  const [frame] = await grey(result.video, 36, 64);
  assert.ok(frame);
  const mean = (columns: (x: number) => boolean) => {
    const values = [...frame].filter((_, i) => columns(i % 36));
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  // Turned a quarter counter-clockwise, the top of the stored picture is on the left.
  assert.ok(mean((x) => x < 14) > 200, "left side white");
  assert.ok(mean((x) => x > 22) < 40, "right side black");
});

test("a crop path moves the crop frame by frame, cutting on the exact frame", async (t) => {
  const dir = await scratch(t, "path-");
  // Grey rising from black on the left to white on the right: a crop's brightness says where it is.
  const ramp = "geq=lum='16+219*X/W':cb=128:cr=128";
  const spec = { id: "ramp", pattern: "color", width: 320, height: 180, fps: 30, seconds: 2 };
  const source = await makeSource(dir, { ...spec, sound: null, filter: ramp });
  const portrait = { aspect: "9:16", width: 36, height: 64, fps: { num: 30, den: 1 } } as const;
  const w = 9 / 16 / (16 / 9);
  const at = (seconds: number, centre: number) => ({
    t: Math.round(seconds * SECOND),
    rect: { x: centre - w / 2, y: 0, w, h: 1 },
  });
  // Held, then a pan from 0.2 to 0.8 between 0.2 s and 1 s, held, then a cut to 0.3 at 1.4 s.
  const keyframes = [
    at(0.2, 0.2),
    at(1, 0.8),
    { ...at(1.4, 0.8), t: 1.4 * SECOND - 1 },
    at(1.4, 0.3),
  ];
  const main = [{ ...clip("ramp", 0.1, 1.6), framing: { crop: { type: "path", keyframes } } }];
  const project = projectOf([source], main as Project["main"], portrait);
  const result = await render(await write(dir, project), join(dir, "out.mp4"));
  const frames = await grey(result.video, 36, 64);
  assert.equal(frames.length, 48);
  const brightness = frames.map((frame) => frame.reduce((sum, v) => sum + v, 0) / frame.length);
  // Grey levels run 0 to 255 across the source; the first frame's offset, a few levels from
  // scaling and pixel edges, applies to every frame.
  const offset = (brightness[0] ?? 0) - 255 * 0.2;
  assert.ok(Math.abs(offset) < 6, `offset ${offset}`);
  for (const [k, mean] of brightness.entries()) {
    // Output frame k shows source time 0.1 s + k frames.
    const time = 0.1 + k / 30;
    const centre =
      time < 0.2 ? 0.2 : time < 1 ? 0.2 + (0.6 * (time - 0.2)) / 0.8 : time < 1.4 ? 0.8 : 0.3;
    assert.ok(Math.abs(mean - offset - 255 * centre) < 1.5, `frame ${k}: ${mean} for ${centre}`);
  }
});

test("a crop past the picture shows it whole over a blurred copy, from the exact frame it cuts to", async (t) => {
  const dir = await scratch(t, "backdrop-");
  const ramp = "geq=lum='16+219*X/W':cb=128:cr=128";
  const spec = { id: "ramp", pattern: "color", width: 320, height: 180, fps: 30, seconds: 2 };
  const source = await makeSource(dir, { ...spec, sound: null, filter: ramp });
  const portrait = { aspect: "9:16", width: 72, height: 128, fps: { num: 30, den: 1 } } as const;
  const w = 9 / 16 / (16 / 9);
  const h = 1 / w;
  // A 9:16 crop in the middle until 1 s, then the whole picture in the middle of the frame.
  const keyframes = [
    { t: 0, rect: { x: 0.5 - w / 2, y: 0, w, h: 1 } },
    { t: SECOND - 1, rect: { x: 0.5 - w / 2, y: 0, w, h: 1 } },
    { t: SECOND, rect: { x: 0, y: (1 - h) / 2, w: 1, h } },
  ];
  const main = [{ ...clip("ramp", 0.5, 1), framing: { crop: { type: "path", keyframes } } }];
  const project = projectOf([source], main as Project["main"], portrait);
  const result = await render(await write(dir, project), join(dir, "out.mp4"));
  const frames = await grey(result.video, 72, 128);
  assert.equal(frames.length, 30);
  const pixel = (frame: Uint8Array, x: number, y: number) => frame[y * 72 + x] ?? 0;
  for (const [k, frame] of frames.entries()) {
    const [left, right] = [pixel(frame, 1, 64), pixel(frame, 70, 64)];
    if (k < 15) {
      // Output frame k shows 0.5 s + k frames: the crop spans 0.34 to 0.66 of the ramp.
      assert.ok(Math.abs(left - 255 * (0.5 - w / 2)) < 12, `frame ${k}: left ${left}`);
      assert.ok(Math.abs(right - 255 * (0.5 + w / 2)) < 12, `frame ${k}: right ${right}`);
      continue;
    }
    // The whole ramp across the middle, 40 rows of the 128, and its blurred copy above and below.
    assert.ok(left < 20 && right > 235, `frame ${k}: ${left} to ${right}`);
    for (const y of [4, 124]) {
      const row = Array.from({ length: 72 }, (_, x) => pixel(frame, x, y));
      assert.ok(row.every((v) => v > 0) && (row[36] ?? 0) > 60, `frame ${k}, row ${y}: ${row}`);
      const steps = row.slice(1).map((v, x) => Math.abs(v - (row[x] ?? 0)));
      assert.ok(Math.max(...steps) < 20, `frame ${k}, row ${y} is not smooth: ${row}`);
    }
  }
});

test("a crop that changes size during a dissolve renders each side of the cut with its own", async (t) => {
  const dir = await scratch(t, "dissolve-cut-");
  // A white square, 40 pixels wide, in the middle of a black frame.
  const square = await makeSource(dir, {
    id: "square",
    pattern: "color",
    filter: "drawbox=x=140:y=70:w=40:h=40:color=white:t=fill",
    width: 320,
    height: 180,
    fps: 30,
    seconds: 3,
    sound: null,
  });
  // The second clip comes in over 0.4 s from 1 s of the source, and its crop cuts at 1.1 s to
  // twice the picture's size, which shows the picture at half size over its blurred copy.
  const keyframes: CropPath["keyframes"] = [
    { t: 1.1 * SECOND - 1, rect: { x: 0, y: 0, w: 1, h: 1 } },
    { t: 1.1 * SECOND, rect: { x: -0.5, y: -0.5, w: 2, h: 2 } },
  ];
  const project = projectOf(
    [square],
    [
      clip("square", 0, 1),
      {
        ...clip("square", 1, 1),
        transition: { type: "dissolve", duration: 0.4 * SECOND },
        framing: { crop: { type: "path", keyframes } },
      },
    ],
    { ...tiny, width: 320, height: 180 },
  );
  const result = await render(await write(dir, project), join(dir, "out.mp4"));
  const picture = await grey(result.video, 320, 180);
  assert.equal(picture.length, 48);
  const width = (frame: Uint8Array) =>
    frame.subarray(90 * 320, 91 * 320).filter((value) => value > 128).length;
  assert.equal(width(picture[0] as Uint8Array), 40);
  assert.equal(width(picture.at(-1) as Uint8Array), 20);
});

test("a split screen fills its top and bottom halves with their own crops", async (t) => {
  const dir = await scratch(t, "halves-");
  // Dark on the left half of the picture, light on the right.
  const sides = "geq=lum='if(lt(X,W/2),40,220)':cb=128:cr=128";
  const spec = { id: "sides", pattern: "color", width: 320, height: 180, fps: 30, seconds: 1 };
  const source = await makeSource(dir, { ...spec, sound: null, filter: sides });
  const portrait = { aspect: "9:16", width: 72, height: 128, fps: { num: 30, den: 1 } } as const;
  // Each half is 72 × 64, 9:8: 0.6 of the picture's height is 0.38 of its width.
  const pane = (x: number) => ({ x, y: 0.2, w: 0.6 * (9 / 8) * (9 / 16), h: 0.6 });
  const crop = { type: "static", rect: pane(0.05), below: pane(0.55) } as const;
  const project = projectOf([source], [{ ...clip("sides", 0, 0.5), framing: { crop } }], portrait);
  const result = await render(await write(dir, project), join(dir, "out.mp4"));
  const frames = await grey(result.video, 72, 128);
  assert.equal(frames.length, 15);
  for (const frame of frames) {
    const mean = (from: number, to: number) =>
      frame.subarray(from * 72, to * 72).reduce((sum, v) => sum + v, 0) / ((to - from) * 72);
    // Grey levels 40 and 220 of the limited range, in the full range the frames are read in.
    const full = (level: number) => ((level - 16) * 255) / 219;
    assert.ok(Math.abs(mean(2, 62) - full(40)) < 6, `top ${mean(2, 62)}`);
    assert.ok(Math.abs(mean(66, 126) - full(220)) < 6, `bottom ${mean(66, 126)}`);
  }
});

test("footage with non-square pixels is cropped where the plan puts the crop", async (t) => {
  const dir = await scratch(t, "anamorphic-");
  // 16:9 stored in 240 × 180 with 4:3 pixels, grey rising from black on the left to white on the
  // right: a column's brightness says where in the source it is.
  const ramp = "geq=lum='16+219*X/W':cb=128:cr=128";
  const spec = { id: "hdv", pattern: "color", width: 240, height: 180, fps: 30, seconds: 1 };
  const source = await makeSource(dir, { ...spec, sound: null, filter: ramp, sar: [4, 3] });
  const indexPath = join(dir, "hdv.index.json");
  const index = validateMediaIndex(JSON.parse(await readFile(indexPath, "utf8")));
  // A face near the left edge, which the crop is pushed against.
  const boxes = [0, 0.5].map((t) => ({ t, x: 0.07, y: 0.3, w: 0.06, h: 0.11 }));
  const face = { id: 0, boxes: boxes as [FaceBox, ...FaceBox[]] };
  const shot: FramedShot = {
    start: 0,
    end: 1,
    layout: "talking_head",
    faces: [face],
    speakers: [],
  };
  index.framing = { fps: 5, shots: [shot] };
  const portrait = { aspect: "9:16", width: 36, height: 64, fps: { num: 30, den: 1 } } as const;
  const crop = cropPath(index, clip("hdv", 0, 1), portrait);
  assert.equal(crop?.type, "static");
  const rect = crop?.type === "static" ? crop.rect : { x: 0, y: 0, w: 1, h: 1 };
  const main = [{ ...clip("hdv", 0, 1), framing: { crop } }];
  const project = projectOf([source], main as Project["main"], portrait);
  const result = await render(await write(dir, project), join(dir, "out.mp4"));
  const [frame] = await grey(result.video, 36, 64);
  assert.ok(frame);
  const column = (x: number) => {
    const values = [...frame].filter((_, i) => i % 36 === x);
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };
  // The outermost columns show the source half an output pixel inside the crop's edges.
  const half = rect.w / 36 / 2;
  const edges = [column(0), column(35)];
  const planned = [255 * (rect.x + half), 255 * (rect.x + rect.w - half)];
  for (const [k, edge] of edges.entries()) {
    assert.ok(Math.abs(edge - (planned[k] ?? 0)) < 5, `${edges} rendered, ${planned} planned`);
  }
});

test("a crop path too long for one command-line argument renders every frame", async (t) => {
  const dir = await scratch(t, "dense-path-");
  const ramp = "geq=lum='16+219*X/W':cb=128:cr=128";
  const spec = { id: "ramp", pattern: "color", width: 320, height: 180, fps: 30, seconds: 11 };
  const source = await makeSource(dir, { ...spec, sound: 220, filter: ramp });
  const portrait = { aspect: "9:16", width: 36, height: 64, fps: { num: 30, den: 1 } } as const;
  const w = 9 / 16 / (16 / 9);
  // 3000 keyframes over 10 s, the crop's centre swinging between 0.3 and 0.7 every frame's
  // tenth: an expression of well over 128 KiB, Linux's limit for one argument.
  const centreAt = (ticks: number) => 0.5 + 0.2 * Math.sin(ticks / 1000);
  const keyframes = Array.from({ length: 3000 }, (_, k) => {
    const ticks = k * 400;
    return { t: ticks, rect: { x: centreAt(ticks) - w / 2, y: 0, w, h: 1 } };
  });
  const main = [{ ...clip("ramp", 0, 10), framing: { crop: { type: "path", keyframes } } }];
  const project = projectOf([source], main as Project["main"], portrait);
  const result = await render(await write(dir, project), join(dir, "out.mp4"));
  const frames = await grey(result.video, 36, 64);
  assert.equal(frames.length, 300);
  const brightness = frames.map((frame) => frame.reduce((sum, v) => sum + v, 0) / frame.length);
  // Frame k reads the path a millisecond (120 ticks) after its time, as the clock reads the
  // picture; the first frame gives the offset from scaling and pixel edges.
  const offset = (brightness[0] ?? 0) - 255 * centreAt(120);
  for (const [k, mean] of brightness.entries()) {
    const ticks = k * 4000 + 120;
    const before = Math.floor(ticks / 400) * 400;
    const centre =
      centreAt(before) + ((centreAt(before + 400) - centreAt(before)) * (ticks - before)) / 400;
    assert.ok(Math.abs(mean - offset - 255 * centre) < 1.5, `frame ${k}: ${mean} for ${centre}`);
  }
});

test("untagged footage keeps its colours, read with the matrix players assume for its size", async (t) => {
  const dir = await scratch(t, "matrix-");
  // One flat colour, as YUV values without a tag saying which matrix they use.
  const flat = "format=yuv420p,geq=lum=63:cb=102:cr=240";
  for (const [width, height] of [
    [1280, 720],
    [640, 360],
  ] as const) {
    const spec = { id: `flat${height}`, pattern: "color", width, height, fps: 30, seconds: 1 };
    const source = await makeSource(dir, { ...spec, sound: null, filter: flat });
    const output = { ...tiny, width, height };
    const project = projectOf([source], [clip(source.id, 0, 0.2)], output);
    const result = await render(await write(dir, project), join(dir, `${source.id}.out.mp4`));
    const raw = join(dir, `${source.id}.yuv`);
    await run(await ffmpeg(), [
      ...QUIET,
      "-i",
      result.video,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "yuv420p",
      raw,
    ]);
    const frame = await readFile(raw);
    const size = width * height;
    // The output is tagged BT.709: the HD source passes through unchanged, and the SD one,
    // read as BT.601, converts.
    const yuv = [frame[0], frame[size], frame[size + size / 4]];
    if (height === 720) assert.deepEqual(yuv, [63, 102, 240]);
    else assert.notDeepEqual(yuv, [63, 102, 240]);
  }
});

test("a push-in zooms on exact frames, smoothly and about the centre, across pieces", async (t) => {
  const dir = await scratch(t, "push-");
  // A white square, 40 pixels wide, in the middle of a black frame.
  const square = await makeSource(dir, {
    id: "square",
    pattern: "color",
    filter: "drawbox=x=140:y=70:w=40:h=40:color=white:t=fill",
    width: 320,
    height: 180,
    fps: 30,
    seconds: 3,
    sound: null,
  });
  const path = (from: number): ScalePath => ({
    type: "path",
    keyframes: [
      { t: Math.round(from * SECOND), scale: 1 },
      { t: Math.round((from + 0.6) * SECOND), scale: 1.5 },
    ],
  });
  // The dissolve blends the end of the first clip with the start of the second, which shows the
  // same picture 0.2 s later in its source at the same scale, so every frame follows one push.
  const project = projectOf(
    [square],
    [
      { ...clip("square", 0, 1), framing: { scale: path(0.3) } },
      {
        ...clip("square", 1, 0.6),
        transition: { type: "dissolve", duration: SECOND / 5 },
        framing: { scale: path(0.5) },
      },
    ],
    { ...tiny, width: 320, height: 180 },
  );
  const result = await render(await write(dir, project), join(dir, "out.mp4"));
  const picture = await grey(result.video, 320, 180);
  assert.equal(picture.length, 42);
  const eased = (seconds: number) => {
    const u = Math.min(1, Math.max(0, (seconds - 0.3) / 0.6));
    return 1 + (0.5 * (1 - Math.cos(Math.PI * u))) / 2;
  };
  for (const [n, frame] of picture.entries()) {
    const row = frame.subarray(90 * 320, 91 * 320);
    const white = row[160] ?? 0;
    const black = row[2] ?? 0;
    let width = 0;
    let moment = 0;
    for (const [x, value] of row.entries()) {
      const share = (value - black) / (white - black);
      width += share;
      moment += share * x;
    }
    const expected = 40 * eased(n / 30);
    assert.ok(
      Math.abs(width - expected) < 0.6,
      `frame ${n}: ${width} px wide, expected ${expected}`,
    );
    assert.ok(Math.abs(moment / width - 159.5) < 0.25, `frame ${n}: centred at ${moment / width}`);
  }
});

test("a punch-in that steps within a clip changes on the exact frame, each side at its own scale", async (t) => {
  const dir = await scratch(t, "step-");
  // A white square, 40 pixels wide, in the middle of a black frame.
  const square = await makeSource(dir, {
    id: "square",
    pattern: "color",
    filter: "drawbox=x=140:y=70:w=40:h=40:color=white:t=fill",
    width: 320,
    height: 180,
    fps: 30,
    seconds: 2,
    sound: null,
  });
  const scale: ScalePath = {
    type: "path",
    keyframes: [
      { t: SECOND / 2 - 1, scale: 1 },
      { t: SECOND / 2, scale: 1.25 },
    ],
  };
  const project = projectOf([square], [{ ...clip("square", 0, 1), framing: { scale } }], {
    ...tiny,
    width: 320,
    height: 180,
  });
  const result = await render(await write(dir, project), join(dir, "out.mp4"));
  const picture = await grey(result.video, 320, 180);
  assert.equal(picture.length, 30);
  for (const [n, frame] of picture.entries()) {
    const row = frame.subarray(90 * 320, 91 * 320);
    const width = row.filter((value) => value > 128).length;
    assert.equal(width, n < 15 ? 40 : 50, `frame ${n}`);
  }
});

test("steps and a push-in in one clip at 29.97 fps render every frame, each at its scale", async (t) => {
  const dir = await scratch(t, "steps-push-");
  // A white square, 40 pixels wide, in the middle of a black frame.
  const square = await makeSource(dir, {
    id: "square",
    pattern: "color",
    filter: "drawbox=x=140:y=70:w=40:h=40:color=white:t=fill",
    width: 320,
    height: 180,
    fps: 30000 / 1001,
    seconds: 4,
    sound: null,
  });
  const ntsc = { ...tiny, width: 320, height: 180, fps: { num: 30000, den: 1001 } } as const;
  // A step to 1.25 at 1 s, a push from 1.25 to 1.325 over 1.5-2 s, and a step back at 2.5 s; and
  // a clip of one step.
  const pushed: ScalePath = {
    type: "path",
    keyframes: [
      { t: SECOND - 1, scale: 1 },
      { t: SECOND, scale: 1.25 },
      { t: 1.5 * SECOND, scale: 1.25 },
      { t: 2 * SECOND, scale: 1.325 },
      { t: 2.5 * SECOND - 1, scale: 1.325 },
      { t: 2.5 * SECOND, scale: 1 },
    ],
  };
  const stepped: ScalePath = {
    type: "path",
    keyframes: [
      { t: 3.4 * SECOND - 1, scale: 1 },
      { t: 3.4 * SECOND, scale: 1.25 },
    ],
  };
  const project = projectOf(
    [square],
    [
      { ...clip("square", 0.5, 2.3), framing: { scale: pushed } },
      { ...clip("square", 3, 0.8), framing: { scale: stepped } },
    ],
    ntsc,
  );
  const result = await render(await write(dir, project), join(dir, "out.mp4"));
  const picture = await grey(result.video, 320, 180);
  const frames = (seconds: number) => Math.round((seconds * 30000) / 1001);
  assert.equal(picture.length, frames(2.3) + frames(0.8));
  const width = (n: number) =>
    (picture[n] as Uint8Array).subarray(90 * 320, 91 * 320).filter((v) => v > 128).length;
  // Output frame n of the first clip shows source time 0.5 s + n frames.
  const at = (seconds: number) => Math.ceil(((seconds - 0.5) * 30000) / 1001);
  assert.equal(width(at(1) - 1), 40);
  assert.equal(width(at(1)), 50);
  assert.ok(Math.abs(width(at(2.2)) - 53) <= 1, `${width(at(2.2))}`);
  assert.equal(width(at(2.5) - 1 + 1), 40);
  const second = frames(2.3);
  assert.equal(width(second + Math.ceil((0.4 * 30000) / 1001) - 1), 40);
  assert.equal(width(second + Math.ceil((0.4 * 30000) / 1001)), 50);
});

test("a punch-in and a push-in about an anchor keep it still on screen", async (t) => {
  const dir = await scratch(t, "anchor-");
  // A white square, 40 pixels wide, centred at x = 60 of a 320-pixel frame: the anchor.
  const square = await makeSource(dir, {
    id: "square",
    pattern: "color",
    filter: "drawbox=x=40:y=70:w=40:h=40:color=white:t=fill",
    width: 320,
    height: 180,
    fps: 30,
    seconds: 3,
    sound: null,
  });
  const anchor = { x: 60 / 320, y: 0.5 };
  const pushed: ScalePath = {
    type: "path",
    keyframes: [
      { t: SECOND, scale: 1 },
      { t: Math.round(1.6 * SECOND), scale: 1.5 },
    ],
  };
  const project = projectOf(
    [square],
    [
      { ...clip("square", 0, 1), framing: { scale: 1.25, anchor } },
      { ...clip("square", 1, 2), framing: { scale: pushed, anchor } },
    ],
    { ...tiny, width: 320, height: 180 },
  );
  const result = await render(await write(dir, project), join(dir, "out.mp4"));
  const picture = await grey(result.video, 320, 180);
  for (const [n, frame] of picture.entries()) {
    const row = frame.subarray(90 * 320, 91 * 320);
    let width = 0;
    let moment = 0;
    for (const [x, value] of row.entries()) {
      const share = Math.min(1, Math.max(0, (value - 16) / (235 - 16)));
      width += share;
      moment += share * x;
    }
    const centre = moment / width;
    assert.ok(Math.abs(centre - 59.5) < 0.6, `frame ${n}: the square is at ${centre}`);
    const expected = n < 30 ? 50 : n >= 48 ? 60 : undefined;
    if (expected) assert.ok(Math.abs(width - expected) < 1, `frame ${n}: ${width} px wide`);
  }
});

test("an edit without any sound still has a silent audio track, left unnormalised", async (t) => {
  const dir = await scratch(t, "silent-");
  const specs = everyKind(64, 36, 2).filter(
    (spec) => spec.sound === null || spec.sound === "silent",
  );
  const sources = [];
  for (const spec of specs) sources.push(await makeSource(dir, spec));
  const project = projectOf(
    sources,
    [clip("h-mute", 0.2, 0.5), clip("i-silent", 0.4, 0.5)] as Project["main"],
    { ...tiny, width: 64, height: 36 },
  );
  const result = await render(await write(dir, project), join(dir, "out.mp4"));
  assert.equal(result.loudness, null);
  const { samples, frames } = await inspect(result.video);
  assert.equal(frames, 30);
  assert.equal(samples.length, 30 * 1600);
  assert.ok(samples.every((value) => value === 0));
});

test("a mix louder than loudness normalisation measures is still normalised", async (t) => {
  const dir = await scratch(t, "hot-");
  const bin = await ffmpeg();
  // A full-scale square wave in both channels measures about +3 LUFS.
  const square = "sgn(sin(2*PI*440*t))";
  const hot = join(dir, "hot.f32");
  const lavfi = `aevalsrc='${square}|${square}':s=48000:d=3`;
  await run(bin, [...QUIET, "-f", "lavfi", "-i", lavfi, ...RAW_AUDIO, hot]);
  const target = { integratedLufs: -14, truePeakDbtp: -1 };
  const measure = (file: string) =>
    run(bin, [
      "-hide_banner",
      "-nostats",
      ...RAW_AUDIO,
      "-i",
      file,
      "-af",
      measureLoudness(target),
      "-f",
      "null",
      "-",
    ]);
  const measured = parseMeasurement((await measure(hot)).stderr);
  assert.ok(measured.input_i > 0, String(measured.input_i));
  const out = join(dir, "master.f32");
  const master = masterAudio("", measured, target, 3 * 48_000);
  await run(bin, [...QUIET, ...RAW_AUDIO, "-i", hot, "-af", master, ...RAW_AUDIO, out]);
  const after = parseMeasurement((await measure(out)).stderr);
  assert.ok(Math.abs(after.input_i - target.integratedLufs) < 1, String(after.input_i));
});

test("a noisy mix with sharp transients keeps its true-peak ceiling once encoded", async (t) => {
  const dir = await scratch(t, "peaks-");
  const source = await makeSource(dir, {
    id: "clicks",
    pattern: "testsrc2",
    width: 64,
    height: 36,
    fps: 30,
    seconds: 8,
    sound: "transients",
  });
  const project = projectOf([source], [clip("clicks", 0, 8)], { ...tiny, width: 64, height: 36 });
  const result = await render(await write(dir, project), join(dir, "out.mp4"));
  const ceiling = project.audio.loudness.truePeakDbtp;
  const log = await run(await ffmpeg(), [
    "-hide_banner",
    "-nostats",
    "-i",
    result.video,
    "-af",
    truePeakFilter,
    "-f",
    "null",
    "-",
  ]);
  const peak = parseTruePeak(log.stderr);
  assert.ok(peak <= ceiling, `true peak ${peak} dBTP over ${ceiling}`);
  assert.equal(result.loudness?.truePeakDbtp, peak);
  // Limited no further than it had to be: within a dB of the ceiling.
  assert.ok(peak > ceiling - 1, `true peak ${peak} dBTP`);
});

test("a sound whose encoded peak will not settle under the target keeps its lowest try", async () => {
  // AAC's overshoot does not fall steadily with the limiter's ceiling: encoded peaks as measured
  // on noise with 2 ms bursts at 17 kHz, each try with a lower ceiling.
  const peaks = [1.1, -0.7, -0.5, 0.3, -0.2, 0.4];
  const ceilings: (number | undefined)[] = [];
  const discarded: number[] = [];
  const kept = await limitPeak(
    -1,
    async (ceiling, n) => {
      ceilings.push(ceiling);
      return peaks[n] ?? assert.fail(`try ${n + 1}`);
    },
    async (n) => {
      discarded.push(n);
    },
  );
  assert.deepEqual(kept, { n: 1, peak: -0.7 });
  assert.deepEqual(discarded.sort(), [0, 2, 3, 4, 5]);
  assert.equal(ceilings.length, peaks.length);
  // Each try sets the limiter lower than the one before.
  for (let i = 2; i < ceilings.length; i++) {
    assert.ok((ceilings[i] ?? 0) < (ceilings[i - 1] ?? 0), JSON.stringify(ceilings));
  }
  // One under the target is kept at once.
  assert.deepEqual(await limitPeak(-1, async () => -1.5), { n: 0, peak: -1.5 });
});

test("a peak search that overshoots well under the target tries again nearer it", async () => {
  // Encoded peaks by limiter ceiling: Windows' tries on noise with sharp transients (none,
  // -1.6, -3.9), and Linux's at forced ceilings between, from #16; the nearest ceiling is used.
  const measured: [number, number][] = [
    [-1.4, 0.1], [-1.5, -0.5], [-1.6, 1.2], [-1.7, -0.3], [-1.8, -1.1], [-2.0, -1.0],
    [-2.2, -1.2], [-2.5, -2.0], [-2.75, -2.0], [-3.0, -1.4], [-3.9, -2.3],
  ]; // biome-ignore format: a table
  const encoded = (ceiling: number | undefined) =>
    ceiling === undefined
      ? -0.5
      : measured.reduce((a, b) => (Math.abs(b[0] - ceiling) < Math.abs(a[0] - ceiling) ? b : a))[1];
  const kept = await limitPeak(-1, async (ceiling) => encoded(ceiling));
  assert.ok(kept.peak <= -1 && kept.peak > -2, `kept ${kept.peak} dBTP`);
});

test("a source that changed since planning fails before anything is rendered", async (t) => {
  const dir = await scratch(t, "changed-");
  const [spec] = everyKind(64, 36, 1);
  assert.ok(spec);
  const source = await makeSource(dir, spec);
  const project = projectOf([source], [clip(source.id, 0, 0.5)], {
    ...tiny,
    width: 64,
    height: 36,
  });
  project.sources[0].fingerprint.sha256 = "f".repeat(64);
  const out = join(dir, "out.mp4");
  await assert.rejects(
    render(await write(dir, project), out),
    /a30: a30\.mp4 changed since the edit was planned/,
  );
  await assert.rejects(access(out));
});

/** A stereo WAV of a 1 kHz tone, as a music source. */
async function song(dir: string, id: string, seconds: number): Promise<Source> {
  const path = join(dir, `${id}.wav`);
  const tone = `sine=f=1000:sample_rate=48000:d=${seconds}`;
  await run(await ffmpeg(), [...QUIET, "-f", "lavfi", "-i", tone, "-ac", "2", path]);
  const bytes = await readFile(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  return { id, kind: "audio", path: `${id}.wav`, fingerprint: { bytes: bytes.length, sha256 } };
}

/** The left channel of a sound file, as 48 kHz samples. */
async function left(file: string): Promise<Float32Array> {
  const pcm = `${file}.left.f32`;
  await run(await ffmpeg(), [
    ...QUIET,
    "-y",
    "-i",
    file,
    "-af",
    "pan=mono|c0=c0",
    "-ar",
    "48000",
    "-f",
    "f32le",
    pcm,
  ]);
  const bytes = await readFile(pcm);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
}

/** RMS level in dB of [from, to) seconds. */
function level(samples: Float32Array, from: number, to: number): number {
  const part = samples.subarray(Math.round(from * 48_000), Math.round(to * 48_000));
  const power = part.reduce((sum, value) => sum + value * value, 0) / part.length;
  return 10 * Math.log10(power);
}

test("music plays under the main sound, ducked while someone speaks, its licence beside the video", async (t) => {
  const dir = await scratch(t, "music-");
  const [spec] = everyKind(64, 36, 4);
  assert.ok(spec);
  const source = await makeSource(dir, spec);
  // The index says someone speaks from 1 to 2 s.
  const indexPath = join(dir, source.index ?? "");
  const index = JSON.parse(await readFile(indexPath, "utf8"));
  await writeFile(indexPath, JSON.stringify({ ...index, speech: [{ start: 1, end: 2 }] }));
  const music = await song(dir, "song", 5);
  const project = projectOf([source, music], [clip(source.id, 0, 3)], {
    ...tiny,
    width: 64,
    height: 36,
  });
  const license = {
    name: "CC BY 4.0",
    url: "https://creativecommons.org/licenses/by/4.0/",
    attribution: "Song by Someone",
  };
  project.audio.music = [
    {
      source: "song",
      license,
      in: SECOND,
      out: 4 * SECOND,
      start: 0,
      gainDb: -6,
      ducking: { depthDb: -12, attackMs: 200, releaseMs: 300 },
    },
  ];
  const stems = join(dir, "stems");
  const result = await render(await write(dir, project), join(dir, "out", "edit.mp4"), { stems });

  const { frames, samples } = await inspect(result.video);
  assert.equal(frames, 90);
  assert.equal(samples.length, 90 * 1600);
  const bed = await left(join(stems, "music.wav"));
  assert.equal(bed.length, 90 * 1600);
  assert.equal((await left(join(stems, "voice.wav"))).length, 90 * 1600);
  const full = level(await left(join(dir, "song.wav")), 1, 4) - 6;
  const near = (actual: number, expected: number, within: number, what: string) =>
    assert.ok(Math.abs(actual - expected) <= within, `${what}: ${actual} dB, not ${expected}`);
  near(level(bed, 0.2, 0.6), full, 0.1, "before speech");
  near(level(bed, 1.1, 1.9), full - 12, 0.1, "while speaking");
  // The attack is over before speech starts, and the release begins when it ends.
  near(level(bed, 0.895, 0.905), full - 6, 0.5, "halfway down, 0.1 s before speech");
  near(level(bed, 2.145, 2.155), full - 6, 0.5, "halfway up, 0.15 s after speech");
  near(level(bed, 2.4, 2.9), full, 0.1, "after speech");

  assert.equal(result.music, join(dir, "out", "edit.music.txt"));
  assert.equal(
    await readFile(result.music ?? "", "utf8"),
    "Music in edit.mp4, with the licence each track is used under.\n\nsong.wav\n" +
      "  Licence: CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)\n" +
      "  Credit: Song by Someone\n",
  );
  const copy = await loadJson(result.project, validateProject);
  assert.deepEqual(copy.audio.music, project.audio.music);
});

test("music rides further down under a quieter speaker, as measured in the render", async (t) => {
  const dir = await scratch(t, "ride-");
  const base = { pattern: "testsrc2", width: 64, height: 36, fps: 30, seconds: 3 };
  const loud = await makeSource(dir, { ...base, id: "loud", sound: 220 });
  const quiet = await makeSource(dir, { ...base, id: "quiet", sound: 330, soundDb: -10 });
  for (const source of [loud, quiet]) {
    const path = join(dir, source.index ?? "");
    const index = JSON.parse(await readFile(path, "utf8"));
    await writeFile(path, JSON.stringify({ ...index, speech: [{ start: 0.1, end: 2.9 }] }));
  }
  const music = await song(dir, "song", 7);
  const project = projectOf([loud, quiet, music], [clip("loud", 0, 3), clip("quiet", 0, 3)], {
    ...tiny,
    width: 64,
    height: 36,
  });
  project.audio.music = [
    {
      source: "song",
      license: { name: "CC0 1.0" },
      in: 0,
      out: 6 * SECOND,
      start: 0,
      gainDb: -6,
      ducking: { depthDb: -12, attackMs: 250, releaseMs: 750 },
    },
  ];
  const stems = join(dir, "stems");
  await render(await write(dir, project), join(dir, "out.mp4"), { stems });
  const bed = await left(join(stems, "music.wav"));
  const full = level(await left(join(dir, "song.wav")), 1, 5) - 6;
  // The speech of the edit is the power mean of both, 2.6 LU over the quiet one's -10.
  const ride = 10 - 10 * Math.log10(2 / 1.1);
  const near = (actual: number, expected: number, what: string) =>
    assert.ok(Math.abs(actual - expected) <= 0.3, `${what}: ${actual} dB, not ${expected}`);
  near(level(bed, 0.5, 2.6), full - 12, "under the loud speaker");
  near(level(bed, 3.2, 5.8), full - 12 - ride, "under the quiet one");
});

test("what the renderer does not draw yet fails the render instead of being dropped", async (t) => {
  const dir = await scratch(t, "unrendered-");
  const [spec] = everyKind(64, 36, 1);
  assert.ok(spec);
  const source = await makeSource(dir, spec);
  const project = projectOf(
    [source],
    [
      {
        ...clip(source.id, 0, 0.5),
        framing: {
          crop: { type: "static", rect: { x: 0, y: -0.5, w: 1, h: 2 } },
          scale: 1.1,
        },
      },
    ],
    { ...tiny, width: 64, height: 36 },
  );
  project.audio.music = [];
  const problem = "/main/0/framing/scale: a zoom on a crop past the picture or a split screen";
  assert.deepEqual(unrendered(project), [problem]);
  await assert.rejects(
    render(await write(dir, project), join(dir, "out.mp4")),
    new RegExp(`does not draw these yet:\\n${problem.replaceAll("/", "\\/")}$`),
  );
});

test("captions show on exactly the frames they are laid out on, at 30 and 29.97 fps", async (t) => {
  const dir = await scratch(t, "captions-");
  const black = { pattern: "color", width: 320, height: 180, fps: 30, seconds: 6, sound: 220 };
  const source = await makeSource(dir, { ...black, id: "a" });
  for (const fps of [
    { num: 30, den: 1 },
    { num: 30000, den: 1001 },
  ]) {
    const project = projectOf([source], [clip("a", 0, 5.5)], {
      ...tiny,
      width: 320,
      height: 180,
      fps,
    });
    // At 30 fps frame 111 starts at exactly 3.7 s, which FFmpeg hands libass as 3699 ms.
    const line = (start: number, end: number, text: string) => ({
      start: Math.round(start * SECOND),
      end: Math.round(end * SECOND),
      language: "zh-TW",
      text,
      words: [...text].map((char, i, all) => ({
        text: char,
        start: Math.round((start + ((end - start) * i) / all.length) * SECOND),
        end: Math.round((start + ((end - start) * (i + 1)) / all.length) * SECOND),
      })),
    });
    project.captions = {
      preset: "bold",
      srt: true,
      lines: [line(1, 1.6, "字幕"), line(3.7, 4.3, "同步")],
    };
    const path = await write(dir, project);
    const result = await render(path, join(dir, "out.mp4"));
    const timeline = buildTimeline(project, await loadSources(project, path));
    const built = await buildCaptions(project, timeline);
    assert.ok(built);
    const shown = built.pages.map((page) => [page.start, page.end]);
    if (fps.den === 1) assert.equal(shown[1]?.[0], 111);
    const picture = await grey(result.video, 320, 180);
    for (const [n, frame] of picture.entries()) {
      const covering = shown.some(([start = 0, end = 0]) => n >= start && n < end);
      const brightest = Math.max(...frame);
      const at = `${fps.num}/${fps.den} fps, frame ${n}`;
      if (covering) assert.ok(brightest > 25, `${at}: no caption, brightest ${brightest}`);
      else assert.ok(brightest <= 4, `${at}: a caption shows, brightest ${brightest}`);
    }
    assert.equal(await readFile(result.captions ?? "", "utf8"), built.srt);
  }
});

test("every caption preset is drawn in the face its layout was measured in", async (t) => {
  const dir = await scratch(t, "faces-");
  const bin = await ffmpeg();
  for (const [name, preset] of Object.entries(PRESETS)) {
    const edit = fakeProject([clip("a", 0, 0.5)], {
      captions: {
        preset: name,
        srt: false,
        lines: [{ start: 0, end: SECOND / 2, language: "zh-TW", text: "用 workflow 剪片" }],
      },
    });
    edit.output = { ...edit.output, ...tiny };
    const built = await buildCaptions(edit, { main: [], broll: [], frames: 15, frameTicks: 4000 });
    assert.ok(built);
    const folder = join(dir, name);
    await mkdir(folder);
    await writeFile(join(folder, "captions.ass"), built.ass);
    // Staged as the render stages them; libass has to find the face whatever fonts the machine has.
    const env = { ...process.env, ...(await stageFonts(folder, [built.font])) };
    const lavfi = `color=black:s=${tiny.width}x${tiny.height}:r=30:d=0.5`;
    const args = [
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "debug",
      "-f",
      "lavfi",
      "-i",
      lavfi,
      "-vf",
      captionFilter("captions.ass"),
      "-f",
      "null",
      "-",
    ];
    const { stderr } = await execFileAsync(bin, args, { cwd: folder, env });
    const selected = [...stderr.matchAll(/fontselect: \(.*?\) -> ([^,]+),/g)].map((m) => m[1]);
    assert.ok(selected.length > 0, `${name}: libass selected no face`);
    const face = basename(built.font, ".otf");
    assert.deepEqual(
      new Set(selected.map((path) => basename(path ?? "", ".otf"))),
      new Set([face]),
      `${name}: weight ${preset.weight}`,
    );
  }
});

test("caption colours land in the BT.709 output as BT.709 values", async (t) => {
  const dir = await scratch(t, "colours-");
  const [width, height] = [64, 36];
  // Untagged black frames, as the pieces pipe them to the encoder.
  const black = Buffer.alloc((width * height * 3) / 2, 128);
  black.fill(16, 0, width * height);
  await writeFile(join(dir, "black.yuv"), black);
  const accent = COLORS.accent;
  const bgr = `&H${accent.slice(5, 7)}${accent.slice(3, 5)}${accent.slice(1, 3)}&`.toUpperCase();
  const box = `{\\an7\\pos(0,0)\\bord0\\shad0\\1c${bgr}\\p1}m 0 0 l ${width} 0 ${width} ${height} 0 ${height}`;
  await writeFile(
    join(dir, "captions.ass"),
    [
      "[Script Info]",
      "ScriptType: v4.00+",
      `PlayResX: ${width}`,
      `PlayResY: ${height}`,
      "",
      "[V4+ Styles]",
      "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
      `Style: Box,${family(700)},20,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,1,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
      "",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      `Dialogue: 0,0:00:00.00,0:00:01.00,Box,,0,0,0,,${box}`,
      "",
    ].join("\n"),
  );
  const env = { ...process.env, ...(await stageFonts(dir, [await fontFile(700)])) };
  const args = [
    ...QUIET,
    ...RAW_VIDEO,
    "-video_size",
    `${width}x${height}`,
    "-i",
    "black.yuv",
    "-vf",
    captionFilter("captions.ass"),
    "-f",
    "rawvideo",
    "-pix_fmt",
    "yuv420p",
    "out.yuv",
  ];
  await execFileAsync(await ffmpeg(), args, { cwd: dir, env });
  const frame = await readFile(join(dir, "out.yuv"));
  const size = width * height;
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(accent.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const expected = [16 + 219 * y, 128 + (224 * (b - y)) / 1.8556, 128 + (224 * (r - y)) / 1.5748];
  const actual = [frame[0], frame[size], frame[size + size / 4]] as number[];
  for (const [i, value] of actual.entries()) {
    const at = `${"YUV"[i]}: ${actual} against ${expected.map(Math.round)}`;
    assert.ok(Math.abs(value - (expected[i] as number)) <= 1, at);
  }
});

test("a match and a look render as their LUT computes them, wherever the output goes", async (t) => {
  const dir = await scratch(t, "graded-");
  // Three flat patches: a skin tone, sky and grey.
  const patches = [
    [194, 150, 130],
    [98, 122, 157],
    [128, 128, 128],
  ];
  const channel = (c: number) =>
    `if(lt(X,32),${patches[0]?.[c]},if(lt(X,64),${patches[1]?.[c]},${patches[2]?.[c]}))`;
  const source = await makeSource(dir, {
    id: "flat",
    pattern: "color",
    width: 96,
    height: 54,
    fps: 30,
    seconds: 1,
    sound: null,
    filter: `format=rgb24,geq=r='${channel(0)}':g='${channel(1)}':b='${channel(2)}'`,
  });
  const plain = projectOf([source], [clip("flat", 0, 0.5)], { ...tiny, width: 96, height: 54 });
  const grade = {
    match: {
      reference: "flat",
      matrix: [
        [1.05, 0.02, 0],
        [0, 0.97, 0],
        [0.01, 0, 0.92],
      ] as [[number, number, number], [number, number, number], [number, number, number]],
      offset: [0.01, 0, -0.02] as [number, number, number],
    },
    look: { id: "film", intensity: 0.8 },
  };
  const graded = { ...plain, main: [{ ...clip("flat", 0, 0.5), grade }] } as Project;
  const before = await render(await write(dir, plain), join(dir, "plain.mp4"));
  // A folder name with every character a filter graph treats specially. Windows names hold no
  // colon, but the drive letter puts one in every path there.
  const odd = join(
    dir,
    process.platform === "win32" ? "out dir, [a]; it's here" : "out dir, [a]; it's: here",
  );
  const after = await render(await write(dir, graded), join(odd, "graded.mp4"));
  const pixels = async (file: string) => {
    const raw = `${file}.rgb`;
    await run(await ffmpeg(), [
      ...QUIET,
      "-y",
      "-i",
      file,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      raw,
    ]);
    const frame = await readFile(raw);
    return [16, 48, 80].map((x) => [...frame.subarray((27 * 96 + x) * 3, (27 * 96 + x) * 3 + 3)]);
  };
  const shown = await pixels(before.video);
  const matched = await pixels(after.video);
  for (const [i, colour] of shown.entries()) {
    const expected = gradeColour(grade, colour.map((v) => v / 255) as Rgb).map((v) => v * 255);
    const got = matched[i] ?? [];
    for (const c of [0, 1, 2]) {
      const at = `patch ${i}: ${got} against ${expected.map(Math.round)} from ${colour}`;
      assert.ok(Math.abs((got[c] ?? 0) - (expected[c] ?? 0)) <= 2, at);
    }
  }
  const unknown = {
    ...plain,
    main: [{ ...clip("flat", 0, 0.5), grade: { look: { id: "teal", intensity: 1 } } }],
  };
  await assert.rejects(
    render(await write(dir, unknown as Project), join(dir, "unknown.mp4")),
    /\/main\/0\/grade\/look\/id: no look teal; the looks are clean, warm, cool, film/,
  );
});

/** A rendered overlay as FFmpeg draws it: `frames` frames of VP9 with alpha, opaque on the left
 * half with luma 40 + 4 × the frame's number, transparent on the right. */
async function numbered(file: string, frames: number, width: number, height: number) {
  await run(await ffmpeg(), [
    ...QUIET,
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=s=${width}x${height}:r=30`,
    "-vf",
    // Tagged BT.709 as the effects' overlays are; FFmpeg 7.1 converts untagged ones to the
    // picture's matrix first.
    "format=yuva420p,geq=lum='40+4*N':cb=128:cr=128:a='if(lt(X,W/2),255,0)',setparams=colorspace=bt709:range=tv",
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

test("overlays land on exact output frames, across cuts and dissolves", async (t) => {
  const dir = await scratch(t, "overlays-");
  const black = { pattern: "color", width: 64, height: 36, fps: 30, seconds: 4, sound: 220 };
  const sources = [
    await makeSource(dir, { ...black, id: "a" }),
    await makeSource(dir, { ...black, id: "b" }),
  ];
  for (const fps of [
    { num: 30, den: 1 },
    { num: 30000, den: 1001 },
  ]) {
    const project = projectOf(
      sources,
      [
        clip("a", 0.5, 1),
        { ...clip("b", 0.5, 1), transition: { type: "dissolve", duration: SECOND / 5 } },
        clip("a", 2, 1),
      ],
      { ...tiny, width: 64, height: 36, fps },
    );
    // At 30 fps: pieces 0-24, the dissolve 24-30, 30-54 and 54-84; the title covers frames
    // 15-63 and the wipe 66-84, cut where the edit ends.
    project.overlays = [
      { template: "title", params: { text: "三倍" }, start: SECOND / 2, duration: 1.6 * SECOND },
      { template: "wipe", params: {}, start: 2.2 * SECOND, duration: SECOND },
    ];
    const path = await write(dir, project);
    const jobs: OverlayJob[] = [];
    const result = await render(path, join(dir, "out.mp4"), {
      renderOverlays: async (requested) => {
        jobs.push(...requested);
        return Promise.all(
          requested.map((job, i) => numbered(join(dir, `fx${i}.webm`), job.frames, 64, 36)),
        );
      },
    });
    const timeline = buildTimeline(project, await loadSources(project, path));
    const placed = timeline.overlays.map((o) => [o.start, o.end]);
    if (fps.den === 1) {
      assert.deepEqual(placed, [
        [15, 63],
        [66, 84],
      ]);
    }
    assert.deepEqual(
      jobs.map((job) => [job.template, job.frames, job.width, job.height, job.fps]),
      [
        ["title", (placed[0]?.[1] ?? 0) - (placed[0]?.[0] ?? 0), 64, 36, fps],
        ["wipe", (placed[1]?.[1] ?? 0) - (placed[1]?.[0] ?? 0), 64, 36, fps],
      ],
    );
    const picture = await grey(result.video, 64, 36);
    assert.equal(picture.length, timeline.frames);
    for (const [n, frame] of picture.entries()) {
      const covering = placed.find(([start = 0, end = 0]) => n >= start && n < end);
      const k = covering ? n - (covering[0] ?? 0) : null;
      const left = frame[18 * 64 + 8] ?? 0;
      const right = frame[18 * 64 + 56] ?? 0;
      // Grey is full range: luma 16 to 235 reads as 0 to 255, so each overlay frame is 4.7
      // levels brighter than the one before. H.264 keeps flat areas within a level or two.
      const expected = k === null ? 0 : ((24 + 4 * k) * 255) / 219;
      const at = `${fps.num}/${fps.den} fps, frame ${n}`;
      assert.ok(Math.abs(left - expected) <= 2, `${at}: luma ${left}, expected ${expected}`);
      assert.ok(right <= 2, `${at}: the transparent half shows ${right}`);
    }
  }

  const project = projectOf(sources, [clip("a", 0, 1)], { ...tiny, width: 64, height: 36 });
  project.overlays = [{ template: "sparkles", params: {}, start: 0, duration: SECOND }];
  await assert.rejects(
    render(await write(dir, project), join(dir, "bad.mp4")),
    /\/overlays\/0\/template: no template sparkles/,
  );
});

test("a split screen: a graphic in the panel, the speaker in step below it, a sound and the credits", async (t) => {
  const dir = await scratch(t, "split-");
  // Each source frame one step brighter, so the speaker's frame shows which source frame it is.
  const speaker = await makeSource(dir, {
    id: "a",
    pattern: "color",
    width: 36,
    height: 64,
    fps: 30,
    seconds: 5,
    sound: 220,
    filter: "geq=lum='16+2*N':cb=128:cr=128",
  });
  const page = {
    ...(await still(dir, "page")),
    credit: { what: "Screenshot of example.com", source: "https://example.com/" },
  };
  const tick = {
    ...(await song(dir, "tick", 0.2)),
    credit: {
      what: "Sound effect tick.wav",
      source: "https://example.com/tick",
      license: { name: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
    },
  };
  const project = projectOf([speaker, page, tick], [clip("a", 1, 3)], {
    ...tiny,
    aspect: "9:16",
    width: 36,
    height: 64,
  });
  // At 30 fps: the graphic covers frames 15-45 in the top 30 rows, pushed down from above over
  // its first 0.35 s; the speaker frames 15-45 below.
  project.graphics = [
    { layout: "panel", html: "<b>27</b>", css: "", start: SECOND / 2, duration: SECOND },
  ];
  project.broll = [
    {
      source: "a",
      in: 1.5 * SECOND,
      out: 2.5 * SECOND,
      start: SECOND / 2,
      rect: { x: 0, y: 0.5, w: 1, h: 0.5 },
    },
    { source: "page", in: 0, out: SECOND / 2, start: 2.5 * SECOND },
  ];
  project.audio.sfx = [{ source: "tick", start: 1.5 * SECOND, gainDb: 0 }];
  const path = await write(dir, project);
  const stems = join(dir, "stems");
  const result = await render(path, join(dir, "out", "edit.mp4"), {
    stems,
    renderGraphics: async (jobs) => {
      assert.deepEqual(
        jobs.map((job) => [job.layout, job.html, job.box, job.frames]),
        [["panel", "<b>27</b>", undefined, 30]],
      );
      return [await numbered(join(dir, "panel.webm"), 30, 36, 30)];
    },
  });
  const picture = await grey(result.video, 36, 64);
  assert.equal(picture.length, 90);
  // Within 3 levels: Apple silicon's FFmpeg build rounds a flat grey up to 2.2 levels away from
  // the Linux build, in one half of a frame where the other half matches.
  const near = (actual: number, expected: number, at: string) =>
    assert.ok(Math.abs(actual - expected) <= 3, `${at}: luma ${actual}, expected ${expected}`);
  for (const [n, frame] of picture.entries()) {
    const top = frame[4 * 36 + 18] ?? 0;
    const bottom = frame[50 * 36 + 18] ?? 0;
    // Frame n of the edit shows source frame 30 + n, in both halves outside the split and in
    // the lower one inside it. The panel, pushed down from above, reaches row 4 on its second
    // frame.
    const speakerLuma = (2 * (30 + n) * 255) / 219;
    if (n >= 16 && n < 45) near(top, ((24 + 4 * (n - 15)) * 255) / 219, `frame ${n}, the panel`);
    else if (n < 75) near(top, speakerLuma, `frame ${n}, above`);
    if (n < 75) near(bottom, speakerLuma, `frame ${n}, the speaker`);
  }
  // Mid-push, the panel's lower edge has not reached row 25: the speaker still shows there.
  near(picture[17]?.[25 * 36 + 18] ?? 0, (2 * 47 * 255) / 219, "frame 17, below the push");
  near(picture[30]?.[25 * 36 + 18] ?? 0, ((24 + 4 * 15) * 255) / 219, "frame 30, the panel");
  // The sound plays from 1.5 s, at most 2 s of its file, and nowhere else.
  const bed = await left(join(stems, "music.wav"));
  assert.ok(level(bed, 1.52, 1.68) > -30, `${level(bed, 1.52, 1.68)} dB`);
  assert.ok(level(bed, 0, 1.45) < -90 && level(bed, 1.75, 3) < -90);
  assert.equal(result.music, null);
  assert.equal(result.broll, join(dir, "out", "edit.broll.txt"));
  assert.equal(
    await readFile(result.broll ?? "", "utf8"),
    [
      "B-roll in edit.mp4, with where each piece came from.",
      "",
      "Sound effect tick.wav",
      "  Source: https://example.com/tick",
      "  Licence: CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/)",
      "",
      "Screenshot of example.com",
      "  Source: https://example.com/",
      "",
    ].join("\n"),
  );
});

// HyperFrames renders in Chrome Headless Shell, which downloads on the first run; CI skips it, and
// the graph and the frame placement are tested above.
const chrome = { skip: process.env.CI ? "renders with Chrome: run it locally" : false };

test(
  "every effect template renders with HyperFrames and shows only inside its own frames",
  chrome,
  async (t) => {
    const dir = await scratch(t, "templates-");
    for (const [aspect, width, height] of [
      ["16:9", 320, 180],
      ["9:16", 180, 320],
    ] as const) {
      // Grey rather than black, so an overlay that lost its alpha would show as black over it.
      const source = await makeSource(dir, {
        id: `grey-${width}`,
        pattern: "color",
        filter: "lutyuv=y=128:u=128:v=128",
        width,
        height,
        fps: 30,
        seconds: 30,
        sound: 220,
      });
      // One template after another, each at its typical length with a second between them.
      const overlays: NonNullable<Project["overlays"]> = [];
      let at = SECOND;
      for (const template of templateIds) {
        const seconds = catalog[template].seconds.typical;
        const params = catalog[template].example;
        overlays.push({ template, params, start: at, duration: seconds * SECOND });
        at += (seconds + 1) * SECOND;
      }
      const project = projectOf([source], [clip(source.id, 0, at / SECOND)], {
        aspect,
        width,
        height,
        fps: { num: 30, den: 1 },
      });
      project.overlays = overlays;
      const path = await write(dir, project);
      const result = await render(path, join(dir, `${aspect.replace(":", "x")}.mp4`));
      const timeline = buildTimeline(project, await loadSources(project, path));
      const picture = await grey(result.video, width, height);
      assert.equal(picture.length, timeline.frames);
      const corner = (frame: Uint8Array | undefined) => frame?.[(height - 2) * width + width - 2];
      const ground = corner(picture[0]) ?? 0;
      const lit = picture.map((frame) => frame.some((value) => Math.abs(value - ground) > 24));
      for (const { overlay, start, end } of timeline.overlays) {
        const at = `${aspect} ${overlay.template}`;
        const shown = lit.slice(start, end).filter(Boolean).length;
        // The first frame is before the entrance; nothing animates out but the wipe, whose bands
        // cross the frame and leave it.
        assert.ok(shown > (end - start) / 2, `${at}: ${shown} frames`);
        assert.ok(!lit[start - 1] && !lit[start] && !lit[end], at);
        assert.equal(lit[end - 1], overlay.template !== "wipe", `${at}: its last frame`);
        // These leave the bottom-right corner clear, so the picture shows through it.
        if (["lower-third", "chapter"].includes(overlay.template)) {
          for (const frame of picture.slice(start, end)) {
            const value = corner(frame) ?? 0;
            assert.ok(Math.abs(value - ground) <= 2, `${at}: the corner shows ${value}`);
          }
        }
      }
    }
  },
);

test(
  "graphics render with HyperFrames: a label in its box, a panel pushed down, a full frame, an icon",
  chrome,
  async (t) => {
    const dir = await scratch(t, "graphics-");
    const [width, height] = [180, 320];
    const source = await makeSource(dir, {
      id: "grey",
      pattern: "color",
      filter: "lutyuv=y=128:u=128:v=128",
      width,
      height,
      fps: 30,
      seconds: 14,
      sound: 220,
    });
    const project = projectOf([source], [clip("grey", 0, 13)], {
      aspect: "9:16",
      width,
      height,
      fps: { num: 30, den: 1 },
    });
    const box = { x: 0.1, y: 0.3, w: 0.6, h: 0.1 };
    const chip = `<div class="ff-chip" style="position:absolute;left:${0.1 * width + 4}px;top:${0.3 * height + 4}px;animation:ff-rise .4s var(--enter) both"><span style="font-size:calc(var(--u)*6)">27</span></div>`;
    const stage =
      '<div class="ff-stage"></div><b style="position:absolute;inset:0;display:grid;place-items:center;font-size:calc(var(--u)*20);animation:ff-pop .4s var(--enter) .3s both">27</b>';
    project.graphics = [
      { layout: "label", html: chip, css: "", box, start: SECOND, duration: 2 * SECOND },
      { layout: "panel", html: stage, css: "", start: 4 * SECOND, duration: 3 * SECOND },
      { layout: "full", html: stage, css: "", start: 8 * SECOND, duration: 2 * SECOND },
      // A bundled icon alone, loaded from the pages' own folder.
      {
        layout: "label",
        html: `<img src="icons/accent/rocket.svg" style="position:absolute;left:${0.1 * width + 4}px;top:${0.3 * height + 4}px;width:calc(var(--u)*20);height:calc(var(--u)*20);animation:ff-fade .4s both">`,
        css: "",
        box: { x: 0.1, y: 0.3, w: 0.3, h: 0.2 },
        start: 10.5 * SECOND,
        duration: 2 * SECOND,
      },
    ];
    const path = await write(dir, project);
    const result = await render(path, join(dir, "graphics.mp4"));
    const picture = await grey(result.video, width, height);
    const ground = picture[0]?.[0] ?? 0;
    const changed = (
      frame: Uint8Array | undefined,
      x0: number,
      y0: number,
      x1: number,
      y1: number,
    ) => {
      let count = 0;
      for (let y = Math.floor(y0); y < y1; y++) {
        for (let x = Math.floor(x0); x < x1; x++) {
          if (Math.abs((frame?.[y * width + x] ?? ground) - ground) > 24) count++;
        }
      }
      return count;
    };
    // The label draws inside its box and leaves the rest of the frame as it was.
    const label = picture[75];
    assert.ok(
      changed(
        label,
        box.x * width,
        box.y * height,
        (box.x + box.w) * width,
        (box.y + box.h) * height,
      ) > 20,
    );
    assert.equal(changed(label, 0, (box.y + box.h) * height + 2, width, height), 0);
    assert.equal(changed(picture[29], 0, 0, width, height), 0);
    // The panel covers the top 880 of every 1920 rows once pushed down; the speaker shows below it.
    const panelRows = Math.round(((880 / 1920) * height) / 2) * 2;
    assert.ok(changed(picture[140], 0, 0, width, panelRows) > 0.9 * width * panelRows);
    assert.equal(changed(picture[140], 0, panelRows + 2, width, height), 0);
    // The full-frame graphic covers it all, after its push from the right.
    assert.ok(changed(picture[280], 0, 0, width, height) > 0.9 * width * height);
    assert.ok(
      changed(picture[241], 0, 0, width / 2, height) <
        changed(picture[241], width / 2, 0, width, height),
    );
    // The icon draws its strokes in its box.
    assert.ok(changed(picture[360], 0.1 * width, 0.3 * height, 0.4 * width, 0.5 * height) > 30);
    assert.equal(changed(picture[360], 0, 0.5 * height + 2, width, height), 0);
  },
);
