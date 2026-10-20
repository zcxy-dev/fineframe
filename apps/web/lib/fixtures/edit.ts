// Stands in for `pnpm edit` in tests: records its arguments, prints progress lines (a model's
// download among them, and one going back, as a stage may report), waits while $FAKE_EDIT_HOLD
// names a file that exists, then writes the outputs and the done line with what Claude cost, with
// the schema's example project (with a lower third and a title as the planner writes them)
// playing the first --music track and, with --visuals=rich, the B-roll credits. It fails unless
// ANTHROPIC_API_KEY is $FAKE_EDIT_KEY, and records the OpenRouter key it was given in
// openrouter.txt and the Pexels and Pixabay ones in stock.txt.
// $FAKE_EDIT_NO_CAPTIONS leaves the captions file empty, as the engine does when no speech is kept.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";

const args = process.argv.slice(2);
await writeFile("args.json", JSON.stringify(args));
await writeFile("openrouter.txt", process.env.OPENROUTER_API_KEY ?? "");
await writeFile(
  "stock.txt",
  `${process.env.PEXELS_API_KEY ?? ""} ${process.env.PIXABAY_API_KEY ?? ""}`,
);
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
say({ stage: "analyze", fraction: 0.1, message: "Transcribing", file, step: "transcribe" });
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
// The schema's example project, playing the first track offered or no music.
const example = JSON.parse(
  await readFile(
    new URL("../../../../packages/schema/examples/project.example.json", import.meta.url),
    "utf8",
  ),
);
// The example's overlays are only shaped like overlays; these are templates the planner uses.
const [person, word] = example.overlays as { start: number; duration: number }[];
example.overlays = [
  { ...person, template: "lower-third", params: { name: "王小明", role: "Host" } },
  { ...word, template: "title", params: { text: "Claude" } },
];
const music = example.sources.find((source: { kind: string }) => source.kind === "audio");
if (track) music.path = relative(dirname(out), track);
else {
  example.sources = example.sources.filter((source: unknown) => source !== music);
  delete example.audio.music;
}
await writeFile(project, JSON.stringify(example));
const captions = out.replace(/\.mp4$/, ".srt");
await writeFile(
  captions,
  process.env.FAKE_EDIT_NO_CAPTIONS ? "" : "1\n00:00:00,000 --> 00:00:01,000\n大家好\n",
);
const broll = args.includes("--visuals=rich") ? out.replace(/\.mp4$/, ".broll.txt") : undefined;
if (broll) await writeFile(broll, "Stock footage: Ocean waves by A. Person (Pexels License)\n");
say({
  stage: "done",
  fraction: 1,
  message: "Finished",
  claude: { plan: { dollars: 0.07, requests: 1 }, check: { dollars: 0.012, requests: 9 } },
  outputs: { video: out, project, captions, ...(broll ? { broll } : {}) },
});
