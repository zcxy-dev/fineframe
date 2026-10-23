// Stands in for `pnpm edit` in tests: records its arguments, prints progress lines (a model's
// download among them, and one going back, as a stage may report), waits while $FAKE_EDIT_HOLD
// names a file that exists, then writes the outputs and the done line with what Claude cost, with
// the schema's example project (with a lower third and a title as the planner writes them)
// playing the first --music track, or the library's first with --music library, and, with
// --visuals=rich, the B-roll credits. It fails unless ANTHROPIC_API_KEY is $FAKE_EDIT_KEY, and
// records the OpenRouter key it was given in openrouter.txt and the Pexels and Pixabay ones in
// stock.txt.
// $FAKE_EDIT_NO_CAPTIONS leaves the captions file empty, as the engine does when no speech is kept.
// $FAKE_EDIT_SKIP_MUSIC says the library track Claude chose could not be downloaded, and plays
// none, and $FAKE_EDIT_NO_BEATS that a given track was analysed without the beat model.
// With --shorts it makes two shorts, fewer than asked, from the first file in out/01 and out/02,
// each playing a stretch of that file, whose media index says it lasts 100 s. After the first it
// waits while $FAKE_SHORTS_HOLD names a file that exists, and with $FAKE_SHORTS_STOP it stops
// there at the cost limit. $FAKE_SHORTS_TORN leaves shorts.json half written while the first
// short's line is read, as a reader can find it while it is written.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { catalogTracks, libraryFile } from "@video-editor/engine/library";

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
const cost = { plan: { dollars: 0.07, requests: 1 }, check: { dollars: 0.012, requests: 9 } };
if (args.includes("--shorts")) {
  const out = args[args.indexOf("-o") + 1] ?? "out";
  const source = args[0] ?? "";
  await writeFile("index.json", JSON.stringify({ source: { duration: 100 } }));
  const shorts = {
    version: 1,
    asked: Number(args[args.indexOf("--shorts") + 1]),
    range: (args[args.indexOf("--length") + 1] ?? "").split("-").map(Number),
    shorts: [] as object[],
  };
  const made = [
    { title: "剪輯的一天：從 0 到 1?", start: 12.5, end: 61.25, length: 45 },
    { title: "Why we cut. ", start: 80, end: 99, length: 30 },
  ];
  for (const [i, short] of made.entries()) {
    const folder = `0${i + 1}`;
    const number = { n: i + 1, of: made.length };
    say({ stage: "render", fraction: 0.5 + i * 0.2, message: "Rendering", short: number });
    await mkdir(join(out, folder), { recursive: true });
    await writeFile(join(out, folder, "edit.mp4"), Buffer.alloc(1000 + i, 7));
    await writeFile(join(out, folder, "edit.srt"), `1\n00:00:00,000 --> 00:00:01,000\n短片 ${i}\n`);
    const project = JSON.parse(
      await readFile(
        new URL("../../../../packages/schema/examples/project.example.json", import.meta.url),
        "utf8",
      ),
    );
    project.sources = project.sources.filter((each: { kind: string }) => each.kind === "video");
    delete project.audio.music;
    project.sources[0].path = relative(join(out, folder), source);
    project.sources[0].index = relative(join(out, folder), "index.json");
    await writeFile(join(out, folder, "edit.project.json"), JSON.stringify(project));
    shorts.shorts.push({
      folder,
      ...short,
      description: `Description ${i + 1}.`,
      hashtags: ["#one", "#two", "#three"],
      source,
      seconds: short.length - 0.5,
    });
    const listed = JSON.stringify(shorts);
    const torn = process.env.FAKE_SHORTS_TORN && i === 0;
    await writeFile(join(out, "shorts.json"), torn ? listed.slice(0, 20) : listed);
    say({
      stage: "short",
      fraction: 0.6 + i * 0.2,
      message: `Short ${i + 1}`,
      short: number,
      claude: cost,
    });
    if (torn) {
      await new Promise((done) => setTimeout(done, 300));
      await writeFile(join(out, "shorts.json"), listed);
    }
    const held = process.env.FAKE_SHORTS_HOLD;
    while (held && existsSync(held)) await new Promise((done) => setTimeout(done, 20));
    if (process.env.FAKE_SHORTS_STOP) {
      await writeFile(join(out, "shorts.json"), JSON.stringify({ ...shorts, stopped: "cost" }));
      break;
    }
  }
  say({
    stage: "done",
    fraction: 1,
    message: "Made 2 shorts",
    claude: { find: { dollars: 0.1, requests: 1 }, ...cost },
    outputs: { shorts: join(out, "shorts.json") },
  });
  process.exit(0);
}
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
const [first] = catalogTracks();
if (track === "library" && first && !process.env.FAKE_EDIT_SKIP_MUSIC) {
  music.path = relative(dirname(out), libraryFile(first));
  music.fingerprint = { bytes: first.bytes, sha256: first.sha256 };
} else if (track && track !== "library") music.path = relative(dirname(out), track);
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
  claude: cost,
  ...(process.env.FAKE_EDIT_SKIP_MUSIC
    ? { musicSkipped: '"Song" by Someone, calm could not be downloaded: HTTP 503' }
    : {}),
  ...(process.env.FAKE_EDIT_NO_BEATS
    ? { beatsSkipped: "song.mp3: the beat model could not be downloaded" }
    : {}),
  outputs: { video: out, project, captions, ...(broll ? { broll } : {}) },
});
