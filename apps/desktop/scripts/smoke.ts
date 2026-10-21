// Runs a built app as a person would the first time, with no key of theirs and nothing set up:
//
//   node scripts/smoke.ts <the app's executable> [--shots <folder>]
//
// It opens the app's window, saves a key, waits while the analysis's Python installs, chooses
// cloud speech and its key, adds a synthetic spoken clip, makes a 15 s edit and checks the video,
// then quits the app and checks nothing it started is left running. Claude and OpenRouter are
// local stand-ins that answer as they would, so it costs nothing: the plan keeps the lines in
// order, the graphics are one label on the first word said, every cut passes
// its check, and each speech chunk is heard as one of the clip's sentences. Everything else is
// real: the analysis's models, FFmpeg, ffprobe and Chrome Headless Shell download on first use,
// and the clip is analysed, planned, rendered with its graphic and checked.
// `--shots` saves the window at each step.
//
// On Linux, run it under a display, such as `xvfb-run -a`. The clip's speech comes from the
// system's voice: `say` on macOS, the speech synthesizer .NET ships on Windows, espeak-ng on Linux.
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { _electron as electron, type Page } from "playwright-core";
import { descendantsOf, type ProcessRow } from "./processes.ts";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { shots: { type: "string" } },
});
const executable = positionals[0];
if (!executable) {
  console.error("Usage: node scripts/smoke.ts <the app's executable> [--shots <folder>]");
  process.exit(2);
}
const shots = values.shots ? resolve(values.shots) : null;
const say = (line: string) => console.log(`smoke: ${line}`);
const LENGTH = 15;

const SENTENCES = [
  "Welcome to this short test of the desktop editor.",
  "It runs on its own, with nothing to set up first.",
  "The footage stays on this computer the whole time.",
  "Speech is heard, timed and turned into captions.",
  "Claude plans the cuts and checks every one of them.",
  "The result comes back at the length you asked for.",
  "Every cut lands in a pause between two words.",
  "Thank you for watching this small demonstration.",
];

const work = await mkdtemp(join(tmpdir(), "video-editor-smoke-"));
// The app's own folders and caches start empty, so every first-use download happens.
const home = { XDG_CONFIG_HOME: join(work, "config"), XDG_CACHE_HOME: join(work, "cache") };
/** The files under `dir`, three levels deep, to say what a cache holds when a check fails. */
const contents = (dir: string, depth = 3): string => {
  if (!existsSync(dir)) return `${dir} does not exist`;
  const names: string[] = [];
  const walk = (at: string, left: number) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      names.push(join(at, entry.name).slice(dir.length + 1));
      if (entry.isDirectory() && left > 1) walk(join(at, entry.name), left - 1);
    }
  };
  walk(dir, depth);
  return names.join(", ") || "nothing";
};
/** Whether the app's own cache holds a download whose folder starts with `prefix`. */
const fetched = (prefix: string) => {
  const dir = join(home.XDG_CACHE_HOME, "video-editor");
  return existsSync(dir) && readdirSync(dir).some((name) => name.startsWith(prefix));
};

// --- The clip: a test pattern and the sentences spoken, a pause after each. ---

/** A PowerShell command that speaks `sentence` into the WAV file `file`. */
function windowsSpeech(file: string, sentence: string): string {
  const quoted = (text: string) => `'${text.replaceAll("'", "''")}'`;
  return [
    "Add-Type -AssemblyName System.Speech",
    "$voice = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    `$voice.SetOutputToWaveFile(${quoted(file)})`,
    `$voice.Speak(${quoted(sentence)})`,
    "$voice.Dispose()",
  ].join("; ");
}

async function makeClip(): Promise<string> {
  const dir = join(work, "clip");
  await mkdir(dir, { recursive: true });
  const voices: string[] = [];
  for (const [i, sentence] of SENTENCES.entries()) {
    const file = join(dir, `${i}.${process.platform === "darwin" ? "aiff" : "wav"}`);
    const [program, ...args] =
      process.platform === "darwin"
        ? ["say", "-o", file, sentence]
        : process.platform === "win32"
          ? ["powershell", "-NoProfile", "-Command", windowsSpeech(file, sentence)]
          : ["espeak-ng", "-s", "150", "-w", file, sentence];
    const result = spawnSync(program as string, args, { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`${program} could not speak the clip's sentences`);
    voices.push(file);
  }
  // The repository's own pinned FFmpeg, in a cache of its own: the app downloads its copy itself.
  process.env.XDG_CACHE_HOME = join(work, "smoke-cache");
  const { ffmpeg, run } = await import("../../../packages/engine/src/ffmpeg.ts");
  const bin = await ffmpeg();
  delete process.env.XDG_CACHE_HOME;
  const clip = join(dir, "talk.mp4");
  const pads = voices.map(
    (_, i) => `[${i + 1}:a]aresample=48000,aformat=channel_layouts=mono,apad=pad_dur=0.8[a${i}]`,
  );
  const joined = `${voices.map((_, i) => `[a${i}]`).join("")}concat=n=${voices.length}:v=0:a=1[a]`;
  await run(bin, [
    ...["-v", "error", "-f", "lavfi", "-i", "testsrc2=s=1280x720:r=30"],
    ...voices.flatMap((file) => ["-i", file]),
    ...["-filter_complex", [...pads, joined].join(";"), "-map", "0:v", "-map", "[a]"],
    ...["-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", clip],
  ]);
  return clip;
}

// --- Stand-ins for Anthropic's and OpenRouter's APIs. ---

type Schema = { type?: string; enum?: unknown[]; properties?: Record<string, Schema> } & {
  required?: string[];
};

/** The plainest answer a structured-output schema allows: "none" where an enum has it. */
function plainest(schema: Schema): unknown {
  if (schema.enum) return schema.enum.includes("none") ? "none" : schema.enum[0];
  if (schema.type === "object") {
    return Object.fromEntries(
      (schema.required ?? []).map((key) => [key, plainest(schema.properties?.[key] ?? {})]),
    );
  }
  if (schema.type === "array") return [];
  if (schema.type === "integer") return 1;
  if (schema.type === "number") return 0.9;
  if (schema.type === "boolean") return false;
  return "Fine.";
}

/** Every progress line about the graphics, as the job's event stream sends each change: what
 * Claude wrote, what was left out and why, and what was kept. */
const graphicLines: string[] = [];
async function follow(id: string, signal: AbortSignal): Promise<void> {
  try {
    const response = await fetch(`${origin}/api/jobs/${id}/events`, { signal });
    const decoder = new TextDecoder();
    let pending = "";
    for await (const chunk of response.body ?? []) {
      pending += decoder.decode(chunk as Uint8Array, { stream: true });
      const events = pending.split("\n\n");
      pending = events.pop() ?? "";
      for (const event of events) {
        if (!event.startsWith("data: ")) continue;
        const message = (JSON.parse(event.slice(6)) as { progress?: { message: string } }).progress
          ?.message;
        if (message && /graphic/i.test(message) && graphicLines.at(-1) !== message) {
          graphicLines.push(message);
        }
      }
    }
  } catch {
    // Stopped once the edit is done.
  }
}

/** The plan for the files the request lists: every line in order, earlier lines first to keep,
 * and the first line its emphasis. */
function planFor(packed: string, schema: Schema): unknown {
  const decisions = plainest(schema) as Record<string, unknown>;
  const segments: object[] = [];
  const emphasis: object[] = [];
  let source = "";
  for (const line of packed.split("\n")) {
    const header = line.match(/^## (\S+) \(/);
    if (header) source = header[1] as string;
    const numbered = line.match(/^(\d+) \[[^\]]+\] (.+)$/);
    if (!numbered || !source) continue;
    const n = Number(numbered[1]);
    const reason = "In order.";
    segments.push({ source, first: n, last: n, priority: Math.min(5, Math.ceil(n / 2)), reason });
    if (emphasis.length === 0) {
      const words = (numbered[2] as string).replace(/[⟨⟩]/g, "").split(/\s+/);
      emphasis.push({ source, line: n, text: words.slice(0, 3).join(" "), reason });
    }
  }
  return { ...decisions, content: "A short spoken test.", segments, emphasis };
}

/** The edit's graphics: one label of 2 s, with a bundled icon, on the first word of the speech
 * the request lists, which it gives as `word@seconds`, whose label keeps clear of what the request
 * lists as taken (an effect, B-roll), as Claude is told to; in the safe area at either aspect. */
function graphicsFor(request: string): unknown {
  const listed = request.split("Taken, no graphic over these:")[1] ?? "";
  const taken = [...listed.matchAll(/^([\d.]+)–([\d.]+) s: /gm)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
  const said = request
    .split("\n")
    .filter((line) => line.startsWith("["))
    .flatMap((line) => [...line.matchAll(/(\S+)@([\d.]+)/g)])
    .map((m) => ({ word: m[1] as string, at: Number(m[2]) }));
  // It shows from 0.4 s before the word for 2 s, with 0.4 s clear on either side.
  const clear = ({ at }: { at: number }) =>
    taken.every(([start, end]) => at + 2 <= (start as number) || at - 0.8 >= (end as number));
  const first = said.find(clear);
  if (!first) return { graphics: [] };
  const { word, at } = first;
  return {
    graphics: [
      {
        layout: "label",
        anchor: word,
        at,
        seconds: 2,
        quotes: [word],
        shows: "The first word said.",
        sfx: "none",
        html: `<div class="ff-chip" style="position:absolute;left:calc(var(--u)*12);top:calc(var(--u)*24);animation:ff-rise .5s var(--enter) both"><img src="icons/accent/sparkles.svg" style="width:calc(var(--u)*5);height:calc(var(--u)*5)"><span style="font-size:calc(var(--u)*6)">${word}</span></div>`,
        css: "",
      },
    ],
  };
}

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

const asked: string[] = [];
/** How many graphics the edit's project has once it is made. */
let graphics = 0;
const anthropic = createServer(async (request, response) => {
  const path = request.url ?? "";
  if (request.method === "GET" && path.startsWith("/v1/models/")) {
    const id = decodeURIComponent(path.slice("/v1/models/".length).split("?")[0] as string);
    json(response, 200, {
      type: "model",
      id,
      display_name: id,
      created_at: "2026-01-01T00:00:00Z",
    });
    return;
  }
  if (request.method !== "POST" || !path.startsWith("/v1/messages")) {
    json(response, 404, { type: "error", error: { type: "not_found_error", message: path } });
    return;
  }
  const params = JSON.parse(await body(request)) as {
    model: string;
    stream?: boolean;
    messages: { content: { type: string; text?: string }[] }[];
    output_config: { format: { schema: Schema } };
  };
  const schema = params.output_config.format.schema;
  const planning = "segments" in (schema.properties ?? {});
  const writing = "graphics" in (schema.properties ?? {}) && !asked.includes("graphics");
  asked.push(planning ? "plan" : writing ? "graphics" : "check");
  const packed = params.messages[0]?.content[0]?.text ?? "";
  const text = JSON.stringify(
    planning ? planFor(packed, schema) : writing ? graphicsFor(packed) : plainest(schema),
  );
  const usage = { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0 };
  const message = {
    id: `msg_${asked.length}`,
    type: "message",
    role: "assistant",
    model: params.model,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { ...usage, cache_read_input_tokens: 0 },
  };
  if (!params.stream) {
    json(response, 200, { ...message, content: [{ type: "text", text }] });
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream" });
  const events: [string, object][] = [
    ["message_start", { message: { ...message, content: [], stop_reason: null } }],
    ["content_block_start", { index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { index: 0, delta: { type: "text_delta", text } }],
    ["content_block_stop", { index: 0 }],
    ["message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage }],
    ["message_stop", {}],
  ];
  for (const [type, data] of events) {
    response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  }
  response.end();
});

let heard = 0;
const openrouter = createServer(async (request, response) => {
  const path = (request.url ?? "").replace(/^\/api\/v1/, "");
  await body(request);
  if (path === "/key") json(response, 200, { data: { label: "smoke" } });
  else if (path.endsWith("/endpoints")) {
    json(response, 200, { data: { architecture: { output_modalities: ["transcription"] } } });
  } else if (path === "/audio/transcriptions") {
    const text = SENTENCES[heard++ % SENTENCES.length];
    json(response, 200, { text, language: "English", usage: { cost: 0 } });
  } else json(response, 404, { error: { message: path } });
});

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

// --- The app. ---

async function shot(page: Page, name: string): Promise<void> {
  if (!shots) return;
  await mkdir(shots, { recursive: true });
  await page.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
  say(`saved ${name}.png`);
}

/** The processes `root` started, and theirs, by their ids, from a listing of every process with,
 * on Windows, when each started. */
function descendants(root: number): number[] {
  const listing =
    process.platform === "win32"
      ? spawnSync(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $(if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() })" }',
          ],
          { encoding: "utf8" },
        ).stdout
      : spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8" }).stdout;
  const rows = listing
    .trim()
    .split("\n")
    .map((line): ProcessRow => {
      const [pid, parent, created] = line.trim().split(/\s+/).map(Number) as number[];
      return {
        pid: pid as number,
        parent: parent as number,
        ...(Number.isFinite(created) ? { created } : {}),
      };
    });
  return descendantsOf(rows, root);
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const clip = await makeClip();
say(`made ${clip}`);
const inherited = Object.entries(process.env).filter(
  (entry): entry is [string, string] => entry[1] !== undefined && !entry[0].endsWith("_API_KEY"),
);
const env: Record<string, string> = {
  ...Object.fromEntries(inherited),
  ...home,
  ANTHROPIC_BASE_URL: await listen(anthropic),
  OPENROUTER_BASE_URL: `${await listen(openrouter)}/api/v1`,
  APPIMAGE_EXTRACT_AND_RUN: "1",
};

const app = await electron.launch({ executablePath: resolve(executable), env, timeout: 120_000 });
const pid = app.process().pid as number;
// Everything the app starts while it runs, to check none of it outlives the app.
const started = new Set<number>();
const tracking = setInterval(
  () => {
    for (const child of descendants(pid)) started.add(child);
    // Listing Windows' processes takes about a second.
  },
  process.platform === "win32" ? 1000 : 250,
);
const page = await app.firstWindow();
page.on("pageerror", (error) => say(`page error: ${error.message}`));
await page.waitForURL(/^http:\/\/127\.0\.0\.1:\d+\//, { timeout: 120_000 });
const origin = new URL(page.url()).origin;
say(`the page is at ${origin}`);
const api = async <T>(path: string): Promise<T> => (await fetch(`${origin}${path}`)).json() as T;
// Every first-use download the page shows, watched from the start: on a fast network the
// analysis environment can finish installing while the key dialog is still open.
const downloads = new Set<string>();
const watching = setInterval(async () => {
  try {
    const setup = await api<{ download?: { name: string } }>("/api/setup");
    if (setup.download) downloads.add(setup.download.name);
    const job = await api<{ download?: { name: string } } | null>("/api/jobs/latest");
    if (job?.download) downloads.add(job.download.name);
  } catch {}
}, 250);

/**
 * Plays the finished video in the window's own player, as its owner would: waits for it to load,
 * seeks to the middle and reads that frame back, so a build of Chromium that cannot decode H.264
 * and AAC shows as a frame with no size or an error.
 */
async function playInPage(page: Page) {
  return page.locator("video").evaluate(async (video: HTMLVideoElement) => {
    const event = (name: string) =>
      new Promise<void>((resolve, reject) => {
        video.addEventListener(name, () => resolve(), { once: true });
        video.addEventListener("error", () => reject(new Error(`code ${video.error?.code}`)), {
          once: true,
        });
        setTimeout(() => reject(new Error(`no ${name} in 30 s`)), 30_000);
      });
    try {
      if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
        video.preload = "auto";
        video.load();
        await event("loadedmetadata");
      }
      const seeked = event("seeked");
      video.currentTime = video.duration / 2;
      await seeked;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d") as CanvasRenderingContext2D;
      context.drawImage(video, 0, 0);
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let brightest = 0;
      for (let i = 0; i < data.length; i += 4 * 97) {
        brightest = Math.max(
          brightest,
          data[i] as number,
          data[i + 1] as number,
          data[i + 2] as number,
        );
      }
      return {
        width: video.videoWidth,
        height: video.videoHeight,
        at: video.currentTime,
        brightest,
        error: null,
      };
    } catch (error) {
      const width = video.videoWidth;
      return {
        width,
        height: video.videoHeight,
        at: video.currentTime,
        brightest: 0,
        error: (error as Error).message,
      };
    }
  });
}

/** Makes the edit through the window; what went wrong, if anything. */
async function makeEdit(): Promise<string[]> {
  // First run: the page asks for the Anthropic key while the analysis sets itself up.
  await page.getByRole("heading", { name: "Connect Claude" }).waitFor();
  await shot(page, "1-first-run");
  await page.getByPlaceholder("sk-ant-…").fill("sk-ant-smoke-test");
  await page.getByRole("button", { name: "Check and save" }).click();
  await page.getByRole("button", { name: /API key saved/ }).waitFor();

  const machine = await api<{ memory: number; asr: string }>("/api/setup");
  say(`${(machine.memory / 1024 ** 3).toFixed(0)} GB of memory: speech defaults to ${machine.asr}`);
  if ((await api<{ state: string }>("/api/setup")).state === "installing") {
    await page.getByText(/Downloading the analysis environment/).waitFor({ timeout: 300_000 });
    await shot(page, "2-setting-up");
  }
  await page
    .getByText("Setting up the analysis first")
    .waitFor({ state: "hidden", timeout: 1_800_000 });
  const setup = await api<{ state: string; error?: string }>("/api/setup");
  if (setup.state !== "ready") throw new Error(`The analysis did not set up: ${setup.error}`);
  say("the analysis is set up");

  // Cloud speech, with its key, so the edit runs on any runner's memory.
  await page.getByRole("button", { name: "OpenRouter", exact: true }).click();
  await page.getByRole("button", { name: "Add your OpenRouter key" }).click();
  await page.getByPlaceholder("sk-or-…").fill("sk-or-smoke-test");
  await page.getByRole("button", { name: "Check and save" }).click();
  await page.getByRole("button", { name: "Add your OpenRouter key" }).waitFor({ state: "hidden" });

  await page.locator("input[type=file][multiple]").setInputFiles(clip);
  await page.getByRole("button", { name: `${LENGTH} s`, exact: true }).click();
  await shot(page, "3-ready-to-edit");
  await page.getByRole("button", { name: `Make the ${LENGTH} s video` }).click();
  await page.getByRole("heading", { name: "Making your edit" }).waitFor({ timeout: 120_000 });
  const following = new AbortController();
  void follow((await api<{ id: string }>("/api/jobs/latest")).id, following.signal);
  try {
    await page
      .getByText(/^Downloading /)
      .first()
      .waitFor({ timeout: 120_000 });
    await shot(page, "4-editing");
  } catch {
    await shot(page, "4-editing");
  }
  const done = page.getByRole("heading", { name: "Your edit is ready" });
  const failed = page.getByRole("heading", { name: "The edit could not be finished" });
  await done.or(failed).waitFor({ timeout: 2_400_000 });
  clearInterval(watching);
  following.abort();
  await shot(page, "5-done");

  const job = await api<{
    id: string;
    status: string;
    error?: string;
    result?: { captions: boolean };
  }>("/api/jobs/latest");
  if (job.status !== "done") throw new Error(`The edit failed: ${job.error}`);
  const video = join(work, "edit.mp4");
  await writeFile(
    video,
    Buffer.from(await (await fetch(`${origin}/api/jobs/${job.id}/video`)).arrayBuffer()),
  );
  const { ffmpeg, run } = await import("../../../packages/engine/src/ffmpeg.ts");
  process.env.XDG_CACHE_HOME = join(work, "smoke-cache");
  const probe = await run(await ffmpeg(), [
    "-hide_banner",
    "-i",
    video,
    "-map",
    "0",
    "-c",
    "copy",
    "-f",
    "null",
    "-",
  ]);
  const [, h, m, s] = probe.stderr.match(/Duration: (\d+):(\d+):([\d.]+)/) ?? [];
  const seconds = Number(h) * 3600 + Number(m) * 60 + Number(s);
  say(
    `the edit is ${seconds.toFixed(2)} s, captions ${job.result?.captions ? "written" : "missing"}`,
  );
  // Where the page keeps the job's edit (apps/web/lib/jobs.ts): in the app's own cache.
  const projectPath = join(
    home.XDG_CACHE_HOME,
    "video-editor",
    "jobs",
    job.id,
    "out",
    "edit.project.json",
  );
  if (existsSync(projectPath)) {
    const project = JSON.parse(await readFile(projectPath, "utf8")) as {
      overlays?: { template: string; start: number; params: { text?: string } }[];
      graphics?: { layout: string; start: number }[];
    };
    const overlays = (project.overlays ?? []).map(
      (o) => `${o.template} "${o.params.text ?? ""}" at ${o.start}`,
    );
    say(`overlays in the edit: ${overlays.join(", ") || "none"}`);
    graphics = (project.graphics ?? []).length;
    say(`graphics in the edit: ${graphics}`);
    for (const line of graphicLines) say(`graphics: ${line}`);
  }
  const playing = await playInPage(page);
  await shot(page, "6-playing");
  say(
    `the window plays it: ${playing.width}x${playing.height} at ${playing.at.toFixed(1)} s, ` +
      `brightest channel ${playing.brightest}${playing.error ? `, error ${playing.error}` : ""}`,
  );
  say(`downloaded on first use: ${[...downloads].join(", ")}`);
  say(`asked Claude for: ${asked.join(", ")}; OpenRouter heard ${heard} chunks`);
  return [
    Math.abs(seconds - LENGTH) > LENGTH * 0.05 && `the edit is ${seconds} s, not ${LENGTH} s ± 5 %`,
    !job.result?.captions && "no captions",
    !asked.includes("plan") && "Claude was not asked for a plan",
    !asked.includes("graphics") && "Claude was not asked for the graphics",
    graphics === 0 &&
      `the edit has no graphic: ${graphicLines.filter((line) => line.startsWith("Left out")).join("; ") || "HyperFrames did not draw it"}`,
    heard === 0 && "OpenRouter heard nothing",
    ![...downloads].some((name) => name.startsWith("the analysis environment")) &&
      "the analysis environment's download was not shown",
    // A download quicker than the page is polled is not caught on screen; it still has to land
    // in the app's cache, which started empty.
    !downloads.has("FFmpeg") &&
      !fetched("ffmpeg-") &&
      "FFmpeg was neither shown downloading nor downloaded",
    !downloads.has("Chrome Headless Shell") &&
      !fetched("chrome") &&
      `Chrome Headless Shell was neither shown downloading nor downloaded; the cache holds: ${contents(join(home.XDG_CACHE_HOME, "video-editor"))}`,
    !downloads.has("ffprobe") &&
      !fetched("ffprobe-") &&
      "ffprobe was neither shown downloading nor downloaded",
    (playing.error || playing.width === 0 || playing.brightest < 32) &&
      "the window's player does not show the video",
  ].filter((problem): problem is string => typeof problem === "string");
}

const problems = await makeEdit().catch(async (error: Error) => {
  await shot(page, "failed").catch(() => {});
  return [error.message];
});

// Quitting stops everything the app started.
clearInterval(tracking);
for (const child of descendants(pid)) started.add(child);
await app.close();
await new Promise((done) => setTimeout(done, 2000));
const left = [...started].filter(alive);
if (left.length > 0) {
  const listing =
    process.platform === "win32"
      ? spawnSync(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            `Get-CimInstance Win32_Process | Where-Object { @(${left.join(",")}) -contains $_.ProcessId } | ForEach-Object { "$($_.ProcessId) (parent $($_.ParentProcessId)) $($_.CommandLine)" }`,
          ],
          { encoding: "utf8" },
        ).stdout
      : spawnSync("ps", ["-o", "pid=,command=", "-p", left.join(",")], {
          encoding: "utf8",
        }).stdout;
  // Whether they were only slow to go, or would have outlived the app.
  await new Promise((done) => setTimeout(done, 10_000));
  const later = left.filter(alive);
  problems.push(
    `still running after quitting:\n${listing}\n10 s later, ${later.length ? `still running: ${later.join(", ")}` : "all gone"}`,
  );
}
if (
  await fetch(origin).then(
    () => true,
    () => false,
  )
)
  problems.push("the server still answers");
say(`the app quit, and the ${started.size} processes it started with it`);
// The app's folders and caches, models among them, go too.
await rm(work, { recursive: true, force: true, maxRetries: 5 });

if (problems.length > 0) {
  console.error(`smoke: failed:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
say("passed");
// The stand-ins' keep-alive connections would otherwise hold the process open.
process.exit(0);
