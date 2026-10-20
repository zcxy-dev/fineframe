import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  type ClaudeCost,
  type DoneProgress,
  type Progress,
  validateProgress,
} from "@video-editor/schema";
import { ffmpeg, QUIET, run } from "../ffmpeg.ts";
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
import type { MusicInput } from "../plan/music.ts";
import { type Aspect, LENGTH_RANGE, type PlanInput, plan, TOLERANCE } from "../plan/plan.ts";
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
import { collectMusic } from "./music.ts";

export type Stage = "analyze" | "plan" | "render" | "check";

export interface EditOptions {
  /** Footage files and folders. */
  inputs: string[];
  /** Seconds, LENGTH_RANGE inclusive. */
  length: number;
  aspect: Aspect;
  /** The video to write. `<name>.project.json`, `<name>.srt` and `edit_cuts.json` go beside it. */
  out: string;
  /** A UTF-8 file of people's names said in the footage, one per line: they help the speech
   * model and the correction hear them, and a lower third may show them. */
  names?: string;
  /** A UTF-8 file of terms said in the footage, one per line, such as brands and jargon: they
   * only help the speech model and the correction hear them. */
  terms?: string;
  /** The caption preset (../captions/presets.ts): bold unless given. */
  captions?: string;
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
   * fits, or none. Without music the edit has none. */
  music?: string[];
  /** The licence of every track without its own `<name>.txt`, such as "CC0 1.0". */
  musicLicense?: string;
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
  let last = 0;
  const report: Reporter = (stage, fraction, message, file, download, step) => {
    last = Math.max(last, Math.min(1, Math.round(fraction * 10_000) / 10_000));
    emit(
      validateProgress({
        stage,
        fraction: last,
        message,
        ...(file ? { file } : {}),
        ...(download ? { download } : {}),
        ...(step ? { step } : {}),
      }),
    );
  };
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
    emit(validateProgress({ stage: "error", fraction: last, message, ...claude }));
    throw error;
  }
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
  return (name: string, bytes: number, total: number) => {
    const now = Date.now();
    if (total <= 0 || (bytes < total && now - (shown.get(name) ?? 0) < 250)) return;
    shown.set(name, now);
    const download = { name, bytes: Math.min(bytes, total), total };
    report(stage, 0, `Downloading ${name}, the first time it is used`, undefined, download);
  };
}

/** Usage summed by the stage that asked: the plan with the callouts it finds on screen, or the
 * review with what it escalates. */
export function costByStage(usages: readonly Usage[]): ClaudeCost {
  const stage = (purposes: Usage["purpose"][]) => {
    const total = totalUsage(usages.filter((usage) => purposes.includes(usage.purpose)));
    return { dollars: total.dollars, requests: total.calls };
  };
  return {
    plan: stage(["plan", "locate"]),
    graphics: stage(["graphics"]),
    check: stage(["check", "judge"]),
  };
}

async function steps(options: EditOptions, report: Reporter, spent: Usage[]): Promise<EditResult> {
  const [shortest, longest] = LENGTH_RANGE;
  if (!(options.length >= shortest && options.length <= longest)) {
    throw new EditError(
      `The length must be ${shortest} s to ${longest / 3600} h, not ${options.length} s`,
    );
  }
  const log = options.onLog ?? (() => {});
  const timings: Record<Stage, number> = { analyze: 0, plan: 0, render: 0, check: 0 };
  const timed = async <T>(stage: Stage, work: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    try {
      return await work();
    } finally {
      timings[stage] += (performance.now() - start) / 1000;
    }
  };

  const video = resolve(options.out);
  const stem = basename(video, extname(video));
  if (existsSync(video) && !existsSync(join(dirname(video), `${stem}.project.json`))) {
    throw new EditError(
      `${options.out}: already there, and not an earlier edit; name the video something else, ` +
        "so no footage is written over",
    );
  }
  const files = await collectInputs(options.inputs, video);
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
  // An edit is cut from the footage, so footage shorter than it fails now rather than after
  // minutes of analysis. A file whose length FFmpeg cannot read is left to the analysis.
  const lengths = await Promise.all(videos.map(durationOf));
  const footage = lengths.reduce<number>((sum, seconds) => sum + (seconds ?? Infinity), 0);
  if (footage < options.length * (1 - TOLERANCE)) {
    throw new EditError(
      `The footage lasts ${footage.toFixed(1)} s in all, too short for a ${options.length} s ` +
        "edit: ask for a shorter edit or add footage",
    );
  }
  await mkdir(dirname(video), { recursive: true });
  let asked = options.claude;
  if (!asked) {
    report("analyze", 0, "Checking that Claude can plan the edit");
    await checkClaude(PLAN_MODELS[options.quality ?? "best"]);
    asked = anthropicClaude();
  }
  const ask = asked;
  const claude: Claude = async (request) => {
    const reply = await ask(request);
    spent.push(reply.usage);
    return reply;
  };
  // The renderer's FFmpeg, downloaded on its first use, before the long analysis rather than
  // after it.
  const download = downloading(report, "analyze");
  await ffmpeg((bytes, total) => download("FFmpeg", bytes, total));
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
  const analyzeShare = await timed("analyze", async () => {
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

  const rest = 1 - analyzeShare;
  const planAt = analyzeShare;
  const renderAt = planAt + rest * SHARES.plan;
  const checkAt = renderAt + rest * SHARES.render;
  const work = join(dirname(video), `.${stem}.edit`);
  const inputs: PlanInput[] = files.flatMap((file): PlanInput[] => {
    const index = indexes.get(file);
    if (index) return [{ index: index.path, source: file.path }];
    return file.kind === "image" ? [{ image: file.path }] : [];
  });
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
        inputs,
        length: options.length,
        aspect: options.aspect,
        out: join(work, "project.json"),
        ...(options.look
          ? { look: options.look === "none" ? null : { id: options.look, intensity: 1 } }
          : {}),
        music,
        // The people a lower third may name, never the terms. The names file is in the
        // glossary's format, where blank lines and lines starting with # are not names.
        names: (names?.text.split(/\r?\n/) ?? [])
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#")),
        ...(options.captions ? { captions: options.captions } : {}),
        ...(options.instructions ? { instructions: options.instructions } : {}),
        claude,
        ...(options.quality ? { quality: options.quality } : {}),
        ...(options.visuals ? { visuals: options.visuals } : {}),
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

    const passSpan = (1 - checkAt) / MAX_REVIEW_PASSES;
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

    const cached = [...indexes.values()].filter((index) => index.cached).length;
    return {
      outputs: {
        video: rendered.video,
        project: rendered.project,
        ...(rendered.captions ? { captions: rendered.captions } : {}),
        ...(rendered.music ? { music: rendered.music } : {}),
        ...(rendered.broll ? { broll: rendered.broll } : {}),
      },
      seconds: rendered.seconds,
      timings,
      usage: totalUsage(spent),
      analyzed: indexes.size - cached,
      cached,
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

/** Fails, naming the file, unless FFmpeg decodes a picture from it. */
/** A video's length as its container states it; null when FFmpeg cannot say. */
async function durationOf(file: MediaFile): Promise<number | null> {
  const args = ["-hide_banner", "-nostdin", "-i", file.path, "-t", "0", "-f", "null", "-"];
  const said = await run(await ffmpeg(), args).catch(() => ({ stderr: "" }));
  const [, hours, minutes, seconds] = said.stderr.match(/Duration: (\d+):(\d+):([\d.]+)/) ?? [];
  return hours === undefined ? null : Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
}

async function checkImage(file: MediaFile): Promise<void> {
  try {
    await run(await ffmpeg(), [...QUIET, "-i", file.path, "-frames:v", "1", "-f", "null", "-"]);
  } catch (error) {
    const why = (error as Error).message.split("\n").at(-1);
    throw new EditError(`${file.given}: not an image FFmpeg can read (${why})`);
  }
}
