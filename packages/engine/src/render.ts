import { spawn } from "node:child_process";
import { mkdir, mkdtemp, open, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import {
  cardSize,
  renderCards,
  renderOverlays,
  validateCards,
  validateOverlays,
} from "@video-editor/effects";
import { loadJson, type Project, TICKS_PER_SECOND, validateProject } from "@video-editor/schema";
import { type Credit, cardCredits, creditText } from "./broll/credits.ts";
import { buildCaptions, stageFonts } from "./captions/index.ts";
import { ffmpeg, run } from "./ffmpeg.ts";
import { pastPicture } from "./framing.ts";
import { AAC, alignToAacFrames, encoderArgs, QUIET, RAW_AUDIO } from "./graph/encode.ts";
import {
  linearReach,
  type Measurement,
  masterAudio,
  measureLoudness,
  parseMeasurement,
  parseTruePeak,
  truePeakFilter,
} from "./graph/master.ts";
import {
  addBed,
  envelopeOf,
  momentaryArgs,
  musicBed,
  parseMomentary,
  rides,
} from "./graph/music.ts";
import { pieceAudio, pieceVideo } from "./graph/piece.ts";
import { cube, isLookId, lookIds, lutKey } from "./looks.ts";
import { cutPieces } from "./pieces.ts";
import { loadSources } from "./sources.ts";
import { buildTimeline } from "./timeline.ts";

export interface RenderOptions {
  /** Called as the render advances, with the fraction done (0 to 1) and a line to show. */
  onProgress?: (fraction: number, message: string) => void;
  /** Called while what renders the effect overlays downloads on its first use: its name, and
   * the bytes so far of `total`. */
  onDownload?: (name: string, bytes: number, total: number) => void;
  /** Renders the effect overlays; @video-editor/effects' Remotion renderer unless replaced,
   * as the tests replace it with files FFmpeg draws. */
  renderOverlays?: typeof renderOverlays;
  /** Renders the cards; @video-editor/effects' Remotion renderer unless replaced. */
  renderCards?: typeof renderCards;
  /** A folder to also write the mix's parts into, before loudness normalisation scales them
   * alike: `voice.wav`, the main track and B-roll, and with music `music.wav`, the bed as ducked.
   * vebench measures the voice's lead over the music from them, and a cut check can read the
   * voice without the music. */
  stems?: string;
}

/** The share of the progress bar that rendering overlays takes, when there are any: each
 * overlay frame is a browser screenshot, slower than a frame of the edit. */
const OVERLAY_SHARE = 0.4;
/** Masters of the sound tried for its true peak, and how far under the overshoot each next try
 * sets the limiter. */
const PEAK_TRIES = 6;
const PEAK_STEP_DB = 0.1;
const PEAK_NEAR_DB = 1;

export interface RenderResult {
  /** Absolute paths of what the render wrote. */
  video: string;
  project: string;
  cuts: string;
  /** The captions as SubRip, when the project asks for them. */
  captions: string | null;
  /** `<name>.music.txt`, the licence of each music track the video plays; null without music. */
  music: string | null;
  /** `<name>.broll.txt`, where the B-roll and sound effects the video plays came from; null when
   * none carries a credit. */
  broll: string | null;
  frames: number;
  seconds: number;
  /** The first pass's measurement, whether one linear gain reached the target, and the true peak
   * of the encoded sound; null for a silent edit, which is left as it is. */
  loudness: { measured: Measurement; linear: boolean; truePeakDbtp: number } | null;
}

/**
 * What the project asks for that this renderer does not draw yet. Rendering without it would
 * silently drop part of the edit, so the render fails instead.
 */
export function unrendered(project: Project): string[] {
  const problems: string[] = [];
  const clips = [
    ...project.main.map((clip, i) => [`/main/${i}`, clip] as const),
    ...(project.broll ?? []).map((clip, i) => [`/broll/${i}`, clip] as const),
  ];
  for (const [path, clip] of clips) {
    const crop = clip.framing?.crop;
    const keys = !crop ? [] : crop.type === "static" ? [crop] : crop.keyframes;
    const scaled = (clip.framing?.scale ?? 1) !== 1;
    if (keys.some((key) => key.below && (pastPicture(key.rect) || pastPicture(key.below)))) {
      problems.push(`${path}/framing/crop: a split screen whose halves reach past the picture`);
    }
    if (scaled && keys.some((key) => key.below || pastPicture(key.rect))) {
      problems.push(`${path}/framing/scale: a zoom on a crop past the picture or a split screen`);
    }
    // The part on the picture keeps one size between cuts, so it moves only where it lies inside.
    const moves = keys.some((key, k) => {
      const next = keys[k + 1];
      if (!next || next.rect.w !== key.rect.w || next.rect.h !== key.rect.h) return false;
      // Keyframes a tick apart are a cut, drawn on either side of it on its own.
      if ("t" in key && "t" in next && next.t - key.t <= 1) return false;
      const past = (a: "x" | "y", size: "w" | "h") =>
        key.rect[a] !== next.rect[a] &&
        [key, next].some((k) => k.rect[a] < -1e-6 || k.rect[a] + k.rect[size] > 1 + 1e-6);
      return past("x", "w") || past("y", "h");
    });
    if (moves)
      problems.push(`${path}/framing/crop: a crop that moves along an axis it reaches past`);
  }
  return problems;
}

/** Looks the project names that the catalog does not have. */
function unknownLooks(project: Project): string[] {
  const clips = [
    ...project.main.map((clip, i) => [`/main/${i}`, clip] as const),
    ...(project.broll ?? []).map((clip, i) => [`/broll/${i}`, clip] as const),
  ];
  return clips.flatMap(([path, clip]) => {
    const id = clip.grade?.look?.id;
    return id === undefined || isLookId(id)
      ? []
      : [`${path}/grade/look/id: no look ${id}; the looks are ${lookIds.join(", ")}`];
  });
}

/**
 * Renders `project.json` to an MP4 at `out`, and writes beside it a copy of the project that
 * renders the same video again (`<name>.project.json`), the edit's cut times (`edit_cuts.json`,
 * as vebench reads them), when the project asks, its captions as SubRip (`<name>.srt`) and,
 * with music, each track's licence (`<name>.music.txt`).
 *
 * The edit is rendered piece by piece (see ./pieces.ts) in two passes. The sound of every piece
 * goes, sample-exact, into one PCM file, the music bed is added to it, and the mix is measured
 * and normalised to the loudness target.
 * The pictures then go, frame-exact, into one encoder that takes the finished sound beside them.
 * No piece is ever encoded on its own, so nothing is joined after encoding and audio cannot drift.
 */
export async function render(
  projectPath: string,
  out: string,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const project = await loadJson(projectPath, validateProject);
  validateOverlays(project.overlays ?? []);
  validateCards(
    (project.cards ?? []).map(({ card, params }) => ({ card, params })),
    "/cards",
  );
  const problems = unrendered(project);
  if (problems.length > 0) {
    throw new Error(`The renderer does not draw these yet:\n${problems.join("\n")}`);
  }
  const looks = unknownLooks(project);
  if (looks.length > 0) throw new Error(looks.join("\n"));
  const report = options.onProgress ?? (() => {});
  report(0, "Checking sources");
  const sources = await loadSources(project, projectPath);
  const timeline = buildTimeline(project, sources);
  const pieces = cutPieces(timeline);
  // Before anything renders, so a line the caption font cannot draw fails at once.
  const captions = await buildCaptions(project, timeline);
  const bin = await ffmpeg();

  const effects = timeline.overlays.length + timeline.cards.length;
  const share = effects > 0 ? OVERLAY_SHARE : 0;
  const { aspect, width, height, fps } = project.output;
  // Shared between the overlays and the cards by how many each has.
  const part = timeline.overlays.length / Math.max(1, effects);
  const download = options.onDownload ? { onDownload: options.onDownload } : {};
  const overlays = await (options.renderOverlays ?? renderOverlays)(
    timeline.overlays.map(({ overlay, start, end }) => ({
      template: overlay.template,
      params: overlay.params,
      aspect,
      width,
      height,
      fps,
      frames: end - start,
    })),
    { onProgress: (fraction, message) => report(fraction * share * part, message), ...download },
  );
  const cards =
    timeline.cards.length === 0
      ? []
      : await (options.renderCards ?? renderCards)(
          timeline.cards.map(({ card, start, end }) => {
            const [w, h] = cardSize(aspect, card.placement, width, height);
            const { placement } = card;
            return {
              card: card.card,
              params: card.params,
              placement,
              aspect,
              width: w,
              height: h,
              fps,
              frames: end - start,
            };
          }),
          {
            onProgress: (fraction, message) =>
              report(share * (part + fraction * (1 - part)), message),
            ...download,
          },
        );
  const progress = (fraction: number, message: string) =>
    report(share + fraction * (1 - share), message);

  const video = resolve(out);
  const folder = dirname(video);
  await mkdir(folder, { recursive: true });
  // Beside the output, so the PCM file (384 kB per second) is not held in a RAM-backed /tmp and
  // the finished file moves into place with a rename.
  const work = await mkdtemp(join(folder, ".render-"));
  try {
    // One LUT for each different match and look, shared by the clips that have it.
    const luts = new Map<string, string>();
    for (const clip of [...project.main, ...(project.broll ?? [])]) {
      const key = lutKey(clip.grade);
      if (key === null || luts.has(key)) continue;
      const file = join(work, `grade-${luts.size}.cube`);
      await writeFile(file, cube(clip.grade));
      luts.set(key, file);
    }
    const steps = pieces.length * 2 + 1;
    const voice = join(work, "voice.f32");
    const file = await open(voice, "w");
    try {
      for (const [i, piece] of pieces.entries()) {
        progress(i / steps, `Mixing sound ${i + 1}/${pieces.length}`);
        await run(bin, pieceAudio(piece, timeline), file.fd);
      }
    } finally {
      await file.close();
    }
    await checkSamples(voice, timeline.samples, "The mix");
    let pcm = voice;
    let bed: string | null = null;
    if (timeline.music.length + timeline.sfx.length > 0) {
      progress(pieces.length / steps, "Mixing music");
      // Ducking follows the speech as the sound under the music actually plays it.
      const ducked = timeline.music.some((track) => track.music.ducking);
      const ride = ducked
        ? rides(timeline.speech, parseMomentary((await run(bin, momentaryArgs(voice))).stdout))
        : [];
      const envelopes = await Promise.all(
        timeline.music.map(async (track, k) => {
          const gains = envelopeOf(track, timeline.speech, ride);
          if (!gains) return null;
          const path = join(work, `duck-${k}.f32`);
          await writeFile(path, gains);
          return path;
        }),
      );
      bed = join(work, "music.f32");
      await run(bin, musicBed(timeline, envelopes, bed));
      await checkSamples(bed, timeline.samples, "The music");
      pcm = join(work, "mix.f32");
      await run(bin, addBed(voice, bed, pcm));
      await checkSamples(pcm, timeline.samples, "The mix with music");
    }
    if (options.stems) {
      await mkdir(options.stems, { recursive: true });
      await run(bin, wav(voice, join(options.stems, "voice.wav")));
      if (bed) await run(bin, wav(bed, join(options.stems, "music.wav")));
    }

    progress(pieces.length / steps, "Measuring loudness");
    const target = project.audio.loudness;
    const log = await run(bin, [
      "-hide_banner",
      "-nostdin",
      "-nostats",
      ...RAW_AUDIO,
      "-i",
      pcm,
      "-af",
      measureLoudness(target),
      "-f",
      "null",
      "-",
    ]);
    const measured = parseMeasurement(log.stderr);
    const audible = Number.isFinite(measured.input_i) && measured.input_i > -70;

    const finished = join(work, "master.f32");
    // The sound is encoded as the video will encode it and its true peak measured; while it
    // peaks over the target, the master is made again with a limiter set that much lower.
    const masterTo = (path: string, ceiling?: number) => {
      const master = masterAudio("", audible ? measured : null, target, timeline.samples, ceiling);
      return run(bin, [...QUIET, "-y", ...RAW_AUDIO, "-i", pcm, "-af", master, ...RAW_AUDIO, path]);
    };
    let peak = -Infinity;
    if (!audible) await masterTo(finished);
    else {
      const best = await limitPeak(
        target.truePeakDbtp,
        async (ceiling, n) => {
          const path = join(work, `master-${n}.f32`);
          await masterTo(path, ceiling);
          return encodedPeak(bin, path, timeline.samples, join(work, "peak.m4a"));
        },
        (n) => rm(join(work, `master-${n}.f32`)),
      );
      peak = best.peak;
      await rename(join(work, `master-${best.n}.f32`), finished);
    }
    for (const path of new Set([voice, pcm, ...(bed ? [bed] : [])])) await rm(path);

    const encoded = join(work, "out.mp4");
    let fonts: NodeJS.ProcessEnv = {};
    if (captions) {
      await writeFile(join(work, "captions.ass"), captions.ass);
      fonts = await stageFonts(work, [captions.font]);
    }
    const subtitles = captions ? "captions.ass" : undefined;
    const args = encoderArgs(project.output, finished, timeline.samples, encoded, subtitles);
    const frames = await encode(
      bin,
      args,
      { cwd: work, env: { ...process.env, ...fonts } },
      async (stdin) => {
        for (const [i, piece] of pieces.entries()) {
          progress((pieces.length + 1 + i) / steps, `Rendering ${i + 1}/${pieces.length}`);
          // A crop path's expression can outgrow one command-line argument (128 KiB on Linux),
          // so FFmpeg reads the graph from a file.
          const args = pieceVideo(piece, timeline, overlays, luts, cards);
          const at = args.indexOf("-filter_complex");
          const graph = join(work, "graph.txt");
          await writeFile(graph, args[at + 1] ?? "");
          args.splice(at, 2, "-/filter_complex", graph);
          await run(bin, args, stdin);
        }
      },
    );
    // A piece that came up short would leave every later frame early against the sound.
    if (frames !== timeline.frames) {
      throw new Error(`The picture has ${frames} frames, expected ${timeline.frames}`);
    }
    await rename(encoded, video);

    const stem = basename(video, extname(video));
    const copy = join(folder, `${stem}.project.json`);
    await writeFile(copy, `${JSON.stringify(rebase(project, projectPath, folder), null, 2)}\n`);
    const cuts = join(folder, "edit_cuts.json");
    const times = timeline.cuts.map((seconds) => Number(seconds.toFixed(6)));
    await writeFile(cuts, `${JSON.stringify({ cuts: times })}\n`);
    let srt: string | null = null;
    if (captions && project.captions?.srt) {
      srt = join(folder, `${stem}.srt`);
      await writeFile(srt, captions.srt);
    }
    const music = timeline.music.length > 0 ? join(folder, `${stem}.music.txt`) : null;
    if (music) await writeFile(music, credits(project, basename(video)));
    const shown = brollCredits(project, timeline);
    const broll = shown.length > 0 ? join(folder, `${stem}.broll.txt`) : null;
    if (broll) await writeFile(broll, creditText(basename(video), shown));
    report(1, "Finished");
    return {
      video,
      project: copy,
      cuts,
      captions: srt,
      music,
      broll,
      frames: timeline.frames,
      seconds: (timeline.frames * timeline.frameTicks) / TICKS_PER_SECOND,
      loudness: audible
        ? { measured, linear: linearReach(measured, target), truePeakDbtp: peak }
        : null,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/**
 * Masters the sound until its encoded true peak is at most `target` dBTP and within
 * `PEAK_NEAR_DB` of it: `attempt(ceiling, n)` writes try `n` with the limiter at `ceiling` (none
 * on the first) and returns its encoded peak, and `discard(n)` removes a try no longer wanted.
 * While every try peaks over, each sets the limiter lower by its overshoot. AAC's overshoot does
 * not fall steadily as the ceiling does, so once a try passes far under the target, the next
 * ceilings halve the gap between it and the nearest one above that peaked over. Returns the try
 * to keep: the passing one nearest the target, or else the one that peaked lowest, so the render
 * goes on with a peak a little over rather than fail after its whole analysis; the result
 * reports the peak.
 */
export async function limitPeak(
  target: number,
  attempt: (ceiling: number | undefined, n: number) => Promise<number>,
  discard: (n: number) => Promise<void> = async () => {},
): Promise<{ n: number; peak: number }> {
  type Try = { n: number; peak: number; ceiling: number | undefined };
  let best: Try | null = null;
  // The ceilings that peaked over; no limiter counts as one at the target.
  const over: number[] = [];
  let ceiling: number | undefined;
  for (let n = 0; n < PEAK_TRIES; n++) {
    const peak = await attempt(ceiling, n);
    const at = ceiling ?? target;
    const passes = peak <= target;
    const better =
      best === null || (passes ? best.peak > target || peak > best.peak : peak < best.peak);
    if (best && better) await discard(best.n);
    else if (!better) await discard(n);
    const kept: Try = best && !better ? best : { n, peak, ceiling };
    best = kept;
    if (!passes) over.push(at);
    if (kept.peak <= target) {
      // Without a limiter the peak is what loudness alone leaves; no ceiling raises it.
      if (kept.peak > target - PEAK_NEAR_DB || kept.ceiling === undefined) break;
      const below = kept.ceiling;
      const above = Math.min(...over.filter((c) => c > below));
      ceiling = (below + (Number.isFinite(above) ? above : target)) / 2;
    } else ceiling = at - (peak - target) - PEAK_STEP_DB;
  }
  if (!best) throw new Error("No try of the master");
  return { n: best.n, peak: best.peak };
}

/** The true peak, in dBTP, of a raw stereo float file once encoded as the output encodes it. */
async function encodedPeak(
  bin: string,
  pcm: string,
  samples: number,
  out: string,
): Promise<number> {
  await run(bin, [
    ...QUIET,
    "-y",
    ...RAW_AUDIO,
    "-i",
    pcm,
    "-af",
    alignToAacFrames(samples),
    ...AAC,
    out,
  ]);
  const log = await run(bin, [
    "-hide_banner",
    "-nostdin",
    "-nostats",
    "-i",
    out,
    "-af",
    truePeakFilter,
    "-f",
    "null",
    "-",
  ]);
  await rm(out);
  return parseTruePeak(log.stderr);
}

/** Fails unless a raw stereo float file holds exactly `samples` samples. */
async function checkSamples(path: string, samples: number, what: string): Promise<void> {
  const bytes = (await stat(path)).size;
  if (bytes !== samples * 8)
    throw new Error(`${what} has ${bytes / 8} samples, expected ${samples}`);
}

/** FFmpeg's arguments that copy a raw stereo float file into a WAV file, as it is. */
function wav(pcm: string, out: string): string[] {
  return [...QUIET, ...RAW_AUDIO, "-i", pcm, "-c:a", "pcm_f32le", "-y", out];
}

/** The music the video plays and the licence each track is used under, once per track, in the
 * order the tracks first play: what the licences ask to be credited, ready to paste. */
function credits(project: Project, video: string): string {
  const lines = [`Music in ${video}, with the licence each track is used under.`];
  const seen = new Set<string>();
  const ordered = [...(project.audio.music ?? [])].sort((a, b) => a.start - b.start);
  for (const track of ordered) {
    if (seen.has(track.source)) continue;
    seen.add(track.source);
    const file = project.sources.find((source) => source.id === track.source)?.path ?? "";
    const { name, url, attribution } = track.license;
    lines.push("", basename(file), `  Licence: ${name}${url ? ` (${url})` : ""}`);
    if (attribution) lines.push(`  Credit: ${attribution}`);
  }
  return `${lines.join("\n")}\n`;
}

/** The credits of the sources the video shows as B-roll or plays as sound effects, and of the
 * logos and icons its cards draw, in the order they first play. */
function brollCredits(project: Project, timeline: ReturnType<typeof buildTimeline>): Credit[] {
  const ticks = timeline.frameTicks;
  const byId = new Map(project.sources.map((source) => [source.id, source]));
  const of = (id: string): Credit[] => {
    const credit = byId.get(id)?.credit;
    if (!credit) return [];
    const { license, by, ...rest } = credit;
    return [
      { ...rest, license: license ?? null, by: by ? { name: by.name, url: by.url ?? null } : null },
    ];
  };
  const played: [number, Credit[]][] = [
    ...timeline.broll.map((clip): [number, Credit[]] => [clip.start * ticks, of(clip.clip.source)]),
    ...timeline.cards.map((clip): [number, Credit[]] => [
      clip.start * ticks,
      cardCredits(clip.card.params),
    ]),
    ...(project.audio.sfx ?? []).map((sfx): [number, Credit[]] => [sfx.start, of(sfx.source)]),
  ];
  return played.sort((a, b) => a[0] - b[0]).flatMap(([, credits]) => credits);
}

/** Runs the encoder, in the folder and environment given, while `feed` writes frames into its
 * stdin, waits for it to finish, and returns how many frames it encoded. */
async function encode(
  bin: string,
  args: string[],
  { cwd, env }: { cwd: string; env: NodeJS.ProcessEnv },
  feed: (stdin: NonNullable<ReturnType<typeof spawn>["stdin"]>) => Promise<void>,
): Promise<number> {
  const encoder = spawn(bin, args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const log: Buffer[] = [];
  const report: Buffer[] = [];
  encoder.stderr.on("data", (chunk: Buffer) => log.push(chunk));
  encoder.stdout.on("data", (chunk: Buffer) => report.push(chunk));
  const exited = new Promise<void>((done, fail) => {
    encoder.on("error", fail);
    encoder.on("close", (code, signal) => {
      if (code === 0) done();
      else fail(new Error(`The encoder exited with ${signal ?? code}:\n${Buffer.concat(log)}`));
    });
  });
  let failed: unknown;
  exited.catch((error: unknown) => {
    failed = error;
  });
  try {
    await feed(encoder.stdin);
    encoder.stdin.end();
  } catch (error) {
    // A piece fails with a broken pipe when the encoder died first; the encoder says why.
    const cause = failed ?? error;
    encoder.kill("SIGKILL");
    await exited.catch(() => {});
    throw cause;
  }
  await exited;
  const counts = [
    ...Buffer.concat(report)
      .toString()
      .matchAll(/^frame=(\d+)$/gm),
  ];
  return Number(counts.at(-1)?.[1] ?? 0);
}

/** The project with its paths made relative to `folder`, where its copy is written. */
export function rebase(project: Project, projectPath: string, folder: string): Project {
  const base = dirname(resolve(projectPath));
  const move = (path: string) => relative(folder, resolve(base, path)).split(sep).join("/");
  return {
    ...project,
    sources: project.sources.map((source) => ({
      ...source,
      path: move(source.path),
      ...(source.index ? { index: move(source.index) } : {}),
    })) as Project["sources"],
  };
}
