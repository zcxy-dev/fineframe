// A small entry point for rendering one project by hand; `pnpm edit` is the product's.
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { render } from "./render.ts";

const usage = "Usage: pnpm --filter @video-editor/engine render <project.json> -o <out.mp4>";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { output: { type: "string", short: "o" }, help: { type: "boolean", short: "h" } },
});
if (values.help) {
  console.log(usage);
  process.exit(0);
}
const [project] = positionals;
if (!project || !values.output || positionals.length > 1) {
  console.error(usage);
  process.exit(2);
}
// pnpm runs package scripts in the package's folder; paths are the caller's.
const here = process.env.INIT_CWD ?? process.cwd();
try {
  const result = await render(resolve(here, project), resolve(here, values.output), {
    onProgress: (fraction, message) =>
      process.stderr.write(`${Math.round(fraction * 100)}% ${message}\n`),
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(`render: error: ${(error as Error).message}`);
  process.exit(1);
}
