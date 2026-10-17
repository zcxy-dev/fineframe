// Plans, renders and reviews edits of a corpus in vebench's layout, to measure the planner;
// `pnpm edit` is the product's command, from footage alone:
//
//   node scripts/plan-corpus.ts <corpus> --group talk-a --lengths 30,60,300 --aspect 16:9
//   cd ../../bench && uv run vebench report <corpus>
//
// Each clip folder of the corpus holds source.mp4 and, optionally, the index.json vework wrote
// for it; without one, the clip is analysed once into the index cache `pnpm edit` keeps
// (~/.cache/video-editor/indexes/), so a regenerated corpus is not analysed again. For
// each length it writes to <first clip>/runs/<system>-<length>s/: project.json (as reviewed)
// and planned.json (before the first review), output.mp4, edit_cuts.json and the stems
// voice.wav and music.wav from the renderer, claude.json (every reply, replayed when the same
// request comes again) and usage.json, with every request's tokens and cost. Claude is only
// replayed, so an engine-only change is compared on the same plans for nothing; a request with
// no recorded reply fails unless --live-claude lets it call the API (and record the reply). The system is video-editor unless --system names another; --music offers
// the tracks of music indexes, and --quality economy plans with the cheaper model.
// --naive also writes naive-<length>s/: every clip whole, in file order, cut off at the length.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  loadJson,
  type Project,
  secondsToTicks,
  ticksPerFrame,
  validateMediaIndex,
} from "@video-editor/schema";
import { cachedIndex, defaultCache, localWorker } from "../src/edit/analyze.ts";
import { autoGrade } from "../src/grade.ts";
import {
  anthropicClaude,
  type Claude,
  type ClaudeRequest,
  type Quality,
  recordedClaude,
  totalUsage,
} from "../src/plan/claude.ts";
import { type Aspect, type PlanInput, type PlannedEdit, plan } from "../src/plan/plan.ts";
import { review } from "../src/plan/review.ts";
import { render } from "../src/render.ts";
import { fingerprintOf, gridTicks } from "../src/sources.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    group: { type: "string", multiple: true },
    lengths: { type: "string" },
    aspect: { type: "string" },
    naive: { type: "boolean" },
    "no-review": { type: "boolean" },
    music: { type: "string", multiple: true },
    system: { type: "string" },
    quality: { type: "string" },
    "live-claude": { type: "boolean" },
  },
});
const usage =
  "Usage: node scripts/plan-corpus.ts <corpus> --group <prefix>... --lengths 30,60 " +
  "[--aspect 16:9] [--naive] [--no-review] [--music <music.json | folder>]... [--system <name>] " +
  "[--quality <best | economy>] [--live-claude]";
if (positionals.length !== 1 || !values.group || !values.lengths) {
  console.error(usage);
  process.exit(2);
}
const corpus = resolve(process.env.INIT_CWD ?? process.cwd(), positionals[0] as string);
const lengths = values.lengths.split(",").map(Number);
const aspect = (values.aspect ?? "16:9") as Aspect;
const here = process.env.INIT_CWD ?? process.cwd();
const music = (values.music ?? []).map((input) => resolve(here, input));
const log = (message: string) => process.stderr.write(`${message}\n`);
/** A clip's index beside its media, or a cached index with the media it is of. */
type CorpusInput = Extract<PlanInput, string | { index: string }>;

for (const group of values.group) {
  const clips = (await readdir(corpus))
    .filter((name) => name === group || name.match(new RegExp(`^${group}\\d+$`)))
    .sort();
  if (clips.length === 0) throw new Error(`${group}: no clips in ${corpus}`);
  const indexes = await Promise.all(clips.map((clip) => indexOf(join(corpus, clip))));
  const home = join(corpus, clips[0] as string, "runs");
  for (const length of lengths) {
    if (values.naive) await naive(indexes, length, join(home, `naive-${length}s`));
    const folder = join(home, `${values.system ?? "video-editor"}-${length}s`);
    await mkdir(folder, { recursive: true });
    log(`${group} ${length} s → ${relative(corpus, folder)}`);
    const { claude, save } = await recorder(join(folder, "claude.json"));
    const edit = await plan({
      inputs: indexes,
      length,
      aspect,
      music,
      out: join(folder, "project.json"),
      claude,
      quality: (values.quality ?? "best") as Quality,
      onProgress: log,
    });
    await renderEdit(edit, folder);
    // As planned, before any review, so a review's fixes can be measured.
    await copyFile(edit.path, join(folder, "planned.json"));
    const passes = [];
    while (!values["no-review"]) {
      // With music, the strips draw the voice alone, as the renderer wrote it.
      const voice = edit.project.audio.music ? { voice: join(folder, "voice.wav") } : {};
      const result = await review(edit, join(folder, "output.mp4"), { onProgress: log, ...voice });
      passes.push({
        pass: result.pass,
        changed: result.changed,
        note: result.note,
        problems: result.findings.filter((f) => f.verdict && f.verdict.problem !== "none"),
        unchecked: result.findings.filter((f) => !f.verdict).length,
      });
      if (!result.changed) break;
      await renderEdit(edit, folder);
    }
    await save();
    const summary = {
      usage: totalUsage(edit.state.usage),
      byPurpose: Object.fromEntries(
        ["plan", "check", "judge"].map((purpose) => [
          purpose,
          totalUsage(edit.state.usage.filter((u) => u.purpose === purpose)),
        ]),
      ),
      reviews: passes,
      requests: edit.state.usage,
    };
    await writeFile(join(folder, "usage.json"), `${JSON.stringify(summary, null, 2)}\n`);
  }
}

async function renderEdit(edit: PlannedEdit, folder: string): Promise<void> {
  await render(edit.path, join(folder, "output.mp4"), {
    stems: folder,
    onProgress: (fraction, message) => {
      if (fraction === 1) log(message);
    },
  });
}

/** The clip's own index.json, or else its source.mp4's index from the cache, analysed now if it
 * is not there. */
async function indexOf(clip: string): Promise<CorpusInput> {
  const own = join(clip, "index.json");
  if (existsSync(own)) return own;
  const source = join(clip, "source.mp4");
  const file = { given: source, path: source, kind: "video" as const };
  const step = (fraction: number, message: string) =>
    log(`${relative(corpus, clip)}: ${message} (${Math.round(fraction * 100)} %)`);
  const index = await cachedIndex(
    await localWorker(),
    file,
    { correct: false },
    defaultCache(),
    step,
    log,
  );
  return { index, source };
}

/** Replays claude.json; a request it holds no reply to calls the API with --live-claude, and
 * fails without, so a corpus run is repeated without paying for it again. */
async function recorder(file: string): Promise<{ claude: Claude; save: () => Promise<void> }> {
  type Entry = { purpose: ClaudeRequest["purpose"]; key: string; json: unknown };
  const recorded: Entry[] = existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : [];
  // Keyed by what was asked, since cut checks run several at a time and finish in any order.
  const keyOf = (request: ClaudeRequest) =>
    createHash("sha256")
      .update(request.purpose)
      .update(request.model)
      .update(request.content.map((block) => (block.type === "text" ? block.text : "")).join("\n"))
      .digest("hex");
  const live = values["live-claude"] ? anthropicClaude() : null;
  const entries: Entry[] = [];
  const claude: Claude = async (request) => {
    const key = keyOf(request);
    const found = recorded.find((entry) => entry.key === key);
    if (!found && !live) {
      throw new Error(
        `${file}: no recorded reply to a ${request.purpose} request; ` +
          "run with --live-claude to ask Claude and record it",
      );
    }
    const reply = found
      ? await recordedClaude({ [request.purpose]: [found.json] }).claude(request)
      : await (live as Claude)(request);
    entries.push({ purpose: request.purpose, key, json: reply.json });
    return reply;
  };
  return { claude, save: () => writeFile(file, `${JSON.stringify(entries, null, 2)}\n`) };
}

/** The baseline: every clip whole, in file order, cut off at the target length. */
async function naive(indexes: CorpusInput[], length: number, folder: string): Promise<void> {
  await mkdir(folder, { recursive: true });
  const target = secondsToTicks(length);
  const sources: Project["sources"] = [] as never;
  const main: Project["main"][number][] = [];
  let left = target;
  let fps = { num: 30, den: 1 };
  for (const [i, input] of indexes.entries()) {
    const indexPath = typeof input === "string" ? input : input.index;
    const index = await loadJson(indexPath, validateMediaIndex);
    const media =
      typeof input === "string" ? join(indexPath, "..", index.source.name) : input.source;
    const id = `clip-${i + 1}`;
    if (i === 0) {
      const ticks = gridTicks(index.source.video?.fps ?? 30);
      if (ticks)
        fps = 120_000 % ticks === 0 ? { num: 120_000 / ticks, den: 1 } : { num: 30_000, den: 1001 };
    }
    sources.push({
      id,
      kind: "video",
      path: relative(folder, media),
      index: relative(folder, indexPath),
      fingerprint: await fingerprintOf(media),
    });
    if (left <= 0) continue;
    const frame = ticksPerFrame(fps);
    const take = Math.floor(Math.min(left, secondsToTicks(index.source.duration)) / frame) * frame;
    main.push({ source: id, in: 0, out: take });
    left -= take;
  }
  const project: Project = {
    version: 1,
    output: {
      aspect,
      ...(aspect === "9:16"
        ? { width: 720, height: 1280 }
        : aspect === "1:1"
          ? { width: 720, height: 720 }
          : { width: 1280, height: 720 }),
      fps,
      target: { duration: target, tolerance: 0.05 },
    },
    sources,
    main: main as Project["main"],
    audio: { loudness: { integratedLufs: -14, truePeakDbtp: -1 } },
  };
  const path = join(folder, "project.json");
  await writeFile(path, JSON.stringify(project, null, 2));
  await writeFile(path, JSON.stringify(await autoGrade(project, path), null, 2));
  await render(path, join(folder, "output.mp4"));
  log(`naive ${length} s → ${relative(corpus, folder)}`);
}
