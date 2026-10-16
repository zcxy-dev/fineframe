// Synthetic footage for tests and measurements: FFmpeg test patterns with a distinct tone per
// source, written with the media index vework would write for them.

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MediaIndex, Project, Source } from "@video-editor/schema";
import { ffmpeg, run } from "./ffmpeg.ts";
import { QUIET } from "./graph/encode.ts";

export interface SyntheticSpec {
  id: string;
  /** lavfi video source name: testsrc2, smptebars, ... */
  pattern: string;
  width: number;
  height: number;
  fps: number;
  seconds: number;
  /** A sine tone at this frequency, 1 kHz beeps from 0.6 s to 0.7 s into every second, white
   * noise with a 3 ms burst near 12 kHz every 0.9 s (whose peaks fall between samples, as a noisy
   * recording's clicks do), a silent track, or no audio stream. */
  sound: number | "beeps" | "transients" | "silent" | null;
  /** The tone's level against FFmpeg's sine, in dB. */
  soundDb?: number;
  /** More video filters, applied to the picture as stored. */
  filter?: string;
  /** Pixels this shape, width over height, as HDV's 1440 × 1080 stores 16:9 with 4:3 pixels. */
  sar?: [number, number];
  /** Stored landscape with a display matrix that turns it upright, as phones record. */
  rotate?: boolean;
  /** 10-bit, tagged BT.2020 PQ. */
  hdr?: boolean;
  /** Drops frames irregularly, keeping each frame's own timestamp. */
  variable?: boolean;
  /** Darkens and flattens the picture, for the auto grade. */
  dark?: boolean;
  /** Speech for voice processing: `sound`'s tone sounds from 0.25 s to 0.75 s into every second,
   * over white noise at this peak level. The index gets a `voice` section whose stem holds the
   * recording and the tone without the noise, as the denoiser would leave it. */
  noisy?: number;
  /** Matroska with AAC, as OBS records, or WebM with VP8 and Opus, instead of MP4 with H.264 and
   * AAC. */
  container?: "mkv" | "webm";
}

/** One source of every kind the renderer must handle, each with its own tone: 24, 25, 30 and
 * 60 fps, a rotated phone clip, a variable-rate clip, 10-bit PQ, no audio stream and a silent
 * audio track. */
export function everyKind(width: number, height: number, seconds: number): SyntheticSpec[] {
  const base = { width, height, seconds };
  return [
    { ...base, id: "a30", pattern: "testsrc2", fps: 30, sound: 220 },
    { ...base, id: "b25", pattern: "smptebars", fps: 25, sound: 330 },
    { ...base, id: "c24", pattern: "testsrc", fps: 24, sound: 440 },
    { ...base, id: "d60", pattern: "testsrc2", fps: 60, sound: 550 },
    { ...base, id: "e-phone", pattern: "smptehdbars", fps: 30, sound: 660, rotate: true },
    { ...base, id: "f-vfr", pattern: "testsrc2", fps: 30, sound: 770, variable: true },
    { ...base, id: "g-hdr", pattern: "testsrc2", fps: 30, sound: 880, hdr: true },
    { ...base, id: "h-mute", pattern: "rgbtestsrc", fps: 30, sound: null },
    { ...base, id: "i-silent", pattern: "testsrc", fps: 30, sound: "silent" },
  ];
}

/** Writes `<id>.mp4` (or `.mkv`, `.webm`) and `<id>.index.json` into `dir` and returns the
 * project's source entry. */
export async function makeSource(dir: string, spec: SyntheticSpec): Promise<Source> {
  const bin = await ffmpeg();
  const name = `${spec.id}.${spec.container ?? "mp4"}`;
  const file = join(dir, name);
  const webm = spec.container === "webm";
  const video = `${spec.pattern}=s=${spec.width}x${spec.height}:r=${spec.fps}:d=${spec.seconds}`;
  const filters = [
    ...(spec.dark ? ["eq=brightness=-0.2:contrast=0.5"] : []),
    // On the frames: FFmpeg 7.1 takes primaries and transfer from them, not from the options.
    ...(spec.hdr ? ["setparams=color_primaries=bt2020:color_trc=smpte2084"] : []),
    ...(spec.filter ? [spec.filter] : []),
    ...(spec.sar ? [`setsar=${spec.sar[0]}/${spec.sar[1]}`] : []),
    // Keeps 60 of every 77 frames, in an uneven pattern.
    ...(spec.variable ? ["select='not(eq(mod(n,7),3))*not(eq(mod(n,11),5))'"] : []),
  ];
  const sounds = {
    beeps: `aevalsrc='0.5*sin(2*PI*1000*t)*between(mod(t,1),0.6,0.7)':s=48000:d=${spec.seconds}`,
    transients: `aevalsrc='0.02*(2*random(0)-1)+0.95*sin(2*PI*11990*t)*lt(mod(t,0.9),0.003)':s=48000:d=${spec.seconds}`,
    silent: `anullsrc=r=48000:cl=stereo:d=${spec.seconds}`,
  };
  const said = (noise: number) =>
    `0.3*sin(2*PI*${spec.sound}*t)*between(mod(t,1),0.25,0.75)+${noise}*(2*random(0)-1)`;
  const speech = (...channels: string[]) =>
    `aevalsrc='${channels.join("|")}':s=48000:d=${spec.seconds}`;
  const tone = (frequency: number) =>
    `sine=f=${frequency}:sample_rate=48000:d=${spec.seconds}${spec.soundDb ? `,volume=${spec.soundDb}dB` : ""}`;
  const audio =
    spec.sound === null
      ? []
      : spec.noisy !== undefined
        ? [speech(said(spec.noisy))]
        : [typeof spec.sound === "number" ? tone(spec.sound) : sounds[spec.sound]];
  const encode = spec.hdr
    ? ["-pix_fmt", "yuv420p10le", "-color_primaries", "bt2020", "-color_trc", "smpte2084"]
    : ["-pix_fmt", "yuv420p"];
  const target = spec.rotate ? join(dir, `${spec.id}.plain.mp4`) : file;
  await run(bin, [
    ...QUIET,
    "-y",
    "-f",
    "lavfi",
    "-i",
    video,
    ...audio.flatMap((source) => ["-f", "lavfi", "-i", source]),
    ...(filters.length ? ["-vf", filters.join(",")] : []),
    ...(spec.variable ? ["-fps_mode", "passthrough"] : []),
    ...(webm ? ["-c:v", "libvpx", "-deadline", "realtime"] : ["-c:v", "libx264"]),
    ...(webm ? [] : ["-preset", "ultrafast"]),
    ...encode,
    ...(spec.hdr ? ["-colorspace", "bt2020nc"] : []),
    ...(audio.length ? ["-c:a", webm ? "libopus" : "aac", "-shortest"] : []),
    target,
  ]);
  if (spec.rotate) {
    await run(bin, [...QUIET, "-y", "-display_rotation", "90", "-i", target, "-c", "copy", file]);
  }
  const bytes = await readFile(file);
  const index: MediaIndex = {
    version: 1,
    source: {
      name,
      duration: spec.seconds,
      // Where vework's decoder starts these files.
      start: 0,
      video: {
        width: spec.rotate ? spec.height : spec.width,
        height: spec.rotate ? spec.width : spec.height,
        // A quarter turn turns the pixels too.
        sample_aspect: spec.sar
          ? spec.rotate
            ? spec.sar[1] / spec.sar[0]
            : spec.sar[0] / spec.sar[1]
          : 1,
        fps: spec.variable ? (spec.fps * 60) / 77 : spec.fps,
        rotation: spec.rotate ? 90 : 0,
        codec: webm ? "vp8" : "h264",
        transfer: spec.hdr ? 16 : null,
        matrix: spec.hdr ? 9 : null,
      },
      audio:
        spec.sound === null
          ? []
          : [
              {
                index: 0,
                channels: spec.sound === "silent" ? 2 : 1,
                sample_rate: 48000,
                language: null,
              },
            ],
    },
    transitions: [],
    speech: [],
    transcript: { language: null, text: "", words: [] },
  };
  if (spec.noisy !== undefined) {
    const stem = `${spec.id}.voice.wav`;
    const both = speech(said(spec.noisy), said(0));
    await run(bin, [
      ...QUIET,
      "-y",
      "-f",
      "lavfi",
      "-i",
      both,
      "-c:a",
      "pcm_f32le",
      join(dir, stem),
    ]);
    // Plausible values; tests give the chain explicitly.
    const levels = {
      noise_floor_db: -40,
      speech_lufs: -14,
      loudness_range_lu: 3,
      clipped_share: 0,
      rt60: 0.1,
      mud_db: 0,
      presence_db: -12,
    };
    index.voice = { stem, model: "DeepFilterNet3", recorded: levels, denoised: levels };
  }
  await writeFile(join(dir, `${spec.id}.index.json`), JSON.stringify(index));
  return {
    id: spec.id,
    kind: "video",
    path: name,
    index: `${spec.id}.index.json`,
    fingerprint: { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") },
  };
}

/** A 16:9 or 9:16 project at `fps` whose target is its own length, so any edit fits. */
export function projectOf(
  sources: Source[],
  main: Project["main"],
  output: Pick<Project["output"], "aspect" | "width" | "height" | "fps">,
): Project {
  let ticks = 0;
  for (const clip of main) {
    ticks += clip.out - clip.in;
    if (clip.transition?.type === "dissolve") ticks -= clip.transition.duration;
  }
  return {
    version: 1,
    output: { ...output, target: { duration: ticks, tolerance: 0.05 } },
    sources: sources as Project["sources"],
    main,
    audio: { loudness: { integratedLufs: -14, truePeakDbtp: -1 } },
  };
}
