// `pnpm render`: renders a project.json again, as written or with stretches cut out of it.
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { loadJson, secondsToTicks, TICKS_PER_SECOND, validateProject } from "@video-editor/schema";
import { cutEdit, placeSources } from "./cut.ts";
import { rebase, render } from "./render.ts";

const usage = `Usage: pnpm render <project.json> -o <out.mp4> [--cut <from>-<to>]...

Renders the edit a project.json describes, without analysing or planning again, and writes
<name>.project.json, <name>.srt and edit_cuts.json beside the video.

  -o, --output   the video
      --cut      takes a stretch of the edit out, as times in the video it describes: seconds
                 or minutes:seconds, such as 12.5-15 or 1:02-1:04.5. The words said in it go,
                 every cut lands in a pause, and captions, overlays, B-roll and music move up
                 with the speech. What went is printed; the edit as cut is <name>.project.json`;

const parsed = (() => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        output: { type: "string", short: "o" },
        cut: { type: "string", multiple: true },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    console.error(`render: error: ${(error as Error).message}\n\n${usage}`);
    process.exit(2);
  }
})();
const { values, positionals } = parsed;
if (values.help) {
  console.log(usage);
  process.exit(0);
}
const [input] = positionals;
if (!input || !values.output || positionals.length > 1) {
  console.error(usage);
  process.exit(2);
}

/** A time in the video, as seconds or minutes:seconds, in seconds; null for anything else. */
function parseTime(text: string): number | null {
  const match = text.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const [, minutes, seconds] = match;
  if (minutes !== undefined && Number(seconds) >= 60) return null;
  return Number(minutes ?? 0) * 60 + Number(seconds);
}
const ranges = (values.cut ?? []).map((text) => {
  const [from, to] = text.split("-").map(parseTime);
  if (from == null || to == null || to <= from) {
    console.error(`render: error: --cut ${text} is not <from>-<to>, such as 12.5-15\n\n${usage}`);
    process.exit(2);
  }
  return [secondsToTicks(from), secondsToTicks(to)] as const;
});

// pnpm runs scripts in the root's or the package's folder; paths are the caller's.
const here = process.env.INIT_CWD ?? process.cwd();
const projectPath = resolve(here, input);
const out = resolve(here, values.output);
const seconds = (ticks: number) => (ticks / TICKS_PER_SECOND).toFixed(2);
try {
  let path = projectPath;
  if (ranges.length > 0) {
    const project = await loadJson(projectPath, validateProject);
    const cut = cutEdit(project, ranges, await placeSources(project, projectPath));
    for (const note of cut.notes) process.stderr.write(`render: ${note}\n`);
    const { duration, tolerance } = project.output.target;
    if (Math.abs(cut.length - duration) > tolerance * duration) {
      throw new Error(
        `The cut edit lasts ${seconds(cut.length)} s, outside the ${seconds(duration)} s ± ` +
          `${tolerance * 100} % it was planned for. To keep it, set /output/target/duration in ` +
          `the project to ${cut.length} first; for a new length, plan again with pnpm edit`,
      );
    }
    process.stderr.write(`render: the edit now lasts ${seconds(cut.length)} s\n`);
    const folder = dirname(out);
    path = join(folder, `${basename(out, extname(out))}.project.json`);
    if (path === projectPath) {
      throw new Error(`${input} would be written over; render the cut to another name`);
    }
    await mkdir(folder, { recursive: true });
    await writeFile(path, `${JSON.stringify(rebase(cut.project, projectPath, folder), null, 2)}\n`);
  }
  const result = await render(path, out, {
    onProgress: (fraction, message) =>
      process.stderr.write(`${Math.round(fraction * 100)}% ${message}\n`),
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`render: error: ${(error as Error).message}`);
  process.exit(1);
}
