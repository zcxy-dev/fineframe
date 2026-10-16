// Plans, renders and reviews edits of a corpus in vebench's layout, to measure the planner;
// `pnpm edit` is the product's command, from footage alone:
//
//   node scripts/plan-corpus.ts <corpus> --group talk-a --lengths 30,60,300 --aspect 16:9
//   cd ../../bench && uv run vebench report <corpus>
//
// Each clip folder of the corpus holds source.mp4 and the index.json vework wrote for it. For
// each length it writes to <first clip>/runs/<system>-<length>s/: project.json (as reviewed)
// and planned.json (before the first review), output.mp4, edit_cuts.json and the stems
// voice.wav and music.wav from the renderer, claude.json (every reply, replayed instead of
// calling the API when the same request comes again) and usage.json. The system is
// video-editor unless --system names another; --music offers the tracks of music indexes.
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
import { autoGrade } from "../src/grade.ts";
import {
  anthropicClaude,
  type Claude,
  type ClaudeRequest,
  recordedClaude,
  totalUsage,
} from "../src/plan/claude.ts";
import { type Aspect, type PlannedEdit, plan } from "../src/plan/plan.ts";
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
  },
});
const usage =
  "Usage: node scripts/plan-corpus.ts <corpus> --group <prefix>... --lengths 30,60 " +
  "[--aspect 16:9] [--naive] [--no-review] [--music <music.json | folder>]... [--system <name>]";
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

for (const group of values.group) {
  const clips = (await readdir(corpus))
    .filter((name) => name === group || name.match(new RegExp(`^${group}\\d+$`)))
    .sort();
  if (clips.length === 0) throw new Error(`${group}: no clips in ${corpus}`);
  const indexes = clips.map((clip) => join(corpus, clip, "index.json"));
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

/** Replays claude.json when it holds every reply the run asks for; otherwise calls the API and
 * records each reply, so a corpus run can be repeated without paying for it again. */
async function recorder(file: string): Promise<{ claude: Claude; save: () => Promise<void> }> {
  type Entry = { purpose: ClaudeRequest["purpose"]; key: string; json: unknown };
  const recorded: Entry[] = existsSync(file) ? JSON.parse(await readFile(file, "utf8")) : [];
  // Keyed by what was asked, since cut checks run several at a time and finish in any order.
  const keyOf = (request: ClaudeRequest) =>
    createHash("sha256")
      .update(request.purpose)
      .update(request.content.map((block) => (block.type === "text" ? block.text : "")).join("\n"))
      .digest("hex");
  const live = anthropicClaude();
  const entries: Entry[] = [];
  const claude: Claude = async (request) => {
    const key = keyOf(request);
    const found = recorded.find((entry) => entry.key === key);
    const reply = found
      ? await recordedClaude({ [request.purpose]: [found.json] }).claude(request)
      : await live(request);
    entries.push({ purpose: request.purpose, key, json: reply.json });
    return reply;
  };
  return { claude, save: () => writeFile(file, `${JSON.stringify(entries, null, 2)}\n`) };
}

/** The baseline: every clip whole, in file order, cut off at the target length. */
async function naive(indexes: string[], length: number, folder: string): Promise<void> {
  await mkdir(folder, { recursive: true });
  const target = secondsToTicks(length);
  const sources: Project["sources"] = [] as never;
  const main: Project["main"][number][] = [];
  let left = target;
  let fps = { num: 30, den: 1 };
  for (const [i, indexPath] of indexes.entries()) {
    const index = await loadJson(indexPath, validateMediaIndex);
    const media = join(indexPath, "..", index.source.name);
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
