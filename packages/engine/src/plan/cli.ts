// Plans one edit by hand: media indexes in, project.json out. `pnpm edit` is the
// product's command; this one is for trying the planner on its own.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseLength } from "../edit/length.ts";
import { isLookId, lookIds } from "../looks.ts";
import { totalUsage } from "./claude.ts";
import { type Aspect, LENGTH_RANGE, PlanError, plan } from "./plan.ts";

const usage = `Usage: pnpm --filter @video-editor/engine plan <index.json | folder>... \\
    --length <seconds> --aspect <9:16 | 1:1 | 16:9> [--music <music.json | folder>]... \\
    [--look <${[...lookIds, "none"].join(" | ")}>] -o <project.json>

A folder stands for every *.index.json and index.json in it; each index's source file sits
next to it. The length is ${LENGTH_RANGE[0]} to ${LENGTH_RANGE[1]} s, written as 90, 90s, 5m, 1:30 or 1h.
--music offers tracks analysed with vework analyze-music (a folder stands for every
*.music.json in it); Claude picks the one that fits the content, or none.
The look over the edit is clean unless --look names another, or none.
Claude plans the edit: ANTHROPIC_API_KEY comes from the environment or from the git-ignored
.env at the repository root.`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    length: { type: "string", short: "l" },
    aspect: { type: "string", short: "a" },
    music: { type: "string", multiple: true, short: "m" },
    look: { type: "string" },
    output: { type: "string", short: "o" },
    help: { type: "boolean", short: "h" },
  },
});
if (values.help) {
  console.log(usage);
  process.exit(0);
}
const length = values.length ? parseLength(values.length) : null;
const aspect = values.aspect as Aspect | undefined;
if (positionals.length === 0 || !values.output || length === null || !aspect) {
  console.error(usage);
  process.exit(2);
}
if (!["9:16", "1:1", "16:9"].includes(aspect)) {
  console.error(`plan: error: the aspect is 9:16, 1:1 or 16:9, not ${aspect}`);
  process.exit(2);
}
const look = values.look ?? "clean";
if (look !== "none" && !isLookId(look)) {
  console.error(`plan: error: the look is ${[...lookIds, "none"].join(", ")}, not ${look}`);
  process.exit(2);
}
const env = new URL("../../../../.env", import.meta.url);
if (!process.env.ANTHROPIC_API_KEY && existsSync(env)) process.loadEnvFile(env);

// pnpm runs package scripts in the package's folder; paths are the caller's.
const here = process.env.INIT_CWD ?? process.cwd();
try {
  const edit = await plan({
    inputs: positionals.map((input) => resolve(here, input)),
    length,
    aspect,
    music: (values.music ?? []).map((input) => resolve(here, input)),
    look: look === "none" ? null : { id: look, intensity: 1 },
    out: resolve(here, values.output),
    onProgress: (message) => process.stderr.write(`${message}\n`),
  });
  const { plan: planned, main, output } = edit.project;
  console.log(
    JSON.stringify(
      {
        project: edit.path,
        seconds: (planned?.fit.duration ?? 0) / 120_000,
        target: output.target.duration / 120_000,
        clips: main.length,
        model: planned?.model,
        usage: totalUsage(edit.state.usage),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error(`plan: error: ${(error as Error).message}`);
  process.exit(error instanceof PlanError ? 1 : 3);
}
