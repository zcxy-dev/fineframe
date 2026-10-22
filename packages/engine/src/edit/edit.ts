import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { setTimeout } from "node:timers/promises";
import {
  type Brand,
  type ClaudeCost,
  type DoneProgress,
  type Progress,
  type ShortNumber,
  type Shorts,
  validateProgress,
  validateShorts,
} from "@video-editor/schema";
import { BrandError, loadKit, moveBrand, stageBrand } from "../brand/kit.ts";
import type { CaptionStyle } from "../captions/presets.ts";
import { ffmpeg, QUIET, run } from "../ffmpeg.ts";
import { libraryMusic } from "../library.ts";
import { fetchLink, isLink, ytDlp } from "../link.ts";
import type { LookId } from "../looks.ts";
import {
  anthropicClaude,
  type Claude,
  ClaudeError,
  checkClaude,
  PLAN_MODELS,
  type Quality,
  totalUsage,
  type Usage,
} from "../plan/claude.ts";
import type { FillerMode } from "../plan/fillers.ts";
import { findMoments, type Moment } from "../plan/moments.ts";
import type { MusicInput } from "../plan/music.ts";
import {
  type Aspect,
  LENGTH_RANGE,
  PlanError,
  type PlanInput,
  plan,
  TOLERANCE,
} from "../plan/plan.ts";
import { MAX_REVIEW_PASSES, review } from "../plan/review.ts";
import type { Visuals } from "../plan/visuals.ts";
import { render } from "../render.ts";
import { fingerprintOf } from "../sources.ts";
import {
  type AnalysisOptions,
  type AnalysisStep,
  analyze,
  analyzeMusic,
  type Download,
  defaultCache,
  indexName,
  localWorker,
  musicIndexName,
  type Worker,
} from "./analyze.ts";
import { EditError } from "./error.ts";
import { collectInputs, type MediaFile } from "./inputs.ts";
import { SHORTS_COUNT, SHORTS_RANGE } from "./length.ts";
import { collectMusic } from "./music.ts";

export type Stage = "analyze" | "plan" | "render" | "check";

export interface EditOptions {
  /** Footage files, folders and links to public videos, fetched beside `out`. */
  inputs: string[];
  /** Seconds, LENGTH_RANGE inclusive. */
  length: number;
  /** Cuts only from this stretch of the one video given, in seconds into it. */
  within?: { start: number; end: number };
  /** Plans the edit as one short of a longer video, about this, in a sentence or two: hook
   * first, with no opening title, as `--shorts` made it. */
  short?: string;
  aspect: Aspect;
  /** The video to write. `<name>.project.json`, `<name>.srt` and `edit_cuts.json` go beside it. */
  out: string;
  /** A UTF-8 file of people's names said in the footage, one per line: they help the speech
   * model and the correction hear them, and a lower third may show them. */
  names?: string;
  /** A UTF-8 file of terms said in the footage, one per line, such as brands and jargon: they
   * only help the speech model and the correction hear them. */
  terms?: string;
  /** The caption style (../captions/presets.ts): bold unless given, or the brand kit's custom
   * captions when it has them. */
  captions?: CaptionStyle;
  /** Shows the emoji Claude picks for the captions, at the end of their lines. */
  emoji?: boolean;
  /** A brand kit's folder (../brand/kit.ts): its kit.json, logo and fonts. Its files are copied
   * into `brand/` beside the video, or in the shorts' folder, and the edit renders in its look. */
  brand?: string;
  /** What the user asks of this edit, in their words, such as "open with the demo" or "keep
   * the part about pricing", passed on to the planner. */
  instructions?: string;
  /** Claude corrects each transcript before its words are timed. */
  correct?: boolean;
  /** Where the speech is heard: by the local model (the default), or on OpenRouter with the
   * user's key, for machines without the memory for the local one. */
  asr?: "local" | "cloud";
  /** The look over the edit (../looks.ts): clean unless given, none with "none". */
  look?: LookId | "none";
  /** Music tracks and folders of them that the edit may play, each with its licence in
   * `<name>.txt` beside it (see ./music.ts) or else `musicLicense`. Claude picks the one that
   * fits, or none. Without music or `library` the edit has none. */
  music?: string[];
  /** The licence of every track without its own `<name>.txt`, such as "CC0 1.0". */
  musicLicense?: string;
  /** Offers the built-in music library (../library.ts) too: its tracks need no analysis, and
   * the one Claude picks downloads once it is picked. */
  library?: boolean;
  /** `rich` (the default) adds motion graphics and shows B-roll on the edit's points: web
   * captures and, with PEXELS_API_KEY or PIXABAY_API_KEY, stock footage; `minimal` none. */
  visuals?: Visuals;
  /** Each progress line, as `pnpm edit` prints them: the last is `done` or `error`. */
  onProgress?: (line: Progress) => void;
  /** Lines for a person: what the analysis prints besides its progress, and the review's
   * findings. */
  onLog?: (line: string) => void;
  /** The model that plans and judges doubtful cut checks: best (Opus) unless given. */
  quality?: Quality;
  /** Which fillers are cut: natural (hesitations and stutters) unless given. */
  fillers?: FillerMode;
  /** Defaults to the Anthropic API, checked before any analysis. */
  claude?: Claude;
  /** Defaults to vework in the repository's worker/. */
  worker?: Worker;
  /** Where media indexes are kept between runs; defaults to defaultCache(). */
  cache?: string;
}

export interface EditResult {
  outputs: DoneProgress["outputs"];
  /** The finished video's length. */
  seconds: number;
  /** Wall-clock seconds in each stage: render counts every render, check every review. */
  timings: Record<Stage, number>;
  usage: ReturnType<typeof totalUsage>;
  /** Files analysed in this run, and files whose index an earlier run left. */
  analyzed: number;
  cached: number;
  reviews: number;
}

/** The progress bar's share for analysis when every file needs it: on a CPU, the speech model
 * takes most of a run. The rest is split between the later stages. */
const ANALYZE_SHARE = 0.9;
const SHARES = { plan: 0.3, render: 0.3, check: 0.4 };
/** The share of each review pass before its render of the fixes. */
const CHECK_SHARE = 0.3;
/** How finely FFmpeg's header states a file's length, in seconds. */
const FFMPEG_TICK = 0.01;

/**
 * Edits footage to a finished video: analyses each file (or takes its index from the cache),
 * plans the edit to `length`, renders it, then reviews every cut and renders the fixes, at most
 * MAX_REVIEW_PASSES times. Writes the video, `<name>.project.json` that renders it again, the
 * captions as `<name>.srt`, `edit_cuts.json`, with music its licences in `<name>.music.txt` and,
 * with B-roll or sound effects that carry a credit, their credits in `<name>.broll.txt`.
 *
 * Progress goes to `onProgress` as lines of progress.schema.json, ending in `done` or `error`.
 * A failure also throws; an EditError or PlanError means the inputs cannot make this edit, and
 * its message says why.
 */
export async function edit(options: EditOptions): Promise<EditResult> {
  const emit = options.onProgress ?? (() => {});
  const { report, last } = reporter(emit);
  // Every request's usage, whichever step made it, so a failed edit still says what it cost.
  const spent: Usage[] = [];
  try {
    const result = await steps(options, report, spent);
    const { video, captions } = result.outputs;
    const { music, broll } = result.outputs;
    const message = `Finished: ${result.seconds.toFixed(1)} s at ${options.aspect} in ${basename(video)}${captions ? `, captions in ${basename(captions)}` : ""}${music ? `, the music's licences in ${basename(music)}` : ""}${broll ? `, the B-roll's credits in ${basename(broll)}` : ""}`;
    const claude = costByStage(spent);
    emit(
      validateProgress({ stage: "done", fraction: 1, message, claude, outputs: result.outputs }),
    );
    return result;
  } catch (error) {
    const message = (error as Error).message;
    const claude = spent.length > 0 ? { claude: costByStage(spent) } : {};
    emit(validateProgress({ stage: "error", fraction: last(), message, ...claude }));
    throw error;
  }
}

/** Stage lines to `emit`, the bar never going back: `report` writes one, `short` one that names
 * the short it is about, and `last` says where the bar is. */
function reporter(emit: (line: Progress) => void) {
  let last = 0;
  const line =
    (short?: ShortNumber): Reporter =>
    (stage, fraction, message, file, download, step) => {
      last = Math.max(last, Math.min(1, Math.round(fraction * 10_000) / 10_000));
      emit(
        validateProgress({
          stage,
          fraction: last,
          message,
          ...(file ? { file } : {}),
          ...(download ? { download } : {}),
          ...(step ? { step } : {}),
          ...(short ? { short } : {}),
        }),
      );
    };
  return { report: line(), short: line, last: () => last };
}

type Reporter = (
  stage: Stage,
  fraction: number,
  message: string,
  file?: string,
  download?: Download,
  step?: AnalysisStep,
) => void;

/** Downloads' progress as progress lines, for each at most one every quarter of a second and
 * the last when it is whole; nothing while the server does not say the size. The bar stays where
 * it is. */
function downloading(report: Reporter, stage: Stage) {
  const shown = new Map<string, number>();
  return (name: string, bytes: number, total: number, message?: string) => {
    const now = Date.now();
    if (total <= 0 || (bytes < total && now - (shown.get(name) ?? 0) < 250)) return;
    shown.set(name, now);
    const download = { name, bytes: Math.min(bytes, total), total };
    const said = message ? `${message} ${name}` : `Downloading ${name}, the first time it is used`;
    report(stage, 0, said, undefined, download);
  };
}

/** Usage summed by the stage that asked: the plan with the callouts it finds on screen, or the
 * review with what it escalates. */
export function costByStage(usages: readonly Usage[]): ClaudeCost {
  const stage = (purposes: Usage["purpose"][]) => {
    const total = totalUsage(usages.filter((usage) => purposes.includes(usage.purpose)));
    return { dollars: total.dollars, requests: total.calls };
  };
  const find = usages.some((usage) => usage.purpose === "find");
  return {
    ...(find ? { find: stage(["find"]) } : {}),
    plan: stage(["plan", "locate"]),
    graphics: stage(["graphics"]),
    check: stage(["check", "judge"]),
  };
}

/** What every edit of a run shares: the footage checked and analysed, the music and the names,
 * and Claude counting what each request costs. */
interface Prepared {
  options: EditOptions;
  files: MediaFile[];
  videos: MediaFile[];
  indexes: Map<MediaFile, { path: string; bytes: number; cached: boolean }>;
  music: MusicInput[];
  names: string[];
  claude: Claude;
  /** Called before each request to Claude, which it stops by throwing. */
  limit: { check: () => void };
  log: (line: string) => void;
  timings: Record<Stage, number>;
  timed: <T>(stage: Stage, work: () => Promise<T>) => Promise<T>;
  /** The share of the progress bar the analysis took. */
  analyzed: number;
  /** The brand kit, its files copied into `folder`, its paths relative to it. */
  brand: { kit: Brand; folder: string } | null;
}

/**
 * Checks the inputs, then analyses each file or takes its index from the cache. `refuse` fails
 * on the footage's length, read before the long analysis, when it cannot make what is asked.
 */
async function prepare(
  options: EditOptions,
  output: string,
  refuse: (footage: number, videos: MediaFile[], lengths: (number | null)[]) => void,
  report: Reporter,
  spent: Usage[],
  /** The folder the brand kit's files are copied into. */
  brandFolder: string,
): Promise<Prepared> {
  const log = options.onLog ?? (() => {});
  // A kit that cannot be used fails before anything is fetched or analysed.
  const kit = options.brand
    ? await loadKit(options.brand).catch((error: Error) => {
        throw error instanceof BrandError
          ? new EditError(`--brand ${options.brand}: ${error.message}`)
          : error;
      })
    : null;
  // A caption style asked for by name replaces the kit's custom captions.
  if (kit?.captions && options.captions) delete kit.captions;
  const timings: Record<Stage, number> = { analyze: 0, plan: 0, render: 0, check: 0 };
  const timed = async <T>(stage: Stage, work: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    try {
      return await work();
    } finally {
      timings[stage] += (performance.now() - start) / 1000;
    }
  };

  const download = downloading(report, "analyze");
  // Links are fetched beside the output, then edited as the files they became.
  const given: string[] = [];
  for (const input of options.inputs) {
    if (!isLink(input)) {
      given.push(input);
      continue;
    }
    await mkdir(dirname(output), { recursive: true });
    report("analyze", 0, `Reading ${input}`);
    const program = [
      await ytDlp({ onDownload: (bytes, total) => download("yt-dlp", bytes, total) }),
    ];
    const fetched = await fetchLink(input, dirname(output), {
      program,
      onProgress: (bytes, total, linked) => download(linked.title, bytes, total, "Downloading"),
    });
    given.push(fetched.path);
  }
  const files = await collectInputs(given, output);
  const audio = files.filter((file) => file.kind === "audio").map((file) => file.given);
  if (audio.length > 0) {
    throw new EditError(
      `${audio.join(", ")}: audio only. An edit is cut from video, with still images as ` +
        "B-roll; give music with --music",
    );
  }
  const videos = files.filter((file) => file.kind === "video");
  if (videos.length === 0) throw new EditError("No video among the inputs to cut the edit from");
  const analysis: AnalysisOptions = { correct: options.correct ?? false };
  if (options.asr === "cloud") analysis.asr = "cloud";
  const read = async (path: string | undefined, what: string) => {
    if (!path) return undefined;
    const text = await readFile(path, "utf8").catch((error: Error) => {
      throw new EditError(`${path}: cannot read the ${what} file (${error.message})`);
    });
    return { path: resolve(path), text };
  };
  const names = await read(options.names, "names");
  const terms = await read(options.terms, "terms");
  const tracks = await collectMusic(options.music ?? [], options.musicLicense);
  // Images are only decoded, which is quick: a bad one fails before the long analysis.
  for (const file of files.filter((f) => f.kind === "image")) await checkImage(file);
  // An edit is cut from the footage, so footage too short for it fails now rather than after
  // minutes of analysis. A file whose length FFmpeg cannot read is left to the analysis.
  const lengths = await Promise.all(videos.map(durationOf));
  const footage = lengths.reduce<number>((sum, seconds) => sum + (seconds ?? Infinity), 0);
  refuse(footage, videos, lengths);
  let asked = options.claude;
  if (!asked) {
    report("analyze", 0, "Checking that Claude can plan the edit");
    await checkClaude(PLAN_MODELS[options.quality ?? "best"]);
    asked = anthropicClaude();
  }
  const ask = asked;
  const limit = { check: () => {} };
  const claude: Claude = async (request) => {
    limit.check();
    const reply = await ask(request);
    spent.push(reply.usage);
    return reply;
  };
  // The renderer's FFmpeg, downloaded on its first use, before the long analysis rather than
  // after it.
  await ffmpeg((bytes, total) => download("FFmpeg", bytes, total));
  // The kit's files are copied before the analysis too.
  const brand =
    kit && options.brand
      ? { kit: await stageBrand(kit, options.brand, brandFolder, brandFolder), folder: brandFolder }
      : null;
  const worker = options.worker ?? (await localWorker());
  const cache = options.cache ?? defaultCache();
  // vework reads one glossary: the names or the terms as given, or both together in a file of
  // the cache named by what it holds.
  if (names && terms) {
    const text = `${names.text.trimEnd()}\n${terms.text.trimEnd()}\n`;
    const hash = createHash("sha256").update(text).digest("hex").slice(0, 16);
    const path = join(cache, `glossary-${hash}.txt`);
    await mkdir(cache, { recursive: true });
    await writeFile(path, text);
    analysis.glossary = { path, text };
  } else if (names ?? terms) {
    analysis.glossary = names ?? terms;
  }

  // One file at a time: the speech model alone fills most of a 16 GB machine.
  report("analyze", 0, `Reading ${files.length === 1 ? "the file" : `${files.length} files`}`);
  const indexes = new Map<MediaFile, { path: string; bytes: number; cached: boolean }>();
  const music: MusicInput[] = [];
  const analyzed = await timed("analyze", async () => {
    await mkdir(cache, { recursive: true });
    // Music first: it takes seconds, so a track vework cannot read fails before the footage's
    // minutes. Its share of the progress is too small to count.
    for (const { file, license } of tracks) {
      const path = join(cache, musicIndexName(worker, await fingerprintOf(file.path), license));
      if (existsSync(path)) report("analyze", 0, "Analysed before", file.given);
      else {
        const step = (_: number, message: string, download?: Download) =>
          report("analyze", 0, message, file.given, download, "music");
        await analyzeMusic(worker, file, path, license, step, log);
      }
      music.push({ index: path, source: file.path });
    }
    if (options.library) music.push(...libraryMusic(downloading(report, "plan")));
    for (const file of videos) {
      const fingerprint = await fingerprintOf(file.path);
      const path = join(cache, indexName(worker, fingerprint, analysis));
      indexes.set(file, { path, bytes: fingerprint.bytes, cached: existsSync(path) });
    }
    const total = [...indexes.values()].reduce((sum, i) => sum + i.bytes, 0);
    const pending = [...indexes.values()].reduce((sum, i) => sum + (i.cached ? 0 : i.bytes), 0);
    const share = total > 0 ? (ANALYZE_SHARE * pending) / total : 0;
    let at = 0;
    for (const [file, index] of indexes) {
      if (index.cached) {
        report("analyze", at, "Analysed before", file.given);
        continue;
      }
      // Empty files leave nothing pending; the analysis then fails on them.
      const span = pending > 0 ? (share * index.bytes) / pending : 0;
      const step = (fraction: number, message: string, download?: Download, on?: AnalysisStep) =>
        report("analyze", at + fraction * span, message, file.given, download, on);
      await analyze(worker, file, index.path, analysis, step, log);
      at += span;
    }
    return share;
  });
  return {
    options,
    files,
    videos,
    indexes,
    music,
    // The people a lower third may name, never the terms. The names file is in the glossary's
    // format, where blank lines and lines starting with # are not names.
    names: (names?.text.split(/\r?\n/) ?? [])
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
    claude,
    limit,
    log,
    timings,
    timed,
    analyzed,
    brand,
  };
}

/** A path of the copied kit, relative to its folder, as one relative to `folder`. */
function kitPath(prepared: Prepared, folder: string, path: string): string {
  const from = prepared.brand?.folder as string;
  return relative(folder, resolve(from, path)).split(sep).join("/");
}

/** What the planner reads of `files`: each video's index, and each still. */
function planInputs(prepared: Prepared, files: readonly MediaFile[]): PlanInput[] {
  return files.flatMap((file): PlanInput[] => {
    const index = prepared.indexes.get(file);
    if (index) return [{ index: index.path, source: file.path }];
    return file.kind === "image" ? [{ image: file.path }] : [];
  });
}

/** One edit to cut from prepared footage. */
interface Cut {
  inputs: PlanInput[];
  /** The video to write; its project, captions and other files go beside it. */
  video: string;
  length: number;
  within?: { start: number; end: number };
  short?: boolean;
  about?: string;
  /** The shortest it may be fitted to when its plan reaches less than `length`. */
  least?: number;
}

interface Rendered {
  outputs: DoneProgress["outputs"];
  /** The length it was planned for, and its video's. */
  length: number;
  seconds: number;
  reviews: number;
}

/**
 * Plans `cut`, renders it, then reviews every cut and renders the fixes, at most
 * MAX_REVIEW_PASSES times, its progress running from `from` to `to` of the bar.
 */
async function cutEdit(
  prepared: Prepared,
  cut: Cut,
  report: Reporter,
  from: number,
  to: number,
): Promise<Rendered> {
  const { options, timed, log } = prepared;
  const rest = to - from;
  const planAt = from;
  const renderAt = planAt + rest * SHARES.plan;
  const checkAt = renderAt + rest * SHARES.render;
  const video = cut.video;
  const stem = basename(video, extname(video));
  const work = join(dirname(video), `.${stem}.edit`);
  await mkdir(dirname(video), { recursive: true });
  // The work folder holds the project as planned and as fixed; nothing else needs it after.
  try {
    let planned = 0;
    // The planner reports again when the review changes the edit; those lines are the check's.
    let planProgress = (message: string) => {
      report("plan", planAt + planned * (renderAt - planAt), message);
      planned += (0.9 - planned) / 2;
    };
    const edit = await timed("plan", () =>
      plan({
        inputs: cut.inputs,
        length: cut.length,
        aspect: options.aspect,
        out: join(work, "project.json"),
        ...(options.look
          ? { look: options.look === "none" ? null : { id: options.look, intensity: 1 } }
          : {}),
        music: prepared.music,
        names: prepared.names,
        ...(options.captions ? { captions: options.captions } : {}),
        ...(options.emoji ? { emoji: true } : {}),
        ...(prepared.brand
          ? { brand: moveBrand(prepared.brand.kit, (path) => kitPath(prepared, work, path)) }
          : {}),
        ...(options.instructions ? { instructions: options.instructions } : {}),
        ...(cut.within ? { within: cut.within } : {}),
        ...(cut.short ? { short: true } : {}),
        ...(cut.about ? { about: cut.about } : {}),
        ...(cut.least === undefined ? {} : { least: cut.least }),
        claude: prepared.claude,
        ...(options.quality ? { quality: options.quality } : {}),
        ...(options.visuals ? { visuals: options.visuals } : {}),
        ...(options.fillers ? { fillers: options.fillers } : {}),
        onProgress: (message) => planProgress(message),
      }),
    );
    let rendered = await timed("render", () =>
      render(edit.path, video, {
        onProgress: (fraction, message) =>
          report("render", renderAt + fraction * (checkAt - renderAt), message),
        onDownload: downloading(report, "render"),
      }),
    );

    const passSpan = (to - checkAt) / MAX_REVIEW_PASSES;
    let reviews = 0;
    for (;;) {
      const at = checkAt + reviews * passSpan;
      planProgress = (message) => report("check", at, message);
      const result = await timed("check", () =>
        review(edit, video, { onProgress: (message) => report("check", at, message) }),
      );
      if (result.pass === 0) break;
      reviews = result.pass;
      for (const finding of result.findings) {
        const { verdict } = finding;
        if (finding.error) log(`Cut at ${finding.at.toFixed(2)} s not checked: ${finding.error}`);
        if (!verdict || verdict.problem === "none") continue;
        log(
          `Cut at ${finding.at.toFixed(2)} s: ${verdict.problem}, fix ${verdict.fix}` +
            `${finding.escalated ? " (judged by the planning model)" : ""}: ${verdict.reason}`,
        );
      }
      if (result.note) log(`Review ${result.pass}: ${result.note}`);
      if (!result.changed) break;
      rendered = await timed("render", () =>
        render(edit.path, video, {
          onProgress: (fraction, message) =>
            report("render", at + passSpan * (CHECK_SHARE + (1 - CHECK_SHARE) * fraction), message),
        }),
      );
    }
    return {
      outputs: {
        video: rendered.video,
        project: rendered.project,
        ...(rendered.captions ? { captions: rendered.captions } : {}),
        ...(rendered.music ? { music: rendered.music } : {}),
        ...(rendered.broll ? { broll: rendered.broll } : {}),
      },
      length: edit.state.length,
      seconds: rendered.seconds,
      reviews,
    };
  } catch (error) {
    // The analysis took most of the run; whoever reads this should know it is not lost.
    if (!(error instanceof ClaudeError)) throw error;
    throw new ClaudeError(
      `${error.message}. The analysis is kept, so running the edit again starts at the plan`,
    );
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** Files analysed in this run, and files whose index an earlier run left. */
function counted(prepared: Prepared): { analyzed: number; cached: number } {
  const cached = [...prepared.indexes.values()].filter((index) => index.cached).length;
  return { analyzed: prepared.indexes.size - cached, cached };
}

async function steps(options: EditOptions, report: Reporter, spent: Usage[]): Promise<EditResult> {
  const [shortest, longest] = LENGTH_RANGE;
  if (!(options.length >= shortest && options.length <= longest)) {
    throw new EditError(
      `The length must be ${shortest} s to ${longest / 3600} h, not ${options.length} s`,
    );
  }
  const video = resolve(options.out);
  const stem = basename(video, extname(video));
  if (existsSync(video) && !existsSync(join(dirname(video), `${stem}.project.json`))) {
    throw new EditError(
      `${options.out}: already there, and not an earlier edit; name the video something else, ` +
        "so no footage is written over",
    );
  }
  const { within } = options;
  const prepared = await prepare(
    options,
    video,
    (footage, videos, lengths) => {
      if (within) {
        const [file] = videos;
        const seconds = lengths[0] ?? Infinity;
        if (videos.length !== 1 || !file) {
          throw new EditError(`--within cuts from one video, not ${videos.length}`);
        }
        // FFmpeg's header gives the length to the centisecond; the media index, to the microsecond.
        const end = seconds + FFMPEG_TICK;
        if (!(within.start >= 0 && within.start < within.end && within.end <= end)) {
          throw new EditError(
            `${file.given} lasts ${seconds.toFixed(1)} s: the stretch ${within.start}-` +
              `${within.end} s is not inside it`,
          );
        }
        footage = within.end - within.start;
      }
      if (footage < options.length * (1 - TOLERANCE)) {
        throw new EditError(
          `The ${within ? "stretch" : "footage"} lasts ${footage.toFixed(1)} s${within ? "" : " in all"}, ` +
            `too short for a ${options.length} s edit: ask for a shorter edit or ` +
            `${within ? "a longer stretch" : "add footage"}`,
        );
      }
    },
    report,
    spent,
    join(dirname(video), "brand"),
  );
  const { length: _, ...rendered } = await cutEdit(
    prepared,
    {
      inputs: planInputs(prepared, prepared.files),
      video,
      length: options.length,
      ...(within ? { within } : {}),
      ...(options.short ? { short: true, about: options.short } : {}),
    },
    report,
    prepared.analyzed,
    1,
  );
  return {
    ...rendered,
    timings: prepared.timings,
    usage: totalUsage(spent),
    ...counted(prepared),
  };
}

/** US dollars Claude may cost: each short, and finding the moments for each hour of footage. */
const SHORT_CAP = 1;
const FIND_CAP_PER_HOUR = 1;
/** The share of the progress bar after the analysis that finding the moments takes. */
const FIND_SHARE = 0.05;

export interface ShortsOptions extends Omit<EditOptions, "length" | "within" | "short" | "out"> {
  /** How many shorts to make, SHORTS_COUNT inclusive: the best moments, fewer when the footage
   * holds fewer. */
  count: number;
  /** The shortest and longest a short may be, in seconds, within SHORTS_RANGE. */
  range: readonly [number, number];
  /** The folder to write: shorts.json, and each short in a folder of its own, 01, 02, … */
  out: string;
}

export interface ShortsResult {
  outputs: { shorts: string };
  shorts: Shorts;
  timings: Record<Stage, number>;
  usage: ReturnType<typeof totalUsage>;
  analyzed: number;
  cached: number;
  /** Review passes, of every short. */
  reviews: number;
  /** Why the run stopped at its cost limit, when it did. */
  stopped?: string;
}

/** Stops a run of shorts at its cost limit; the message says which limit and the spend. */
class CostLimit extends Error {
  override name = "CostLimit";
}

/**
 * Makes up to `count` shorts from footage: analyses each file (or takes its index from the
 * cache), has Claude find the moments that stand alone as shorts, best first, then edits each
 * from its own stretch of one file, hook first, as `edit` makes a short edit, into `01/edit.mp4`
 * and the files beside it. `shorts.json` lists each short as it is done, with the title,
 * description and hashtags Claude wrote for it. A short whose plan reaches less than the length
 * Claude picked is fitted to the length it reaches, within the range; a moment the planner cannot
 * make is left out and the next one made instead.
 *
 * Progress lines name the short each is about, a `short` line says each one is done, and the last
 * line is `done` or `error`. Claude's cost for finding the moments, and for any short, is held
 * under its cap: past it, the run stops with an error, keeping the shorts made.
 */
export async function editShorts(options: ShortsOptions): Promise<ShortsResult> {
  const emit = options.onProgress ?? (() => {});
  const lines = reporter(emit);
  const spent: Usage[] = [];
  try {
    const result = await makeShorts(options, lines, emit, spent);
    const made = result.shorts.shorts.length;
    const message = result.stopped
      ? `Made ${made} shorts, not ${options.count}: stopped at the cost limit, as ${result.stopped}`
      : made < options.count
        ? `Made ${made} shorts, not ${options.count}: only ${made} moments of the footage ` +
          `could be made into shorts of ${options.range[0]}-${options.range[1]} s`
        : `Made ${made} shorts in ${basename(dirname(result.outputs.shorts))}`;
    emit(
      validateProgress({
        stage: "done",
        fraction: 1,
        message,
        claude: costByStage(spent),
        outputs: result.outputs,
      }),
    );
    return result;
  } catch (error) {
    const message = (error as Error).message;
    const claude = spent.length > 0 ? { claude: costByStage(spent) } : {};
    emit(validateProgress({ stage: "error", fraction: lines.last(), message, ...claude }));
    throw error;
  }
}

async function makeShorts(
  options: ShortsOptions,
  { report, short: shortReport, last }: ReturnType<typeof reporter>,
  emit: (line: Progress) => void,
  spent: Usage[],
): Promise<ShortsResult> {
  const [shortest, longest] = options.range;
  if (
    !(Number.isInteger(options.count) && options.count >= SHORTS_COUNT[0]) ||
    options.count > SHORTS_COUNT[1]
  ) {
    throw new EditError(
      `Make ${SHORTS_COUNT[0]} to ${SHORTS_COUNT[1]} shorts, not ${options.count}`,
    );
  }
  if (!(shortest >= SHORTS_RANGE[0] && longest <= SHORTS_RANGE[1] && shortest < longest)) {
    throw new EditError(
      `A short lasts ${SHORTS_RANGE[0]} s to ${SHORTS_RANGE[1] / 60} min, between a shortest ` +
        `and a longer longest, not ${shortest}-${longest} s`,
    );
  }
  const folder = resolve(options.out);
  if ((await readdir(folder).catch(() => [])).length > 0) {
    throw new EditError(
      `${options.out}: already holds files; name another folder for the shorts, so nothing is ` +
        "written over",
    );
  }
  const prepared = await prepare(
    { ...options, length: shortest, out: folder },
    folder,
    (footage) => {
      if (footage < shortest * (1 - TOLERANCE)) {
        throw new EditError(
          `The footage lasts ${footage.toFixed(1)} s in all, too short for a short of ` +
            `${shortest}-${longest} s: ask for shorter ones or add footage`,
        );
      }
    },
    report,
    spent,
    join(folder, "brand"),
  );
  const findAt = prepared.analyzed;
  const shortsAt = findAt + (1 - findAt) * FIND_SHARE;
  report("plan", findAt, "Finding the moments that stand alone as shorts");
  const videos = planInputs(prepared, prepared.videos);
  const { moments, seconds: footage } = await prepared.timed("plan", () =>
    findMoments({
      inputs: videos,
      range: options.range,
      claude: prepared.claude,
      ...(options.quality ? { quality: options.quality } : {}),
      ...(options.instructions ? { instructions: options.instructions } : {}),
      usage: [],
    }),
  );
  const found = totalUsage(spent.filter((usage) => usage.purpose === "find")).dollars ?? 0;
  const findCap = FIND_CAP_PER_HOUR * Math.max(1, footage / 3600);
  if (found > findCap) {
    throw new EditError(
      `Finding the moments cost $${found.toFixed(2)}, over the $${findCap.toFixed(2)} it may ` +
        "for this footage, so no short was made",
    );
  }
  report("plan", shortsAt, `Found ${moments.length} moments`);
  if (moments.length === 0) {
    throw new EditError(
      `No moment of the footage stands alone as a short of ${shortest}-${longest} s`,
    );
  }

  const shorts: Shorts = {
    version: 1,
    asked: options.count,
    range: [shortest, longest],
    shorts: [],
  };
  const list = join(folder, "shorts.json");
  const images = prepared.files.filter((file) => file.kind === "image");
  // Each moment tried, made or not, costs; the run may spend what finding them may, and a short's
  // cap for each short asked, on at most twice as many moments as shorts asked for.
  const runCap = findCap + SHORT_CAP * options.count;
  const tries = Math.min(moments.length, 2 * options.count);
  let reviews = 0;
  let next = 0;
  let failure: string | null = null;
  let stopped: string | null = null;
  for (let n = 1; n <= options.count && next < tries; ) {
    const moment = moments[next++] as Moment;
    const of = Math.min(options.count, n - 1 + tries - next + 1);
    const number = { n, of };
    const span = (1 - shortsAt) / of;
    const from = Math.max(last(), shortsAt + (n - 1) * span);
    const file = prepared.videos.find((video) => video.path === moment.path) as MediaFile;
    const name = String(n).padStart(2, "0");
    const before = spent.length;
    prepared.limit.check = () => {
      const own = totalUsage(spent.slice(before)).dollars ?? 0;
      const all = totalUsage(spent).dollars ?? 0;
      if (own > SHORT_CAP) {
        throw new CostLimit(
          `a short reached $${own.toFixed(2)}, over the $${SHORT_CAP} a short may`,
        );
      }
      if (all > runCap) {
        throw new CostLimit(
          `the run reached $${all.toFixed(2)}, over the $${runCap.toFixed(2)} it may`,
        );
      }
    };
    let rendered: Rendered;
    try {
      rendered = await cutEdit(
        prepared,
        {
          inputs: planInputs(prepared, [file, ...images]),
          video: join(folder, name, "edit.mp4"),
          length: moment.length,
          within: { start: moment.start, end: moment.end },
          short: true,
          about: `${moment.title}. ${moment.description}`,
          least: shortest,
        },
        shortReport(number),
        from,
        shortsAt + n * span,
      );
    } catch (error) {
      await rm(join(folder, name), { recursive: true, force: true });
      if (error instanceof CostLimit) {
        stopped = error.message;
        break;
      }
      if (!(error instanceof PlanError)) throw error;
      // A moment the planner cannot cut to a length in the range; the next one is made instead.
      failure = error.message;
      prepared.log(`The moment "${moment.title}" was left out: ${error.message}`);
      continue;
    } finally {
      prepared.limit.check = () => {};
    }
    reviews += rendered.reviews;
    shorts.shorts.push({
      folder: name,
      title: moment.title,
      description: moment.description,
      hashtags: moment.hashtags as Shorts["shorts"][number]["hashtags"],
      source: file.given,
      start: moment.start,
      end: moment.end,
      length: rendered.length,
      seconds: rendered.seconds,
    });
    await writeShorts(list, shorts);
    emit(
      validateProgress({
        stage: "short",
        fraction: last(),
        message: `Short ${n} of ${of}: ${rendered.seconds.toFixed(1)} s, "${moment.title}"`,
        short: number,
        claude: costByStage(spent.slice(before)),
      }),
    );
    n++;
  }
  const made = shorts.shorts.length;
  if (stopped !== null) {
    if (made === 0) throw new EditError(`Stopped at the cost limit after 0 shorts: ${stopped}`);
    shorts.stopped = "cost";
    await writeShorts(list, shorts);
  } else if (made === 0) {
    throw new EditError(
      `None of the ${tries} moments tried could be cut to a length in the range${failure ? `: ${failure}` : ""}`,
    );
  }
  return {
    outputs: { shorts: list },
    shorts,
    ...(stopped === null ? {} : { stopped }),
    reviews,
    timings: prepared.timings,
    usage: totalUsage(spent),
    ...counted(prepared),
  };
}

/** Writes shorts.json whole, by renaming a finished copy over it, so a reader such as the web
 * page, which reads it as each short is done, never finds it half written. */
async function writeShorts(path: string, shorts: Shorts): Promise<void> {
  await writeFile(`${path}.part`, `${JSON.stringify(validateShorts(shorts), null, 2)}\n`);
  await renameOver(`${path}.part`, path);
}

/** What Windows answers a rename over a file another program has open, such as a reader or a
 * virus scanner: it goes once they let go. */
const HELD = new Set(["EPERM", "EACCES", "EBUSY"]);
const RENAME_TRIES = 5;

/** Renames `from` over `to`, trying again a few times, 20 ms then longer, while `to` is held. */
export async function renameOver(
  from: string,
  to: string,
  move: (from: string, to: string) => Promise<void> = rename,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await move(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (!HELD.has(code) || attempt >= RENAME_TRIES) throw error;
      await setTimeout(20 * attempt);
    }
  }
}

/** A video's length as its container states it; null when FFmpeg cannot say. */
async function durationOf(file: MediaFile): Promise<number | null> {
  const args = ["-hide_banner", "-nostdin", "-i", file.path, "-t", "0", "-f", "null", "-"];
  const said = await run(await ffmpeg(), args).catch(() => ({ stderr: "" }));
  const [, hours, minutes, seconds] = said.stderr.match(/Duration: (\d+):(\d+):([\d.]+)/) ?? [];
  return hours === undefined ? null : Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

/** Fails, naming the file, unless FFmpeg decodes a picture from it. */
async function checkImage(file: MediaFile): Promise<void> {
  try {
    await run(await ffmpeg(), [...QUIET, "-i", file.path, "-frames:v", "1", "-f", "null", "-"]);
  } catch (error) {
    const why = (error as Error).message.split("\n").at(-1);
    throw new EditError(`${file.given}: not an image FFmpeg can read (${why})`);
  }
}
