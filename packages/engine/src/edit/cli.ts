// `pnpm edit`: footage in, a finished video out.
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { type Progress, validateProgress } from "@video-editor/schema";
import { isLookId, type LookId, lookIds } from "../looks.ts";
import { ClaudeError } from "../plan/claude.ts";
import { type Aspect, dollars, LENGTH_RANGE, PlanError } from "../plan/plan.ts";
import { edit } from "./edit.ts";
import { EditError } from "./error.ts";
import { parseLength } from "./length.ts";

const [shortest, longest] = LENGTH_RANGE;
const usage = `Usage: pnpm edit <footage folder or file>... --length <length> \\
    --aspect <9:16 | 1:1 | 16:9> -o <out.mp4> [--names <terms.txt>] [--correct] \\
    [--look <${[...lookIds, "none"].join(" | ")}>] \\
    [--music <track or folder>]... [--music-license <licence>]

Edits footage into a finished video within 5 % of the length asked. A folder stands for the
files directly in it: videos to cut, and still images to show as B-roll.

  -l, --length   ${shortest} s to ${longest / 3600} h: 60s, 90, 3m, 1m30s, 1:30, 1h
  -a, --aspect   9:16, 1:1 or 16:9
  -o, --output   the video; <name>.project.json, <name>.srt and edit_cuts.json go beside it
      --names    a text file of names and terms said in the footage, one per line, given to
                 the speech model and to --correct; a person's name there can show in a
                 lower third
      --correct  have Claude correct each transcript before its words are timed
      --look     the look over the edit: clean unless another is named, or none
  -m, --music    background music Claude may choose from: an audio file, or a folder of them.
                 Use only music you have the right to use. Each track's licence is the first
                 line of <name>.txt beside it (a web address and a credit line may follow);
                 the licences are written to <name>.music.txt beside the video
      --music-license
                 the licence of every track without its own <name>.txt, such as "CC0 1.0"

Progress goes to stdout as JSON lines (packages/schema/progress.schema.json), and everything
for a person to stderr. Each file's analysis is kept in ~/.cache/video-editor/indexes, so
editing the same footage again starts at the plan. Claude plans the edit and checks its cuts:
ANTHROPIC_API_KEY comes from the environment or the git-ignored .env at the repository root.`;

// A caller reading stdout, such as the web page, gets the reason as the last progress line.
const fail = (message: string): never => {
  const line: Progress = { stage: "error", fraction: 0, message };
  process.stdout.write(`${JSON.stringify(validateProgress(line))}\n`);
  console.error(`edit: error: ${message}\n\n${usage}`);
  process.exit(2);
};
const parsed = (() => {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        length: { type: "string", short: "l" },
        aspect: { type: "string", short: "a" },
        output: { type: "string", short: "o" },
        names: { type: "string" },
        correct: { type: "boolean" },
        look: { type: "string" },
        music: { type: "string", short: "m", multiple: true },
        "music-license": { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    return fail((error as Error).message);
  }
})();
const { values, positionals } = parsed;
if (values.help) {
  console.error(usage);
  process.exit(0);
}
if (positionals.length === 0 || !values.length || !values.aspect || !values.output) {
  fail("footage, --length, --aspect and -o are required");
}
const length = parseLength(values.length as string);
if (length === null) fail(`${values.length} is not a length`);
const aspect = values.aspect as Aspect;
if (!["9:16", "1:1", "16:9"].includes(aspect))
  fail(`the aspect is 9:16, 1:1 or 16:9, not ${aspect}`);
const look = values.look ?? "clean";
if (look !== "none" && !isLookId(look)) {
  fail(`the look is ${[...lookIds, "none"].join(", ")}, not ${look}`);
}

const env = new URL("../../../../.env", import.meta.url);
if (existsSync(env)) process.loadEnvFile(env);
// pnpm runs scripts in the package's folder; the paths, and the files progress names, are the
// caller's. INIT_CWD is that folder only when pnpm ran this script: a program pnpm started, such
// as a server, passes it on to the commands it runs from folders of its own.
if (process.env.npm_lifecycle_event === "edit" && process.env.INIT_CWD) {
  process.chdir(process.env.INIT_CWD);
}

const say = (line: string) => process.stderr.write(`${line}\n`);
try {
  const result = await edit({
    inputs: positionals,
    length: length as number,
    aspect,
    out: values.output as string,
    ...(values.names ? { names: values.names } : {}),
    correct: values.correct ?? false,
    look: look as LookId | "none",
    music: values.music ?? [],
    ...(values["music-license"] ? { musicLicense: values["music-license"] } : {}),
    onProgress: (line) => {
      process.stdout.write(`${JSON.stringify(line)}\n`);
      const file = "file" in line && line.file ? `${line.file}: ` : "";
      say(`edit: ${line.stage} ${Math.round(line.fraction * 100)}% ${file}${line.message}`);
    },
    onLog: say,
  });
  const { timings: t, usage: u } = result;
  const seconds = (value: number) => `${value.toFixed(1)} s`;
  say(
    `edit: analyze ${seconds(t.analyze)} (analysed ${result.analyzed}, from the cache ` +
      `${result.cached}), plan ${seconds(t.plan)}, render ${seconds(t.render)}, check ` +
      `${seconds(t.check)} (reviews: ${result.reviews}); Claude for planning and review ` +
      `${dollars(u.dollars)} (requests: ${u.calls})`,
  );
} catch (error) {
  // A known error reached the caller as the last progress line and on stderr; anything else
  // is a bug, and its stack says where.
  const known = [EditError, PlanError, ClaudeError].some((kind) => error instanceof kind);
  if (!known) say(String((error as Error).stack));
  process.exit(1);
}
