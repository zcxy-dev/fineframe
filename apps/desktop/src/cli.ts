// `fineframe edit` and `fineframe render`: `pnpm edit` and `pnpm render` with the desktop app's own
// parts, for people and agents without a clone. The launcher the app's menu installs (install.ts)
// runs this with the app's binary as Node, the app's folder in VIDEO_EDITOR_DATA. The editor runs
// as the page's server runs it: from the app's resources, with its Python, uv and keys.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { NO_SANDBOX } from "./install.ts";
import { keysFile, restoreLinks, runtimeEnvironment } from "./server.ts";

const COMMANDS: Record<string, string[]> = {
  edit: ["packages", "engine", "src", "edit", "cli.ts"],
  render: ["packages", "engine", "src", "cli.ts"],
};
const usage = `Usage: fineframe edit <footage>... --length <length> --aspect <aspect> -o <out.mp4> [...]
       fineframe render <project.json> -o <out.mp4> [...]

Fineframe's editor, with the app's own runtime and the keys saved in it.
fineframe edit --help and fineframe render --help list each one's options.`;

const given = process.argv.slice(1);
if (given[0] === NO_SANDBOX) given.shift();
const [command, ...args] = given;
if (command === undefined || command === "--help" || command === "-h" || command === "help") {
  console.log(usage);
  process.exit(0);
}
const script = COMMANDS[command];
if (!script) {
  console.error(`fineframe: no command ${command}\n\n${usage}`);
  process.exit(2);
}

const places = {
  editor: join(process.resourcesPath, "editor"),
  bin: join(process.resourcesPath, "bin"),
  data: process.env.VIDEO_EDITOR_DATA ?? "",
};
// The stamp the page's server writes once the analysis's Python is installed (apps/web/lib/setup.ts).
if (!places.data || !existsSync(join(places.data, "python", "env", ".video-editor-worker"))) {
  console.error(
    "fineframe: Fineframe is not set up yet. Open the Fineframe app once and wait until it is ready, then run this again.",
  );
  process.exit(1);
}
await restoreLinks(places.editor);

// As in the app, a key saved in it is used over one in the environment.
const keys = existsSync(keysFile(places)) ? parseEnv(readFileSync(keysFile(places), "utf8")) : {};
const inherited = { ...process.env };
// The paths given are this folder's, not those of a pnpm script that may have run this.
delete inherited.INIT_CWD;
delete inherited.npm_lifecycle_event;
delete inherited.VIDEO_EDITOR_DATA;
const child = spawn(process.execPath, [join(places.editor, ...script), ...args], {
  stdio: "inherit",
  env: { ...runtimeEnvironment(places, inherited), ...keys, VIDEO_EDITOR_COMMAND: "fineframe" },
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => child.kill(signal));
}
child.once("error", (error) => {
  console.error(`fineframe: ${error.message}`);
  process.exit(1);
});
child.once("exit", (code, signal) => {
  process.exit(code ?? 128 + (signal ? constants.signals[signal] : 0));
});
