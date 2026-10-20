import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { GRAPHIC_LAYOUTS, templateIds } from "@video-editor/effects";
import { removables } from "@video-editor/engine/revise";
import type { Project } from "@video-editor/schema";
import { GRAPHIC_LAYOUTS as LAYOUTS, SETUP_DOWNLOAD } from "./en.ts";
import { en, MESSAGES } from "./messages.ts";
import { downloadName, overlayLabel, progressText } from "./program.ts";

const zh = MESSAGES["zh-TW"];
const repo = fileURLToPath(new URL("../../../../", import.meta.url));

/** One of every progress line the edit's programs write, with made-up numbers and names. */
const SAID = [
  // vework, as the engine passes its steps on (edit/analyze.ts).
  "Probing",
  "Detecting shots",
  "Detecting shots 40%",
  "Finding speech",
  "Measuring loudness",
  "Measuring loudness and sections",
  "Finding audio events",
  "Finding faces",
  "Removing noise from speech",
  "Transcribing 3/12",
  "Transcribing 3/12 (US$0.0123 so far)",
  "Transcribed on OpenRouter for US$0.0400 (US$0.00067 per source minute)",
  "Correcting 4 chunks with claude-sonnet-4-5",
  "Correcting 4 chunks with claude-sonnet-4-5 in a Message Batch",
  "Correction batch msgbatch_01: 3/4 done",
  "Aligning 7/12",
  "Decoding",
  "Finding beats with beat_this final0",
  "Downloading Qwen/Qwen3-ASR-1.7B-hf",
  // The edit.
  "Downloading FFmpeg, the first time it is used",
  "Checking that Claude can plan the edit",
  "Reading the file",
  "Reading 3 files",
  "Analysed before",
  // The plan and its review.
  "Planning a short edit with claude-opus-4-1",
  "Planning a long edit with claude-opus-4-1",
  "claude-opus-4-1 planned the edit ($0.21)",
  "Sourced 4 of 5 visuals",
  "claude-opus-4-1 wrote 12 graphics ($0.21)",
  "Left out the panel graphic at 12.40 s: too close to the graphic before",
  "Left out a label graphic: the words it lands on were cut",
  'Left out a graphic on words the edit does not say: "三十歲"',
  "Kept 9 of 12 graphics",
  "Wrote no graphics for 0.00–60.00 s: no clip matched",
  "Found 2 of 3 things to point at with claude-sonnet-4-5 (3 requests, $0.01)",
  "Found 2 of 3 things to point at with claude-sonnet-4-5 (all cached)",
  "The edit lasts 12.3 s; asking for more material",
  "Left out the stock visual on line 12: no clip matched",
  "The plan's visuals are not JSON; the edit has none",
  "The plan's visuals are not a list; the edit has none",
  'Left out a visual the plan gave in another shape: {"kind":"gif"}',
  "Left out a visual on talk-a line 4: the page did not load",
  "Measuring the colour of 4 clips",
  "Left the colour of talk-b as it is: too dark to match",
  "Matched the colour of talk-b to talk-a",
  "Review 1: checking 12 cuts with claude-sonnet-4-5",
  "Review 1: 12 cuts checked, 2 judged by claude-opus-4-1 ($0.03)",
  "Review 2: fixing cuts and fitting again",
  // The render and its effects.
  "Checking sources",
  "Mixing sound 3/10",
  "Mixing music",
  "Rendering 3/10",
  "Finished",
  "Rendering effect 2/5",
  "Rendered 5 effects",
  // The page's own server.
  "Preparing the changes",
  "Planning again",
  "Starting the render",
];

/** Text from the programs that the page passes on as it is: names, numbers and reasons. */
const KEPT =
  /OpenRouter|Claude|Qwen\/[\w.-]+|claude-[\w.-]+|beat_this|final0|FFmpeg|Message Batch|msgbatch_01|talk-[ab]|US\$[\d.]+|\$[\d.]+|no clip matched|the page did not load|too dark to match|too close to the graphic before|the words it lands on were cut|\{"kind":"gif"\}/g;

test("every progress line is said in Chinese, and as written in English", () => {
  for (const said of SAID) {
    assert.equal(progressText(said, en), said, said);
    const chinese = progressText(said, zh);
    assert.match(chinese, /\p{Script=Han}/u, said);
    assert.doesNotMatch(chinese.replace(KEPT, ""), /[A-Za-z]{2,}/, `${said} → ${chinese}`);
  }
  // One the page cannot read is shown as written.
  assert.equal(progressText("Doing something new", zh), "Doing something new");
  assert.equal(
    progressText("Downloading Qwen/Qwen3-ASR-1.7B-hf", zh),
    "正在下載語音模型（Qwen/Qwen3-ASR-1.7B-hf）",
  );
  assert.equal(progressText("Removing noise from speech", zh), "語音降噪中");
  assert.equal(progressText("Rendering 3/10", zh), "輸出片段中 3/10");
});

/** The literals in `source` from the opening quote at `at`: its text, with each `${…}` or `{…}`
 * part left out, as the pieces between them. */
function literal(source: string, at: number, python: boolean): { pieces: string[]; end: number } {
  const quote = source[at] as string;
  const pieces = [""];
  let i = at + 1;
  while (i < source.length && source[i] !== quote) {
    const opens = python ? source[i] === "{" : source.startsWith("${", i);
    if (quote !== "'" && (python || quote === "`") && opens) {
      // Skip the expression, with any strings inside it.
      let depth = 0;
      for (i += python ? 0 : 1; i < source.length; i++) {
        const c = source[i] as string;
        if (c === '"' || c === "'" || c === "`") i = literal(source, i, python).end;
        else if (c === "{") depth += 1;
        else if (c === "}" && --depth === 0) break;
      }
      pieces.push("");
    } else {
      if (source[i] === "\\") i += 1;
      pieces.push(`${pieces.pop()}${source[i]}`);
    }
    i += 1;
  }
  return { pieces: pieces.filter(Boolean), end: i };
}

/** The progress lines a file writes: each string given to `report`, `progress`, `onProblem` or
 * `send`, or set as a `message`, that reads as a sentence, as the pieces around its values. */
function written(path: string): string[][] {
  const source = readFileSync(join(repo, path), "utf8");
  const python = path.endsWith(".py");
  const found: string[][] = [];
  const calls = python
    ? /\bprogress\(\s*f?(?=["'])/g
    : /\b(?:report|progress|onProblem|send)\(|\bmessage(?::|\s*=)\s*/g;
  for (const call of source.matchAll(calls)) {
    let at = (call.index ?? 0) + call[0].length;
    // The call's own arguments, up to its closing parenthesis.
    let depth = 1;
    const pieces: string[] = [];
    while (at < source.length && depth > 0) {
      const c = source[at] as string;
      if (c === '"' || c === "'" || c === "`") {
        const { pieces: parts, end } = literal(source, at, python);
        // A name or a type beside a message is not one.
        const named = /\b(?:name|type)\s*:\s*$/.test(source.slice(at - 12, at));
        // Python joins the literals of one argument; TypeScript's are each a message or not.
        if (python) pieces.push(...parts);
        else if (
          !named &&
          (/^[A-Z]/.test(parts.join(" ")) || /[a-z] [a-z]/.test(parts.join(" ")))
        ) {
          found.push(parts);
        }
        at = end + 1;
        continue;
      }
      if (c === "(" || c === "{" || c === "[") depth += 1;
      if (c === ")" || c === "}" || c === "]") depth -= 1;
      // A `message` set to a string ends with its line.
      if (!call[0].startsWith("message") || c !== "\n") at += 1;
      else break;
      if (python && c === "f") continue;
    }
    if (python && pieces.length > 0) {
      const first = pieces[0] as string;
      pieces[0] = first.charAt(0).toUpperCase() + first.slice(1);
      found.push(pieces);
    }
  }
  return found;
}

/** The done line's message, which the page never shows. */
const UNSHOWN = /^Finished: /;

test("every progress line the engine, the effects, vework and the server write is listed", () => {
  const worker = join("worker", "src", "vework");
  const files = [
    "packages/engine/src/edit/edit.ts",
    "packages/engine/src/edit/analyze.ts",
    "packages/engine/src/plan/plan.ts",
    "packages/engine/src/plan/review.ts",
    "packages/engine/src/plan/visuals.ts",
    "packages/engine/src/plan/graphics.ts",
    "packages/engine/src/render.ts",
    "packages/effects/src/worker.ts",
    "apps/web/lib/jobs.ts",
    ...readdirSync(join(repo, worker))
      .filter((name) => name.endsWith(".py"))
      .map((name) => join(worker, name)),
  ];
  let lines = 0;
  for (const file of files) {
    for (const pieces of written(file)) {
      if (UNSHOWN.test(pieces[0] ?? "")) continue;
      lines += 1;
      const listed = SAID.some((said) => {
        let from = 0;
        return pieces.every((piece) => {
          const at = said.indexOf(piece, from);
          from = at + piece.length;
          return at >= 0;
        });
      });
      assert.ok(listed, `${file} writes “${pieces.join("…")}”, which SAID does not list`);
    }
  }
  // The scan found the lines at all.
  assert.ok(lines > 40, `only ${lines} lines found`);
});

test("what downloads is named by what it is for in Chinese", () => {
  for (const [name, said] of [
    ["Qwen/Qwen3-ASR-0.6B-hf", "語音模型（Qwen/Qwen3-ASR-0.6B-hf）"],
    ["Qwen/Qwen3-ForcedAligner-0.6B-hf", "字詞對齊模型（Qwen/Qwen3-ForcedAligner-0.6B-hf）"],
    ["mispeech/ced-base", "音訊事件模型（mispeech/ced-base）"],
    ["DeepFilterNet3", "語音降噪模型（DeepFilterNet3）"],
    ["Beat This! final0", "節拍模型（Beat This! final0）"],
    ["ffprobe", "ffprobe"],
    [SETUP_DOWNLOAD, "分析環境（Python、PyTorch 與分析程式）"],
    ["FFmpeg", "FFmpeg"],
    ["Chrome Headless Shell", "Chrome Headless Shell"],
  ]) {
    assert.equal(downloadName(name as string, zh), said);
    assert.equal(downloadName(name as string, en), name);
  }
});

test("every overlay, graphic and B-roll label says its kind in Chinese", () => {
  assert.deepEqual([...LAYOUTS], [...GRAPHIC_LAYOUTS]);
  for (const id of templateIds) assert.ok(zh.overlays.templates[id], id);
  for (const id of GRAPHIC_LAYOUTS) assert.ok(zh.overlays.layouts[id], id);
  const at = { start: 0, duration: 120_000 };
  const project = {
    sources: [{ id: "screen", kind: "video", path: "footage/screen.mp4" }],
    main: [],
    overlays: [
      ...templateIds.map((template) => ({ ...at, template, params: {} })),
      { ...at, template: "lower-third", params: { name: "王小明" } },
      { ...at, template: "title", params: { text: "Claude" } },
    ],
    graphics: [
      ...GRAPHIC_LAYOUTS.map((layout) => ({ ...at, layout, html: "", css: "" })),
      { ...at, layout: "full", html: '<div class="ff-stage"></div><b>營收</b>', css: "" },
    ],
    broll: [{ source: "screen", in: 0, out: 120_000, start: 0 }],
  } as unknown as Project;
  const labels = removables(project).map((item) => item.label);
  assert.ok(labels.length === templateIds.length + GRAPHIC_LAYOUTS.length + 4);
  for (const label of labels) {
    assert.equal(overlayLabel(label, en), label);
    const chinese = overlayLabel(label, zh);
    assert.doesNotMatch(chinese.replace(/B-roll|screen\.mp4|Claude/g, ""), /[A-Za-z]{2,}/, label);
  }
  assert.ok(labels.map((label) => overlayLabel(label, zh)).includes("人名條：王小明"));
  assert.ok(labels.map((label) => overlayLabel(label, zh)).includes("標題：Claude"));
  assert.ok(labels.map((label) => overlayLabel(label, zh)).includes("圖卡（滿版）：營收"));
  assert.ok(labels.map((label) => overlayLabel(label, zh)).includes("B-roll：screen.mp4"));
});
