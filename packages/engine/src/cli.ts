// `pnpm render`: renders a project.json again, as written or with stretches cut out of it, or
// exports it for an editing app.
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  loadJson,
  type Project,
  secondsToTicks,
  TICKS_PER_SECOND,
  validateProject,
} from "@video-editor/schema";
import { loadKit, stageBrand, withBrand } from "./brand/kit.ts";
import { cutEdit, placeSources } from "./cut.ts";
import { catalogTracks, MOODS, swapMusic } from "./library.ts";
import { exportEdit } from "./nle/export.ts";
import { rebase, render } from "./render.ts";

/** What runs this: pnpm in a clone, or the desktop app's `fineframe` command (apps/desktop). */
const command = process.env.VIDEO_EDITOR_COMMAND ?? "pnpm";
const usage = `Usage: ${command} render <project.json> -o <out.mp4> [--cut <from>-<to>]... [--retarget] \\
    [--brand <kit folder | none>] [--music <library track id | none>]
       pnpm render <project.json> --export <folder>

Renders the edit a project.json describes, without analysing or planning again, and writes
<name>.project.json, <name>.srt and edit_cuts.json beside the video.

  -o, --output   the video
      --export   instead of rendering, exports the edit for an editing app into the folder,
                 which must be empty or new: <name>.fcpxml for Final Cut Pro and DaVinci Resolve,
                 <name>.xml for Premiere Pro, <name>.srt, and in media/ the B-roll, music and
                 sound effects with overlay.mov, the graphics over transparency. The footage
                 is not copied: the timelines name where it is
      --cut      takes a stretch of the edit out, as times in the video it describes: seconds
                 or minutes:seconds, such as 12.5-15 or 1:02-1:04.5. The words said in it go,
                 every cut moves to a pause inside it (or, with none, the nearest outside, as
                 stderr says), and captions, overlays, B-roll and music move up with the
                 speech. What went is printed; the edit as cut is <name>.project.json
      --retarget makes the cut edit's length the one it is planned for, for a cut that takes
                 it outside 5 % of that, which otherwise fails
      --brand    renders the edit in a brand kit's look, its files copied into brand/ beside
                 the video, or with none in the house look; its custom captions replace the
                 caption style. The edit as changed is <name>.project.json
      --music    plays this track of the built-in music library under the edit instead of
                 its music, fitted to the edit as a plan fits it, or none for no music. The
                 track downloads on its first use. The edit as changed is <name>.project.json.
                 The library's tracks, all CC0, by mood:
${MOODS.map(
  (mood) =>
    `                 ${mood}: ${catalogTracks()
      .filter((track) => track.mood === mood)
      .map((track) => track.id)
      .join(", ")}`,
).join("\n")}`;

const parsed = (() => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        output: { type: "string", short: "o" },
        export: { type: "string" },
        cut: { type: "string", multiple: true },
        retarget: { type: "boolean" },
        brand: { type: "string" },
        music: { type: "string" },
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
const exporting = values.export !== undefined;
const changing = values.cut !== undefined || values.brand !== undefined;
if (
  !input ||
  positionals.length > 1 ||
  exporting === (values.output !== undefined) ||
  (exporting && changing) ||
  (values.retarget && !values.cut)
) {
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
  const parts = text.split("-");
  const [from, to] = parts.map(parseTime);
  if (parts.length !== 2 || from == null || to == null || to <= from) {
    console.error(`render: error: --cut ${text} is not <from>-<to>, such as 12.5-15\n\n${usage}`);
    process.exit(2);
  }
  return [secondsToTicks(from), secondsToTicks(to)] as const;
});

// pnpm runs scripts in the root's or the package's folder; paths are the caller's.
const here = process.env.INIT_CWD ?? process.cwd();
const projectPath = resolve(here, input);
const seconds = (ticks: number) => (ticks / TICKS_PER_SECOND).toFixed(2);
if (values.export !== undefined) {
  try {
    const result = await exportEdit(projectPath, resolve(here, values.export), {
      onProgress: (fraction, message) =>
        process.stderr.write(`${Math.round(fraction * 100)}% ${message}\n`),
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(`render: error: ${(error as Error).message}`);
    process.exit(1);
  }
  process.exit(0);
}
const out = resolve(here, values.output as string);
try {
  let path = projectPath;
  if (ranges.length > 0 || values.brand || values.music) {
    let project = await loadJson(projectPath, validateProject);
    const folder = dirname(out);
    path = join(folder, `${basename(out, extname(out))}.project.json`);
    if (path === projectPath) {
      throw new Error(`${input} would be written over; render the change to another name`);
    }
    if (values.brand) {
      const kit =
        values.brand === "none"
          ? null
          : await stageBrand(
              await loadKit(resolve(here, values.brand)),
              resolve(here, values.brand),
              join(folder, "brand"),
              dirname(projectPath),
            );
      project = withBrand(project, kit);
    }
    if (ranges.length > 0) project = await cut(project);
    if (values.music) {
      project = await swapMusic(
        project,
        projectPath,
        values.music === "none" ? null : values.music,
      );
    }
    await mkdir(folder, { recursive: true });
    await writeFile(path, `${JSON.stringify(rebase(project, projectPath, folder), null, 2)}\n`);
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

/** The project with the --cut stretches taken out. */
async function cut(project: Project): Promise<Project> {
  const cut = cutEdit(project, ranges, await placeSources(project, projectPath));
  for (const note of cut.notes) process.stderr.write(`render: ${note}\n`);
  const { duration, tolerance } = project.output.target;
  if (values.retarget) {
    cut.project.output = { ...cut.project.output, target: { duration: cut.length, tolerance } };
  } else if (Math.abs(cut.length - duration) > tolerance * duration) {
    throw new Error(
      `The cut edit lasts ${seconds(cut.length)} s, outside the ${seconds(duration)} s ± ` +
        `${tolerance * 100} % it was planned for. --retarget keeps it at ${seconds(cut.length)} s; ` +
        "for another length, plan again with pnpm edit",
    );
  }
  process.stderr.write(`render: the edit now lasts ${seconds(cut.length)} s\n`);
  return cut.project;
}
