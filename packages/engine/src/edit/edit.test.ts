// Runs the whole edit on the synthetic talk of ../plan/talk.ts, with a stand-in for vework
// (fixtures/vework.ts) and Claude's recorded plan, so it needs neither the models nor a key.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { loadJson, type Progress, validateProject } from "@video-editor/schema";
import { ffmpeg, run } from "../ffmpeg.ts";
import { type Claude, ClaudeError, checkClaude, type Usage } from "../plan/claude.ts";
import { PlanError } from "../plan/plan.ts";
import type { CutVerdict, Decisions } from "../plan/prompt.ts";
import { makeSong, makeTalk } from "../plan/talk.ts";
import { scratch } from "../testing.ts";
import { localWorker, type Worker } from "./analyze.ts";
import { costByStage, type EditOptions, edit } from "./edit.ts";
import { EditError } from "./error.ts";
import { collectMusic } from "./music.ts";

const vework: Worker = {
  command: [process.execPath, fileURLToPath(new URL("fixtures/vework.ts", import.meta.url))],
  version: "test",
};

const recorded = async (): Promise<Decisions> =>
  JSON.parse(
    await readFile(new URL("../plan/fixtures/talk-plan.json", import.meta.url), "utf8"),
  )[0];

/** Claude as recorded for the talk: the plan, with `logo` placed as B-roll and any `changes`,
 * and every cut fine. */
async function recordedClaude(
  changes: Partial<Decisions> = {},
): Promise<{ claude: Claude; purposes: string[]; schemas: Record<string, unknown>[] }> {
  const decisions: Decisions = {
    ...(await recorded()),
    broll: [{ broll: "logo", start: 0, end: 2, source: "talk", line: 4, reason: "The tool." }],
    ...changes,
  };
  const fine: CutVerdict = { problem: "none", fix: "none", confidence: 0.9, reason: "Clean." };
  const purposes: string[] = [];
  const schemas: Record<string, unknown>[] = [];
  const claude: Claude = async (request) => {
    purposes.push(request.purpose);
    if (request.purpose === "plan") schemas.push(request.schema);
    // A plan costs 5 cents and a check a tenth of a cent, so the done line's sums show.
    const dollars = request.purpose === "plan" ? 0.05 : 0.001;
    const usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, dollars };
    return {
      json: request.purpose === "plan" ? decisions : fine,
      usage: { purpose: request.purpose, model: request.model, ...usage },
    };
  };
  return { claude, purposes, schemas };
}

/** A footage folder holding the talk and a still, and options that edit it to 15 s. */
async function footage(dir: string) {
  const folder = join(dir, "footage");
  await mkdir(folder);
  await makeTalk(folder);
  await run(await ffmpeg(), [
    ...["-v", "error", "-f", "lavfi", "-i", "smptebars=s=320x180", "-frames:v", "1"],
    join(folder, "logo.png"),
  ]);
  const calls = join(dir, "vework.jsonl");
  process.env.FAKE_VEWORK_LOG = calls;
  const lines: Progress[] = [];
  const { claude, purposes } = await recordedClaude();
  const options: EditOptions = {
    inputs: [folder],
    length: 15,
    aspect: "9:16",
    out: join(dir, "out", "talk.mp4"),
    claude,
    worker: vework,
    cache: join(dir, "cache"),
    onProgress: (line) => lines.push(line),
  };
  const analyses = async () =>
    existsSync(calls)
      ? (await readFile(calls, "utf8"))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as string[])
      : [];
  return { folder, options, lines, purposes, analyses };
}

test("a footage folder becomes the video, its project, its captions and progress lines", async (t) => {
  const dir = await scratch(t, "edit-");
  const { folder, options, lines, purposes, analyses } = await footage(dir);
  const result = await edit(options);

  // The video, within 5 % of the length, and the project that renders it again.
  assert.ok(Math.abs(result.seconds - 15) <= 0.75, `${result.seconds} s`);
  const project = await loadJson(result.outputs.project, validateProject);
  assert.equal(result.outputs.project, join(dir, "out", "talk.project.json"));
  assert.deepEqual(
    project.sources.map((s) => [s.id, s.kind]),
    [
      ["logo", "image"],
      ["talk", "video"],
    ],
  );
  assert.equal(project.broll?.[0]?.source, "logo", "the still shows as B-roll");
  assert.ok(existsSync(join(dir, "out", "edit_cuts.json")));
  assert.ok(!existsSync(join(dir, "out", ".talk.edit")), "the work folder is removed");

  // The captions are burned in, and beside the video as SubRip, from the first kept sentence.
  assert.ok(project.captions && project.captions.lines.length > 0, "the video has captions");
  assert.equal(result.outputs.captions, join(dir, "out", "talk.srt"));
  const srt = await readFile(join(dir, "out", "talk.srt"), "utf8");
  assert.match(srt, /^1\n00:00:00,\d{3} --> 00:00:0\d,\d{3}\n大家好　歡迎收看\n/);

  // Progress: every stage, files named as given, never going back, ending in done.
  const stages = new Set(lines.map((line) => line.stage));
  for (const stage of ["analyze", "plan", "render", "check"]) assert.ok(stages.has(stage as never));
  const named = lines.filter((line) => "file" in line && line.file);
  assert.ok(named.some((line) => "file" in line && line.file === join(folder, "talk.mp4")));
  // Each of vework's steps is progress, never a line for a person.
  const messages = lines.map((line) => line.message);
  for (const step of ["Finding faces", "Removing noise from speech", "Transcribing 2/2"]) {
    assert.ok(messages.includes(step), step);
  }
  // A model downloading on first use is a line with its bytes, holding the bar where it was.
  const downloads = lines.flatMap((line) => ("download" in line && line.download ? [line] : []));
  assert.deepEqual(
    downloads.map((line) => [line.message, line.download]),
    [
      [
        "Downloading Qwen/Qwen3-ASR-0.6B-hf",
        { name: "Qwen/Qwen3-ASR-0.6B-hf", bytes: 0, total: 4000 },
      ],
      [
        "Downloading Qwen/Qwen3-ASR-0.6B-hf",
        { name: "Qwen/Qwen3-ASR-0.6B-hf", bytes: 4000, total: 4000 },
      ],
    ],
  );
  const before = lines[lines.indexOf(downloads[0] as Progress) - 1];
  assert.equal(downloads[0]?.fraction, before?.fraction);
  for (let i = 1; i < lines.length; i++) {
    assert.ok((lines[i]?.fraction ?? 0) >= (lines[i - 1]?.fraction ?? 0), `line ${i} goes back`);
  }
  assert.deepEqual(lines.at(-1), {
    stage: "done",
    fraction: 1,
    message: `Finished: ${result.seconds.toFixed(1)} s at 9:16 in talk.mp4, captions in talk.srt`,
    claude: {
      plan: { dollars: 0.05, requests: 1 },
      // The edit's graphics, written once its cut is known; Claude wrote none here.
      graphics: { dollars: 0.001, requests: 1 },
      check: { dollars: 0.001 * (purposes.length - 2), requests: purposes.length - 2 },
    },
    outputs: result.outputs,
  });
  assert.deepEqual(purposes.slice(0, 3), ["plan", "graphics", "check"]);
  assert.equal(result.reviews, 1, "a review that finds nothing ends the loop");

  // The index lies in the cache with the denoised speech beside it, and nothing half-written.
  const cached = await readdir(options.cache ?? "");
  assert.equal(cached.length, 2, cached.join(", "));
  const name = cached.find((file) => file.endsWith(".index.json"))?.replace(/\.index\.json$/, "");
  assert.ok(cached.includes(`${name}.voice.wav`), cached.join(", "));
  // One analysis, of the video only; another edit of the same footage reads it from the cache.
  assert.deepEqual(
    (await analyses()).map((args) => args.slice(0, 3)),
    [["analyze", join(folder, "talk.mp4"), "-o"]],
  );
  lines.length = 0;
  const again = await edit({ ...options, aspect: "16:9", out: join(folder, "edit.mp4") });
  assert.deepEqual([again.analyzed, again.cached], [0, 1]);
  const cachedLine = lines.find((line) => line.message === "Analysed before");
  assert.ok(cachedLine && "file" in cachedLine && cachedLine.file === join(folder, "talk.mp4"));
  assert.equal((await analyses()).length, 1);
  // The edit written into the footage folder is not footage the next time.
  const third = await edit({ ...options, out: join(dir, "third.mp4"), look: "warm" });
  assert.equal(third.cached, 1);
  const thirdProject = await loadJson(third.outputs.project, validateProject);
  assert.ok(thirdProject.sources.every((source) => source.id !== "edit"));
  assert.ok(thirdProject.main.every((clip) => clip.grade?.look?.id === "warm"));
});

test("what the user asks of the edit reaches the plan", async (t) => {
  const dir = await scratch(t, "edit-instructions-");
  const { options } = await footage(dir);
  const { claude } = await recordedClaude();
  const asked: string[] = [];
  const listening: Claude = async (request) => {
    if (request.purpose === "plan") {
      asked.push(request.content.map((part) => (part.type === "text" ? part.text : "")).join("\n"));
    }
    return claude(request);
  };
  await edit({ ...options, claude: listening, instructions: "Open with the demo." });
  assert.match(asked[0] ?? "", /<instructions>\nOpen with the demo\.\n<\/instructions>/);
});

test("an economy edit plans with Sonnet, and each review pass says what its checks cost", async (t) => {
  const dir = await scratch(t, "edit-economy-");
  const { options, lines } = await footage(dir);
  const { claude } = await recordedClaude();
  const models: string[] = [];
  // A plan costs 5 cents and a check a tenth of one.
  const priced: Claude = async (request) => {
    models.push(request.model);
    const reply = await claude(request);
    const dollars = request.purpose === "plan" ? 0.05 : 0.001;
    return { ...reply, usage: { ...reply.usage, dollars } };
  };
  const result = await edit({ ...options, claude: priced, quality: "economy" });
  assert.equal(models[0], "claude-sonnet-5-5");
  assert.equal(result.usage.calls, models.length);
  const messages = lines.map((line) => line.message);
  assert.ok(messages.includes("claude-sonnet-5-5 planned the edit ($0.0500)"), messages.join("\n"));
  assert.ok(
    messages.some((m) =>
      /^Review 1: \d+ cuts checked, 0 judged by claude-sonnet-5-5 \(\$0\.00\d\d\)$/.test(m),
    ),
  );
});

test("music with its licence is analysed once, chosen by Claude, and credited beside the video", async (t) => {
  const dir = await scratch(t, "edit-music-");
  const { folder, options, lines, analyses } = await footage(dir);
  // The speech's loudness sets the music's level.
  const talk = join(folder, "talk.index.json");
  const media = JSON.parse(await readFile(talk, "utf8"));
  media.loudness = { momentary: [], short_term: Array.from({ length: 30 }, () => -20) };
  await writeFile(talk, JSON.stringify(media));
  const music = join(dir, "music");
  await mkdir(music);
  await makeSong(music, { name: "stand-in" });
  const url = "https://creativecommons.org/licenses/by/4.0/";
  await writeFile(join(music, "song.txt"), `CC BY 4.0\n${url}\nSong by Someone\n`);
  const choice = { track: "music-song", section: 2, reason: "An upbeat talk." };
  const { claude, schemas } = await recordedClaude({ music: choice });
  const result = await edit({ ...options, claude, music: [music] });

  const song = join(music, "song.wav");
  const call = (await analyses()).find((args) => args[0] === "analyze-music");
  assert.deepEqual(call?.slice(0, 2), ["analyze-music", song]);
  assert.deepEqual(call?.slice(4), [
    "--license",
    "CC BY 4.0",
    "--license-url",
    url,
    "--attribution",
    "Song by Someone",
  ]);
  assert.ok(lines.some((line) => "file" in line && line.file === join(music, "song.wav")));
  assert.ok((schemas[0]?.required as string[] | undefined)?.includes("music"), "music offered");
  const project = await loadJson(result.outputs.project, validateProject);
  assert.ok((project.audio.music ?? []).length > 0, "the music plays");
  assert.deepEqual(project.audio.music?.[0]?.license, {
    name: "CC BY 4.0",
    url,
    attribution: "Song by Someone",
  });
  assert.equal(result.outputs.music, join(dir, "out", "talk.music.txt"));
  const credits = await readFile(join(dir, "out", "talk.music.txt"), "utf8");
  assert.match(
    credits,
    /song\.wav\n {2}Licence: CC BY 4\.0 \(https:.*\)\n {2}Credit: Song by Someone/,
  );
  assert.match(lines.at(-1)?.message ?? "", /, the music's licences in talk\.music\.txt$/);

  // Another edit reads the track's index from the cache.
  await edit({ ...options, claude, music: [song], out: join(dir, "again.mp4") });
  assert.equal((await analyses()).filter((args) => args[0] === "analyze-music").length, 1);
});

test("each track needs a licence: its own <name>.txt, or one given for all", async (t) => {
  const dir = await scratch(t, "edit-licence-");
  await writeFile(join(dir, "a.mp3"), "");
  await writeFile(join(dir, "b.wav"), "");
  await writeFile(join(dir, "b.txt"), "\nCC0 1.0\n");
  await writeFile(join(dir, "notes.md"), "");
  await assert.rejects(
    collectMusic([dir]),
    (error: Error) =>
      error instanceof EditError && /a\.mp3: no licence.*a\.txt/.test(error.message),
  );
  const tracks = await collectMusic([dir], "CC BY 4.0");
  assert.deepEqual(
    tracks.map(({ file, license }) => [file.given, license]),
    [
      [join(dir, "a.mp3"), { name: "CC BY 4.0" }],
      [join(dir, "b.wav"), { name: "CC0 1.0" }],
    ],
  );
  await assert.rejects(collectMusic([join(dir, "notes.md")]), /notes\.md: not an audio file/);
  await assert.rejects(collectMusic([join(dir, "nope")]), /nope: no such file or folder/);
});

test("vework runs on the repository's Python, from any folder", async () => {
  // An edit after a Python upgrade had uv rebuild the worker's environment on the Python first on
  // PATH, without the models, and the analysis failed.
  const root = new URL("../../../../", import.meta.url);
  const python = (await readFile(new URL(".python-version", root), "utf8")).trim();
  const worker = fileURLToPath(new URL("worker/", root));
  const expected = ["uv", "run", "--project", worker, "--python", python];
  assert.deepEqual((await localWorker()).command, [...expected, "vework"]);
});

test("names and correction reach the analysis, and an index made without them is not reused", async (t) => {
  const dir = await scratch(t, "edit-names-");
  const { options, analyses } = await footage(dir);
  await edit(options);
  const names = join(dir, "terms.txt");
  // The glossary's format: blank lines and comments are not names.
  await writeFile(names, "# guests\n\nvideo editor\n");
  const { claude } = await recordedClaude();
  const asked: string[] = [];
  const listening: Claude = (request) => {
    if (request.purpose === "plan") asked.push(JSON.stringify(request.content));
    return claude(request);
  };
  const result = await edit({ ...options, names, correct: true, claude: listening });
  assert.equal(result.analyzed, 1);
  const calls = await analyses();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1]?.slice(4), ["--correct", "--glossary", names, "--asr-context"]);
  assert.match(asked[0] ?? "", /said in the footage: video editor\./);
});

test("terms help the analysis hear the speech but never name a lower third", async (t) => {
  const dir = await scratch(t, "edit-terms-");
  const { options, analyses } = await footage(dir);
  const names = join(dir, "names.txt");
  await writeFile(names, "林語安\n");
  const terms = join(dir, "terms.txt");
  await writeFile(terms, "Remotion\n");
  const { claude } = await recordedClaude();
  const asked: string[] = [];
  const listening: Claude = (request) => {
    if (request.purpose === "plan") asked.push(JSON.stringify(request.content));
    return claude(request);
  };
  await edit({ ...options, names, terms, claude: listening });
  // vework reads one glossary, of both.
  const [args] = await analyses();
  const at = args?.indexOf("--glossary") ?? -1;
  assert.deepEqual(args?.slice(at + 2), ["--asr-context"]);
  assert.equal(await readFile(args?.[at + 1] ?? "", "utf8"), "林語安\nRemotion\n");
  // The planner lists only the people.
  assert.match(asked[0] ?? "", /said in the footage: 林語安\./);
  assert.doesNotMatch(asked[0] ?? "", /Remotion/);

  // Terms alone, heard on OpenRouter without correction, are not used: the index is the one an
  // analysis without them wrote.
  const cloud = { ...options, asr: "cloud" as const };
  await edit(cloud);
  const result = await edit({ ...cloud, terms });
  assert.equal(result.cached, 1);
  assert.deepEqual((await analyses()).at(-1)?.slice(4), ["--asr", "cloud"]);
});

test("the edit's captions take the style asked for, and each analysis step is named", async (t) => {
  const dir = await scratch(t, "edit-captions-");
  const { options, lines } = await footage(dir);
  const result = await edit({ ...options, captions: "boxed" });
  const project = await loadJson(result.outputs.project, validateProject);
  assert.equal(project.captions?.preset, "boxed");
  const steps = lines.flatMap((line) => ("step" in line && line.step ? [line.step] : []));
  assert.deepEqual(
    [...new Set(steps)],
    ["probe", "shots", "speech", "loudness", "events", "faces", "denoise", "transcribe", "align"],
  );
  // Shot detection moves the bar as it goes.
  const shots = lines.filter((line) => "step" in line && line.step === "shots");
  assert.deepEqual(
    shots.map((line) => line.message),
    ["Detecting shots", "Detecting shots 50%"],
  );
  assert.ok((shots[1]?.fraction ?? 0) > (shots[0]?.fraction ?? 0));
});

test("cloud speech reaches the analysis without the context prompt, in an index of its own", async (t) => {
  const dir = await scratch(t, "edit-cloud-");
  const { options, analyses } = await footage(dir);
  await edit(options);
  const names = join(dir, "terms.txt");
  await writeFile(names, "video editor\n");
  const result = await edit({ ...options, names, asr: "cloud" });
  assert.equal(result.analyzed, 1);
  const calls = await analyses();
  assert.equal(calls.length, 2);
  // vework refuses a glossary it would not use: OpenRouter takes no context prompt.
  assert.deepEqual(calls[1]?.slice(4), ["--asr", "cloud"]);
});

test("inputs that cannot make the edit fail before any analysis, saying why", async (t) => {
  const dir = await scratch(t, "edit-bad-");
  const { folder, options, lines, analyses } = await footage(dir);
  const fails = async (changes: Partial<EditOptions>, pattern: RegExp) => {
    lines.length = 0;
    await assert.rejects(edit({ ...options, ...changes }), (error: Error) => {
      assert.ok(error instanceof EditError, error.message);
      assert.match(error.message, pattern);
      return true;
    });
    const last = lines.at(-1);
    assert.equal(last?.stage, "error");
    assert.equal(last?.message.length > 0, true);
  };
  await writeFile(join(dir, "song.mp3"), "");
  await fails({ inputs: [folder, join(dir, "song.mp3")] }, /song\.mp3: audio only.*--music/);
  await fails({ music: [join(dir, "song.mp3")] }, /song\.mp3: no licence/);
  await fails({ length: 7200 }, /The length must be 15 s to 1 h, not 7200 s/);
  await fails({ inputs: [join(dir, "nope")] }, /nope: no such file or folder/);
  await fails({ inputs: [join(folder, "logo.png")] }, /No video among the inputs/);
  await fails({ names: join(dir, "missing.txt") }, /missing\.txt: cannot read the names file/);
  await writeFile(join(dir, "fake.png"), "not an image");
  await fails(
    { inputs: [folder, join(dir, "fake.png")] },
    /fake\.png: not an image FFmpeg can read/,
  );
  await fails(
    { worker: { command: ["no-such-program-for-vework"], version: "test" } },
    /no-such-program-for-vework is not installed or not on PATH/,
  );
  assert.equal((await analyses()).length, 0, "nothing was analysed");
});

test("footage shorter than the length is refused before any analysis", async (t) => {
  const dir = await scratch(t, "edit-short-");
  const { options, lines, purposes, analyses } = await footage(dir);
  await assert.rejects(
    edit({ ...options, length: 120 }),
    (error: Error) =>
      error instanceof EditError &&
      error.message ===
        "The footage lasts 25.0 s in all, too short for a 120 s edit: ask for a shorter edit or add footage",
  );
  assert.equal(lines.at(-1)?.stage, "error");
  assert.deepEqual(await analyses(), [], "nothing was analysed");
  assert.deepEqual(purposes, [], "Claude was not asked");
});

test("a file the analysis cannot read, or a length past the speech, fails clearly", async (t) => {
  const dir = await scratch(t, "edit-unreadable-");
  const { options, lines, purposes } = await footage(dir);
  const broken = join(dir, "broken.mp4");
  await writeFile(broken, "not a video");
  await assert.rejects(
    edit({ ...options, inputs: [broken] }),
    (error: Error) =>
      error instanceof EditError &&
      error.message ===
        `${broken}: the analysis failed: ${broken}: Invalid data found when processing input`,
  );
  assert.equal(lines.at(-1)?.stage, "error");
  // 26 s fits in the 25 s talk within 5 %, but its speech does not.
  await assert.rejects(
    edit({ ...options, length: 26 }),
    (error: Error) => error instanceof PlanError && /Ask for at most 24 s/.test(error.message),
  );
  assert.deepEqual(purposes, [], "Claude was not asked");
});

test("a missing or wrong key fails the check before any analysis, saying where the key goes", async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(401, { "content-type": "application/json" });
    const error = { type: "authentication_error", message: "invalid x-api-key" };
    response.end(JSON.stringify({ type: "error", error }));
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => server.close());
  const address = server.address() as { port: number };
  const client = new Anthropic({ apiKey: "wrong", baseURL: `http://127.0.0.1:${address.port}` });
  await assert.rejects(
    checkClaude(undefined, client),
    (error: Error) =>
      error instanceof ClaudeError &&
      /invalid x-api-key/.test(error.message) &&
      /ANTHROPIC_API_KEY/.test(error.message),
  );
});

test("an output that would overwrite footage fails before any analysis", async (t) => {
  const dir = await scratch(t, "edit-overwrite-");
  const { folder, options, lines, analyses } = await footage(dir);
  const talk = join(folder, "talk.mp4");
  const before = await readFile(talk);
  for (const inputs of [[talk], [folder]]) {
    lines.length = 0;
    await assert.rejects(
      edit({ ...options, inputs, out: talk }),
      (error: Error) =>
        error instanceof EditError && error.message.startsWith(`${talk}: already there`),
    );
    assert.equal(lines.at(-1)?.stage, "error");
  }
  assert.deepEqual(await readFile(talk), before, "the footage is untouched");
  assert.equal((await analyses()).length, 0);
  // An earlier edit, with its project beside it, is written over.
  const first = await edit({ ...options, out: join(dir, "out", "talk.mp4") });
  const again = await edit({ ...options, out: first.outputs.video });
  assert.equal(again.outputs.video, first.outputs.video);
});

test("an empty video fails with an error line, not a crash", async (t) => {
  const dir = await scratch(t, "edit-empty-");
  const { options, lines } = await footage(dir);
  const empty = join(dir, "empty.mp4");
  await writeFile(empty, "");
  await assert.rejects(
    edit({ ...options, inputs: [empty] }),
    (error: Error) => error instanceof EditError && error.message.startsWith(`${empty}: `),
  );
  assert.equal(lines.at(-1)?.stage, "error");
  for (const line of lines) assert.ok(Number.isFinite(line.fraction), JSON.stringify(line));
});

test("the analysis reads stdout and stderr apart, so a half-written line hides no progress", async (t) => {
  const dir = await scratch(t, "edit-streams-");
  const { folder, options, lines } = await footage(dir);
  // Like Python, which buffers stdout when it is piped: half a line, then progress on stderr.
  const script = join(dir, "chatty.ts");
  await writeFile(
    script,
    `import { copyFile } from "node:fs/promises";
const [, source = "", , out = ""] = process.argv.slice(2);
const pause = () => new Promise((done) => setTimeout(done, 50));
process.stdout.write("Downloading weights from the hub");
await pause();
process.stderr.write("vework: transcribing 1/2\\n");
await pause();
process.stdout.write(" ... done\\n");
await copyFile(source.replace(/\\.[^.]+$/, ".index.json"), out);
`,
  );
  const worker: Worker = { command: [process.execPath, script], version: "chatty" };
  await edit({ ...options, inputs: [join(folder, "talk.mp4")], worker });
  assert.ok(lines.some((line) => line.message === "Transcribing 1/2"));

  // The last line, even without its newline, is read: here the error that says why.
  // A character split between two writes stays whole.
  await writeFile(
    script,
    `const said = Buffer.from("vework: error: 找不到模型");
process.stderr.write(said.subarray(0, said.length - 1));
await new Promise((done) => setTimeout(done, 50));
process.stderr.write(said.subarray(said.length - 1));
process.exit(1);
`,
  );
  await assert.rejects(
    edit({ ...options, inputs: [join(folder, "talk.mp4")], worker: { ...worker, version: "2" } }),
    (error: Error) => error instanceof EditError && /: 找不到模型$/.test(error.message),
  );

  // A worker that dies without saying why, as a crash or the system ending it would: the step
  // it reached and how it ended say what is known.
  await writeFile(script, `process.stderr.write("vework: aligning 1/8\\n");\nprocess.exit(3);\n`);
  await assert.rejects(
    edit({ ...options, inputs: [join(folder, "talk.mp4")], worker: { ...worker, version: "3" } }),
    (error: Error) =>
      error instanceof EditError &&
      /the analysis failed: it stopped while aligning 1\/8 and exited with code 3$/.test(
        error.message,
      ),
  );
});

test("lines while the review fixes the plan belong to the check", async (t) => {
  const dir = await scratch(t, "edit-fix-");
  const { options, lines } = await footage(dir);
  const { claude } = await recordedClaude();
  let fixed = false;
  const clipped: CutVerdict = {
    problem: "clipped_word",
    fix: "more_room",
    confidence: 0.95,
    reason: "The first word is clipped.",
  };
  // The cut that took out a filler, which the fix puts back; cuts are checked in parallel, so
  // which check comes first varies.
  const fixing: Claude = async (request) => {
    const answer = await claude(request);
    const filler = request.content.some(
      (part) => part.type === "text" && part.text.includes("a few words removed"),
    );
    if (request.purpose !== "check" || !filler || fixed) return answer;
    fixed = true;
    return { ...answer, json: clipped };
  };
  const result = await edit({ ...options, claude: fixing });
  assert.ok(result.reviews >= 2, "the fix was rendered and reviewed again");
  const firstCheck = lines.findIndex((line) => line.stage === "check");
  assert.ok(firstCheck > 0);
  const late = lines.slice(firstCheck).filter((line) => line.stage === "plan");
  assert.deepEqual(late, []);
});

test("a plan Claude cannot make fails saying the analysis is kept, and leaves no work files", async (t) => {
  const dir = await scratch(t, "edit-late-");
  const { options, lines } = await footage(dir);
  const failing: Claude = async (request) => {
    throw new ClaudeError(`The ${request.purpose} request to ${request.model} failed: terminated`);
  };
  await assert.rejects(
    edit({ ...options, claude: failing }),
    (error: Error) =>
      error instanceof ClaudeError &&
      /failed: terminated\. The analysis is kept, so running the edit again starts at the plan$/.test(
        error.message,
      ),
  );
  assert.equal(lines.at(-1)?.stage, "error");
  assert.ok(!("claude" in (lines.at(-1) as object)), "nothing was spent");
  assert.ok(!existsSync(join(dir, "out", ".talk.edit")), "the work folder is removed");
});

test("an edit that fails after a plan says what Claude cost on its error line", async (t) => {
  const dir = await scratch(t, "edit-spent-");
  const { options, lines } = await footage(dir);
  const unusable: Claude = async (request) => ({
    json: {},
    usage: {
      purpose: request.purpose,
      model: request.model,
      input: 0,
      cacheWrite: 0,
      cacheRead: 0,
      output: 0,
      dollars: 0.05,
    },
  });
  await assert.rejects(edit({ ...options, claude: unusable }));
  const last = lines.at(-1);
  assert.equal(last?.stage, "error");
  assert.deepEqual(last && "claude" in last ? last.claude : undefined, {
    plan: { dollars: 0.05, requests: 1 },
    graphics: { dollars: 0, requests: 0 },
    check: { dollars: 0, requests: 0 },
  });
});

test("the command reports arguments it cannot use as an error line too", async (t) => {
  const dir = await scratch(t, "edit-cli-");
  const cli = fileURLToPath(new URL("cli.ts", import.meta.url));
  const runCli = (args: string[], env: NodeJS.ProcessEnv = { INIT_CWD: dir }) =>
    new Promise<{ code: number | null; stdout: string }>((done) => {
      const child = spawn(process.execPath, [cli, ...args], {
        cwd: dir,
        env: { ...process.env, npm_lifecycle_event: "edit", ...env },
      });
      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.on("close", (code) => done({ code, stdout }));
    });
  for (const [args, pattern] of [
    [[".", "--length", "60", "--aspect", "4:3", "-o", "x.mp4"], /4:3/],
    [[".", "--length", "soon", "--aspect", "9:16", "-o", "x.mp4"], /soon is not a length/],
    [
      [".", "--length", "60", "--aspect", "9:16", "-o", "x.mp4", "--quality", "cheap"],
      /best or economy, not cheap/,
    ],
    [[".", "--length", "60", "--aspect", "9:16"], /-o/],
    [[".", "--length", "60", "--aspect", "9:16", "-o", "x.mp4", "--bogus"], /--bogus/],
    [[".", "--length", "60", "--aspect", "9:16", "-o", "x.mp4", "--look", "neon"], /neon/],
    [
      [".", "--length", "60", "--aspect", "9:16", "-o", "x.mp4", "--captions", "comic"],
      /bold, spotlight, sweep, boxed, not comic/,
    ],
  ] as const) {
    const { code, stdout } = await runCli([...args]);
    assert.equal(code, 2, args.join(" "));
    const last = JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as Progress;
    assert.equal(last.stage, "error");
    assert.match(last.message, pattern);
  }

  // Started by a program that pnpm started, such as a server, paths are the program's own.
  await writeFile(join(dir, "song.mp3"), "");
  const elsewhere = await scratch(t, "edit-cli-elsewhere-");
  const args = ["song.mp3", "--length", "60", "--aspect", "9:16", "-o", "x.mp4"];
  const { stdout } = await runCli(args, { INIT_CWD: elsewhere, npm_lifecycle_event: "dev" });
  const last = JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as Progress;
  assert.match(last.message, /song\.mp3: audio only/);
});

test("what Claude cost is summed by stage, the callouts found while planning with the plan", () => {
  const usage = (purpose: Usage["purpose"], dollars: number): Usage => ({
    purpose,
    model: "m",
    input: 0,
    cacheWrite: 0,
    cacheRead: 0,
    output: 0,
    dollars,
  });
  const spent = [
    usage("plan", 0.05),
    usage("locate", 0.0002),
    usage("check", 0.001),
    usage("judge", 0.01),
  ];
  const cost = costByStage(spent);
  assert.equal(cost.plan.requests, 2);
  assert.ok(Math.abs((cost.plan.dollars ?? 0) - 0.0502) < 1e-9);
  assert.equal(cost.check.requests, 2);
});
