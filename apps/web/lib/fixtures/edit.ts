// Stands in for `pnpm edit` in tests: records its arguments, prints progress lines (a model's
// download among them, and one going back, as a stage may report), waits while $FAKE_EDIT_HOLD
// names a file that exists, then writes the outputs and the done line with what Claude cost, with
// a project that plays the first --music track. It fails unless ANTHROPIC_API_KEY is
// $FAKE_EDIT_KEY, and records the OpenRouter key it was given in openrouter.txt.
// $FAKE_EDIT_NO_CAPTIONS leaves the captions file empty, as the engine does when no speech is kept.
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";

const args = process.argv.slice(2);
await writeFile("args.json", JSON.stringify(args));
await writeFile("openrouter.txt", process.env.OPENROUTER_API_KEY ?? "");
const say = (line: object) => process.stdout.write(`${JSON.stringify(line)}\n`);
if (process.env.ANTHROPIC_API_KEY !== process.env.FAKE_EDIT_KEY) {
  say({ stage: "error", fraction: 0, message: "Not the key the page saved" });
  process.exit(1);
}
const file = "footage/a.mp4";
const model = "Qwen/Qwen3-ASR-0.6B-hf";
for (const bytes of [0, 4000]) {
  const download = { name: model, bytes, total: 4000 };
  say({ stage: "analyze", fraction: 0, message: `Downloading ${model}`, file, download });
}
say({ stage: "analyze", fraction: 0.1, message: "Transcribing", file });
process.stderr.write("vework: transcribing\n");
const hold = process.env.FAKE_EDIT_HOLD;
while (hold && existsSync(hold)) await new Promise((done) => setTimeout(done, 20));
say({ stage: "plan", fraction: 0.6, message: "Planning" });
say({ stage: "render", fraction: 0.55, message: "Rendering" });
const out = args[args.indexOf("-o") + 1] ?? "out/edit.mp4";
await mkdir(dirname(out), { recursive: true });
await writeFile(out, Buffer.alloc(1000, 7));
const project = out.replace(/\.mp4$/, ".project.json");
const track = args.includes("--music") ? args[args.indexOf("--music") + 1] : undefined;
// Only what the page reads of a project: the music it plays and where each source is.
await writeFile(
  project,
  JSON.stringify({
    sources: track ? [{ id: "m0", kind: "audio", path: relative(dirname(out), track) }] : [],
    audio: { music: track ? [{ source: "m0", start: 0 }] : [] },
  }),
);
const captions = out.replace(/\.mp4$/, ".srt");
await writeFile(
  captions,
  process.env.FAKE_EDIT_NO_CAPTIONS ? "" : "1\n00:00:00,000 --> 00:00:01,000\n大家好\n",
);
say({
  stage: "done",
  fraction: 1,
  message: "Finished",
  claude: { plan: { dollars: 0.07, requests: 1 }, check: { dollars: 0.012, requests: 9 } },
  outputs: { video: out, project, captions },
});
