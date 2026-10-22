// Plans the synthetic talk in ./talk.ts. The recorded tests replay a reply Claude gave for it
// (fixtures/talk-plan.json), so they need no key; the last test asks the real API and runs only
// with CLAUDE_TESTS=1 and a key (CONTRIBUTING.md).

import assert from "node:assert/strict";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  loadJson,
  type Overlay,
  type Project,
  validateProject,
  type Word,
} from "@video-editor/schema";
import { ffmpeg, run } from "../ffmpeg.ts";
import { makeSource } from "../fixtures.ts";
import { scaleAt } from "../framing.ts";
import { render } from "../render.ts";
import { fingerprintOf } from "../sources.ts";
import { scratch } from "../testing.ts";
import { anthropicClaude, type ClaudeRequest, recordedClaude } from "./claude.ts";
import { MARGIN } from "./place.ts";
import { fittedLength, MAX_PLAN_CALLS, PlanError, plan } from "./plan.ts";
import type { Decisions } from "./prompt.ts";
import { makeSong, makeTalk, talkWords } from "./talk.ts";

const T = 120_000;
const recorded = async (): Promise<Decisions> =>
  JSON.parse(await readFile(new URL("fixtures/talk-plan.json", import.meta.url), "utf8"))[0];

/** The text of a request's ith content block. */
function textOf(request: ClaudeRequest | undefined, i: number): string {
  const block = request?.content[i];
  return block?.type === "text" ? block.text : "";
}

/** The words each clip plays, joined. */
function spoken(project: Project, words: Word[]): string[] {
  return project.main.map((clip) =>
    words
      .filter((w) => w.start * T >= clip.in && w.end * T <= clip.out)
      .map((w) => w.text)
      .join(""),
  );
}

/** No clip starts or ends inside a word, or closer than MARGIN to one. */
function assertNoCutInWords(project: Project, words: Word[]) {
  for (const clip of project.main) {
    for (const edge of [clip.in, clip.out]) {
      for (const word of words) {
        assert.ok(
          edge <= (word.start - MARGIN) * T + 1 || edge >= (word.end + MARGIN) * T - 1,
          `cut at ${edge / T} s against ${word.text} at ${word.start}-${word.end}`,
        );
      }
    }
  }
}

test("a recorded plan becomes a project that validates, fits and cuts only between words", async (t) => {
  const dir = await scratch(t, "plan-");
  const index = await makeTalk(dir);
  const { claude, requests } = recordedClaude({ plan: [await recorded()] });
  const out = join(dir, "edit", "project.json");
  const edit = await plan({ inputs: [index], length: 15, aspect: "16:9", out, claude });

  const project = await loadJson(out, validateProject);
  assert.deepEqual(project, edit.project);
  const words = talkWords();
  const { fit } = project.plan ?? assert.fail("no plan");
  assert.ok(Math.abs(fit.duration - 15 * T) <= 0.05 * 15 * T, `${fit.duration / T} s`);
  assertNoCutInWords(project, words);
  // The filler before 大家好 and the false start are cut; 那個 in 那個工具 stays, a real word;
  // the 嗯 inside the sentence has pauses beside it and is cut too.
  const said = spoken(project, words).join("|");
  assert.ok(said.startsWith("大家好，"), said);
  assert.doesNotMatch(said, /剪輯，不對/);
  assert.match(said, /第一件事是自動剪輯。/);
  assert.match(said, /那個工具/);
  assert.match(said, /字幕，(\|)?字幕要用/);
  const kinds = new Set(project.plan?.dropped.map((d) => d.kind));
  for (const kind of ["filler", "mistake", "length"]) assert.ok(kinds.has(kind as never), kind);

  // Captions are the kept words, on the output timeline, line by line.
  const captions = project.captions?.lines ?? [];
  assert.equal(captions[0]?.text, "大家好\u3000歡迎收看");
  assert.ok(captions.every((line) => line.language === "zh-TW"));
  const english = captions.flatMap((line) => line.words ?? []).filter((w) => w.language === "en");
  assert.deepEqual(
    english.map((w) => w.text),
    ["video", "editor"],
  );
  assert.ok((project.plan?.emphasis ?? []).length > 0);
  // Line 2's emoji ends the caption that ends it, hidden until the switch shows it; line 3's,
  // with a skin tone, is left out.
  assert.deepEqual(
    captions.flatMap((line) => (line.emoji ? [[line.text.slice(-3), line.emoji]] : [])),
    [["三件事", "🎬"]],
  );
  assert.equal(project.captions?.emoji, undefined);
  for (const clip of project.main) assert.ok(clip.grade?.auto, "every clip is graded");
  // Landscape long-form loudness; the talk's index measured no voice, so it plays as recorded.
  assert.deepEqual(project.audio, { loudness: { integratedLufs: -16, truePeakDbtp: -1 } });

  // The transcript is cached ahead of the request, and the planner is Opus.
  const [request] = requests;
  assert.equal(request?.model, "claude-opus-5-5");
  assert.equal(request?.content[0]?.type === "text" && request.content[0].cache, true);
});

test("an economy edit is planned with Sonnet, from the same request", async (t) => {
  const dir = await scratch(t, "plan-economy-");
  const index = await makeTalk(dir);
  const best = recordedClaude({ plan: [await recorded()] });
  const economy = recordedClaude({ plan: [await recorded()] });
  const options = { inputs: [index], length: 15, aspect: "16:9" as const };
  await plan({ ...options, out: join(dir, "best", "project.json"), claude: best.claude });
  const edit = await plan({
    ...options,
    out: join(dir, "economy", "project.json"),
    claude: economy.claude,
    quality: "economy",
  });
  const [request] = economy.requests;
  assert.equal(request?.model, "claude-sonnet-5-5");
  assert.deepEqual({ ...request, model: "" }, { ...best.requests[0], model: "" });
  assert.equal(edit.project.plan?.model, "claude-sonnet-5-5");
});

test("Claude's effects become overlays timed on the speech, one at a time and only as allowed", async (t) => {
  const dir = await scratch(t, "plan-effects-");
  // Four takes of the talk, so a one-minute edit keeps the whole story and opens on a title.
  const ids = ["a", "b", "c", "d"];
  for (const id of ids) await makeTalk(dir, id);
  await makeSource(dir, {
    id: "cutaway",
    pattern: "smptebars",
    width: 160,
    height: 90,
    fps: 25,
    seconds: 6,
    sound: null,
  });
  const base = await recorded();
  const moved = ids.map((id) => movedTo(base, id));
  const emphasis = (line: number, text: string) =>
    ({ source: "a", line, text, reason: "A beat." }) as const;
  const decisions: Decisions = {
    ...base,
    segments: moved.flatMap((d) => d.segments.map((s) => ({ ...s, priority: 1 }))),
    cut_words: moved.flatMap((d) => d.cut_words),
    // B-roll over b's first line, where its speaker is named.
    broll: [{ broll: "cutaway", start: 0, end: 2, source: "b", line: 1, reason: "The tool." }],
    title: { text: "三件事", subtitle: "自動剪輯入門" },
    people: [
      // Not in the list: never shown.
      { name: "王小明", role: "", source: "a", line: 1 },
      // Waits for the title to leave.
      { name: "林語安", role: "主講人", source: "a", line: 1 },
      // Waits for the B-roll to leave, and shows without a role too long for the template.
      { name: "王大同", role: "很".repeat(30), source: "b", line: 1 },
    ],
    emphasis: [emphasis(2, "今天要講三件事"), emphasis(5, "繁體中文")],
  };
  const { claude, requests } = recordedClaude({ plan: [decisions] });
  const out = join(dir, "edit", "project.json");
  const names = ["林語安", "王大同", "video editor"];
  const instructions = "  Open with the demo.\nLeave out the pricing.  ";
  const edit = await plan({
    inputs: [dir],
    length: 60,
    aspect: "9:16",
    out,
    claude,
    names,
    instructions,
  });

  const request = requests[0] ?? assert.fail("no request");
  assert.deepEqual((request.schema.required as string[]).slice(-3), ["title", "people", "visuals"]);
  const asked = request.content[1]?.type === "text" ? request.content[1].text : "";
  assert.match(asked, /Give the video a title over its opening\./);
  assert.match(
    asked,
    /Names the user gave, of people and terms said in the footage: 林語安; 王大同; video editor\./,
  );
  // What the user asked, in their words, set apart from the request.
  assert.match(
    asked,
    /in their own words;.*\n<instructions>\nOpen with the demo\.\nLeave out the pricing\.\n<\/instructions>/,
  );

  const overlays = edit.project.overlays ?? [];
  assert.deepEqual(
    overlays.map((o) => [o.template, o.params]),
    [
      ["title", { text: "三件事", subtitle: "自動剪輯入門" }],
      ["lower-third", { name: "林語安", role: "主講人" }],
      ["lower-third", { name: "王大同" }],
    ],
  );
  const [title, name, second] = overlays as [Overlay, Overlay, Overlay];
  // The title opens on the first word; nothing overlaps; all within the edit, on the frame grid.
  const words = (edit.project.captions?.lines ?? []).flatMap((line) => line.words ?? []);
  assert.ok(Math.abs(title.start - (words[0]?.start ?? -1)) <= T / 25, `${title.start / T} s`);
  for (const [a, b] of [
    [title, name],
    [name, second],
  ] as const) {
    assert.ok(a.start + a.duration <= b.start, `${a.template} overlaps ${b.template}`);
  }
  const length = edit.project.plan?.fit.duration ?? 0;
  for (const o of overlays) {
    assert.ok(o.start % (T / 25) === 0 && o.start + o.duration <= length, JSON.stringify(o));
  }
  // The second name shows once the B-roll over its speaker has gone.
  const [cutaway] = edit.project.broll ?? [];
  assert.ok(cutaway, "B-roll placed");
  const covered = cutaway.start + cutaway.out - cutaway.in;
  assert.ok(second.start >= covered && second.start - covered <= T / 10, `${second.start / T} s`);

  // An edit under a minute is offered neither a title nor, without names, lower thirds, and a
  // title in the answer anyway is not shown.
  const unnamed = recordedClaude({ plan: [{ ...movedTo(base, "a"), title: decisions.title }] });
  const short = await plan({
    inputs: [join(dir, "a.index.json")],
    length: 15,
    aspect: "9:16",
    out,
    claude: unnamed.claude,
  });
  const required = (unnamed.requests[0] ?? assert.fail("no request")).schema.required as string[];
  assert.ok(!required.includes("people") && !required.includes("title"), String(required));
  assert.ok(!(short.project.overlays ?? []).some((o) => o.template === "title"));
});

test("a long edit marks each chapter as it starts, and a wipe hides the cut into each after the first", async (t) => {
  const dir = await scratch(t, "plan-chapters-");
  // Ten takes of the talk, about 20 s each once cut, of which a 150 s edit keeps the first seven
  // and some of the eighth: chapters of two or three takes run well over 30 s, and the eighth
  // does not.
  const ids = [..."abcdefghij"];
  for (const id of ids) await makeTalk(dir, id);
  const base = await recorded();
  const moved = ids.map((id) => movedTo(base, id));
  const chapter = (title: string, source: string, line = 1) => ({ title, source, line });
  const decisions: Decisions = {
    ...base,
    segments: moved.flatMap((d) => d.segments.map((s) => ({ ...s, priority: 1 }))),
    cut_words: moved.flatMap((d) => d.cut_words),
    emphasis: [],
    title: { text: "", subtitle: "" },
    chapters: [
      chapter("開場", "a"),
      // No such line or file: ignored.
      chapter("沒有這行", "b", 99),
      chapter("沒有這個檔", "zz"),
      chapter("自動剪輯", "c"),
      chapter("繁體字幕", "f"),
      // Its section runs under 30 s, so it joins the one before.
      chapter("結尾", "h"),
    ],
  };
  const { claude, requests } = recordedClaude({ plan: [decisions] });
  const out = join(dir, "edit", "project.json");
  const edit = await plan({ inputs: [dir], length: 150, aspect: "16:9", out, claude });

  const request = requests[0] ?? assert.fail("no request");
  assert.ok((request.schema.required as string[]).includes("chapters"));
  assert.match(textOf(request, 1), /Divide the video into chapters\./);
  assert.match(request.system, /- chapters, when the request asks for them:/);

  const { project } = edit;
  const overlays = project.overlays ?? [];
  assert.deepEqual(
    overlays.map((o) => [o.template, o.params]),
    [
      ["chapter", { title: "開場", index: 1, total: 3 }],
      ["wipe", {}],
      ["chapter", { title: "自動剪輯", index: 2, total: 3 }],
      ["wipe", {}],
      ["chapter", { title: "繁體字幕", index: 3, total: 3 }],
    ],
  );
  // Each marker starts on its chapter's first word, and each wipe is centred on the cut into
  // the take that opens its chapter.
  const words = (project.captions?.lines ?? []).flatMap((line) => line.words ?? []);
  const frame = T / 25;
  const cutInto = (source: string) => {
    const at = project.main.findIndex((clip) => clip.source === source);
    return project.main.slice(0, at).reduce((sum, clip) => sum + clip.out - clip.in, 0);
  };
  const [opening, , second, , third] = overlays as Overlay[];
  assert.ok(Math.abs((opening?.start ?? -1) - (words[0]?.start ?? 0)) <= frame);
  for (const [marker, source] of [
    [second, "c"],
    [third, "f"],
  ] as const) {
    const cut = cutInto(source);
    const first = words.find((w) => w.start >= cut) ?? assert.fail("no word after the cut");
    assert.ok(Math.abs((marker?.start ?? -1) - first.start) <= frame, `${marker?.start} s`);
    const wipe = overlays[overlays.indexOf(marker as Overlay) - 1] as Overlay;
    assert.ok(Math.abs(wipe.start + wipe.duration / 2 - cut) <= frame, `${wipe.start / T} s`);
  }
  // Nothing overlaps but a wipe with the marker after it.
  for (const [i, a] of overlays.entries()) {
    const b = overlays[i + 1];
    if (b && !(a.template === "wipe" && b.template === "chapter")) {
      assert.ok(a.start + a.duration <= b.start, `${a.template} overlaps ${b.template}`);
    }
  }

  // A name longer than the template allows is no chapter, so the others are numbered without
  // it; and the first chapter opens the video, with no wipe, wherever Claude put it.
  const renamed = recordedClaude({
    plan: [
      {
        ...decisions,
        chapters: [
          chapter("一".repeat(21), "a"),
          chapter("開場", "b"),
          chapter("自動剪輯", "c"),
          chapter("繁體字幕", "f"),
        ],
      },
    ],
  });
  const again = await plan({
    inputs: [dir],
    length: 150,
    aspect: "16:9",
    out,
    claude: renamed.claude,
  });
  const marked = again.project.overlays ?? [];
  assert.deepEqual(
    marked.map((o) => [o.template, o.params]),
    [
      ["chapter", { title: "開場", index: 1, total: 3 }],
      ["wipe", {}],
      ["chapter", { title: "自動剪輯", index: 2, total: 3 }],
      ["wipe", {}],
      ["chapter", { title: "繁體字幕", index: 3, total: 3 }],
    ],
  );
  assert.ok(Math.abs((marked[0]?.start ?? -1) - (words[0]?.start ?? 0)) <= frame);

  // An edit under two minutes is not asked for chapters, nor told of them, so its prompt is as
  // it was before chapters; chapters in the answer anyway are not shown.
  const unasked = recordedClaude({
    plan: [{ ...movedTo(base, "a"), chapters: decisions.chapters }],
  });
  const short = await plan({
    inputs: [join(dir, "a.index.json")],
    length: 15,
    aspect: "16:9",
    out,
    claude: unasked.claude,
  });
  const required = (unasked.requests[0] ?? assert.fail("no request")).schema.required as string[];
  assert.ok(!required.includes("chapters"), String(required));
  const told = unasked.requests[0];
  assert.doesNotMatch(`${told?.system}\n${textOf(told, 1)}`, /chapter/i);
  assert.deepEqual(short.project.overlays ?? [], []);
});

test("a planned edit renders with its captions burned in and as SubRip beside it", async (t) => {
  const dir = await scratch(t, "plan-render-");
  const index = await makeTalk(dir);
  const { claude } = recordedClaude({ plan: [await recorded()] });
  const out = join(dir, "edit", "project.json");
  const edit = await plan({ inputs: [index], length: 15, aspect: "9:16", out, claude });
  const result = await render(edit.path, join(dir, "edit", "out.mp4"));
  const srt = await readFile(result.captions ?? assert.fail("no SubRip"), "utf8");
  // Every kept word shows, in order, and nothing else.
  const shown = srt
    .trim()
    .split("\n\n")
    .flatMap((cue) => cue.split("\n").slice(2))
    .join("");
  const words = edit.project.captions?.lines.flatMap((line) => line.words ?? []) ?? [];
  assert.ok(words.length > 20, `${words.length} words`);
  assert.equal(shown.replace(/[ \u3000]/g, ""), words.map((word) => word.text).join(""));
});

test("a planned edit punches in at its jump cuts and pushes in on emphasis, under a look", async (t) => {
  const dir = await scratch(t, "plan-punch-");
  // 432 lines of footage edited at 360: a fifth more pixels than the output needs.
  const index = await makeTalk(dir, "talk", { width: 768, height: 432 });
  const { claude } = recordedClaude({ plan: [await recorded(), await recorded()] });
  const edit = await plan({
    inputs: [index],
    length: 15,
    aspect: "16:9",
    out: join(dir, "p.json"),
    claude,
  });
  const { main, output } = edit.project;
  assert.deepEqual([output.width, output.height], [640, 360]);
  // The talk is one shot, so every cut jumps, and each changes the framing by 8 % or more.
  assert.ok(main.length > 1);
  for (const [i, clip] of main.entries()) {
    const before = main[i - 1];
    if (!before) continue;
    const from = scaleAt(before.framing?.scale, before.out);
    const to = scaleAt(clip.framing?.scale, clip.in);
    assert.ok(Math.abs(Math.log(to / from)) >= Math.log(1.08) - 1e-9, `cut ${i}: ${from} to ${to}`);
    assert.ok(Math.max(from, to) <= 1.25, "no further than the punch-in");
  }
  // The clip each emphasis starts in pushes in.
  const pushed = main.filter((clip) => typeof clip.framing?.scale === "object");
  assert.ok(pushed.length > 0);
  for (const clip of main) {
    assert.deepEqual(clip.grade?.look, { id: "clean", intensity: 1 });
    assert.equal(clip.grade?.match, undefined, "one source has nothing to match");
  }
  const bare = await plan({
    inputs: [index],
    length: 15,
    aspect: "16:9",
    out: join(dir, "q.json"),
    claude,
    look: null,
  });
  assert.ok(bare.project.main.every((clip) => clip.grade?.look === undefined));
});

test("an edit that comes out short asks once more, then fails with the reason", async (t) => {
  const dir = await scratch(t, "plan-short-");
  const index = await makeTalk(dir);
  const decisions = await recorded();
  const thin = { ...decisions, segments: decisions.segments.slice(0, 1) };
  const { claude, requests } = recordedClaude({ plan: [thin, thin] });
  const names = ["林語安"];
  await assert.rejects(
    plan({
      inputs: [index],
      length: 15,
      aspect: "9:16",
      out: join(dir, "p.json"),
      claude,
      names,
      instructions: "Keep the joke.",
    }),
    // At the shortest length, the way out is more footage.
    (error: Error) =>
      error instanceof PlanError &&
      /short of 15 s.*Add footage with more speech/.test(error.message),
  );
  assert.equal(requests.length, MAX_PLAN_CALLS);
  assert.match(textOf(requests[1], 1), /short of the 15 s target/);
  // The second request asks for the same extras as the first.
  assert.match(
    textOf(requests[1], 1),
    /Names the user gave, of people and terms said in the footage: 林語安\./,
  );
  assert.match(textOf(requests[1], 1), /<instructions>\nKeep the joke\.\n<\/instructions>/);
});

test("B-roll from a file without speech covers the line it was placed over", async (t) => {
  const dir = await scratch(t, "plan-broll-");
  await makeTalk(dir);
  await makeSource(dir, {
    id: "cutaway",
    pattern: "smptebars",
    width: 160,
    height: 90,
    fps: 25,
    seconds: 6,
    sound: null,
  });
  const decisions = await recorded();
  const placed: Decisions = {
    ...decisions,
    broll: [
      { broll: "cutaway", start: 1, end: 4.5, source: "talk", line: 4, reason: "Show the tool." },
      { broll: "talk", start: 0, end: 3, source: "talk", line: 5, reason: "Has speech: refused." },
    ],
  };
  const { claude, requests } = recordedClaude({ plan: [placed] });
  const edit = await plan({
    // A folder stands for every index in it.
    inputs: [dir],
    length: 15,
    aspect: "16:9",
    out: join(dir, "p.json"),
    claude,
  });
  assert.match(textOf(requests[0], 0), /## cutaway \(6\.0 s, no speech: B-roll\)/);
  const broll = edit.project.broll ?? [];
  assert.equal(broll.length, 1);
  const [clip] = broll;
  assert.equal(clip?.source, "cutaway");
  assert.equal(clip?.in, T);
  assert.equal(((clip?.out ?? 0) - (clip?.in ?? 0)) / T, 3.48, "3.5 s, in whole frames");
  // It starts with line 4's first word on the output timeline: 那 of 那個工具.
  const line = edit.project.captions?.lines.find((l) => l.text.startsWith("那個工具"));
  assert.equal(clip?.start, line?.start);
  assert.ok(edit.project.sources.some((source) => source.id === "cutaway"));
});

test("line numbers the transcript does not have, and repeats, are ignored", async (t) => {
  const dir = await scratch(t, "plan-bad-");
  const index = await makeTalk(dir);
  const decisions = await recorded();
  const odd: Decisions = {
    ...decisions,
    segments: [
      { source: "nope", first: 1, last: 2, priority: 1, reason: "no such file" },
      ...decisions.segments,
      { source: "talk", first: 1, last: 99, priority: 1, reason: "a repeat" },
    ],
    fillers: [...decisions.fillers, "f99"],
  };
  const { claude } = recordedClaude({ plan: [odd] });
  const edit = await plan({
    inputs: [index],
    length: 15,
    aspect: "1:1",
    out: join(dir, "p.json"),
    claude,
  });
  assert.equal(edit.state.segments.length, decisions.segments.length);
  assert.equal(edit.project.output.width, edit.project.output.height);
  assert.equal(edit.project.audio.loudness.integratedLufs, -14);
});

/** The recorded plan with every reference to the talk moved to `source`. */
function movedTo(decisions: Decisions, source: string): Decisions {
  return JSON.parse(
    JSON.stringify(decisions).replaceAll('"source":"talk"', `"source":"${source}"`),
  );
}

test("files named in Chinese get ids a project accepts, and the planner reads their names", async (t) => {
  const dir = await scratch(t, "plan-names-");
  await makeTalk(dir, "訪談一");
  await makeTalk(dir, "訪談二");
  const { claude, requests } = recordedClaude({ plan: [movedTo(await recorded(), "file-1")] });
  const edit = await plan({
    inputs: [dir],
    length: 15,
    aspect: "16:9",
    out: join(dir, "p.json"),
    claude,
  });
  assert.deepEqual(
    edit.project.sources.map((source) => source.id),
    ["file-1", "file-2"],
  );
  assert.match(textOf(requests[0], 0), /^## file-1 \(訪談一, /m);
  assert.match(textOf(requests[0], 0), /^## file-2 \(訪談二, /m);
});

test("names repeated in one folder keep their extensions, and only repeats change", async (t) => {
  const dir = await scratch(t, "plan-stems-");
  // A video and its thumbnail, as cameras and phones save them.
  const index = await makeTalk(dir);
  const still = join(dir, "talk.png");
  await run(await ffmpeg(), [
    ...["-v", "error", "-f", "lavfi", "-i", "smptebars=s=320x180", "-frames:v", "1", still],
  ]);
  const thumbnail = recordedClaude({ plan: [movedTo(await recorded(), "talk.mp4")] });
  const edit = await plan({
    inputs: [index, { image: still }],
    length: 15,
    aspect: "16:9",
    out: join(dir, "p.json"),
    claude: thumbnail.claude,
  });
  assert.deepEqual(edit.project.sources.map((source) => source.id).sort(), [
    "talk.mp4",
    "talk.png",
  ]);
  assert.match(textOf(thumbnail.requests[0], 0), /^## talk\.png \(a still image/m);

  // Clips all named source.mp4, in folders of their own, take their folders' names; a file
  // whose name is its own keeps it.
  const corpus = join(dir, "corpus");
  for (const clip of ["a", "b"]) {
    await mkdir(join(corpus, clip), { recursive: true });
    await makeTalk(join(corpus, clip), "source");
  }
  await makeTalk(corpus, "intro");
  const clips = recordedClaude({ plan: [movedTo(await recorded(), "a")] });
  const named = await plan({
    inputs: [join(corpus, "a"), join(corpus, "b"), corpus],
    length: 15,
    aspect: "16:9",
    out: join(dir, "q.json"),
    claude: clips.claude,
  });
  assert.deepEqual(named.project.sources.map((source) => source.id).sort(), ["a", "b", "intro"]);
});

test("a file the edit leaves out is listed with why", async (t) => {
  const dir = await scratch(t, "plan-unused-");
  await makeTalk(dir, "take1");
  await makeTalk(dir, "take2");
  const decisions = movedTo(await recorded(), "take2");
  const reason = "An earlier run of the whole talk; take2 says it better.";
  decisions.removed = [{ source: "take1", first: 1, last: 99, kind: "retake", reason }];
  const { claude } = recordedClaude({ plan: [decisions] });
  const edit = await plan({
    inputs: [dir],
    length: 15,
    aspect: "16:9",
    out: join(dir, "p.json"),
    claude,
  });
  assert.ok(edit.project.main.every((clip) => clip.source === "take2"));
  assert.ok(edit.project.sources.some((source) => source.id === "take1"));
  const dropped = edit.project.plan?.dropped.filter((d) => d.source === "take1");
  assert.deepEqual(dropped, [{ source: "take1", in: 0, out: 25 * T, kind: "retake", reason }]);
});

test("an index apart from its footage fails before any request", async (t) => {
  const dir = await scratch(t, "plan-apart-");
  const index = await makeTalk(dir);
  const apart = join(dir, "indexes", "talk.index.json");
  await mkdir(join(dir, "indexes"));
  await rename(index, apart);
  const { claude, requests } = recordedClaude({ plan: [await recorded()] });
  await assert.rejects(
    plan({ inputs: [apart], length: 15, aspect: "16:9", out: join(dir, "p.json"), claude }),
    (error: Error) =>
      error instanceof PlanError && /talk\.mp4 is not next to it/.test(error.message),
  );
  assert.equal(requests.length, 0);
});

test("an index kept apart from its footage plans when the input names both", async (t) => {
  const dir = await scratch(t, "plan-pair-");
  const index = await makeTalk(dir);
  const apart = join(dir, "indexes", "abc123.index.json");
  await mkdir(join(dir, "indexes"));
  await rename(index, apart);
  const { claude } = recordedClaude({ plan: [await recorded()] });
  const out = join(dir, "edit", "p.json");
  const edit = await plan({
    inputs: [{ index: apart, source: join(dir, "talk.mp4") }],
    length: 15,
    aspect: "16:9",
    out,
    claude,
  });
  // The id comes from the footage's name, and the project points at both files.
  assert.deepEqual(edit.project.sources[0], {
    id: "talk",
    kind: "video",
    path: "../talk.mp4",
    index: "../indexes/abc123.index.json",
    fingerprint: edit.project.sources[0]?.fingerprint,
  });
});

test("a length the footage cannot reach fails before any request, saying how long it can be", async (t) => {
  const dir = await scratch(t, "plan-long-");
  const index = await makeTalk(dir);
  const { claude, requests } = recordedClaude({ plan: [await recorded()] });
  await assert.rejects(
    plan({ inputs: [index], length: 60, aspect: "16:9", out: join(dir, "p.json"), claude }),
    (error: Error) => {
      const longest = Number(error.message.match(/at most (\d+) s/)?.[1]);
      // The talk's 8 sentences last about 22 s from the first word to the last.
      return error instanceof PlanError && longest > 20 && longest < 26;
    },
  );
  assert.equal(requests.length, 0);
});

test("a still image is offered as B-roll and shows from its start for as long as asked", async (t) => {
  const dir = await scratch(t, "plan-still-");
  const index = await makeTalk(dir);
  const still = join(dir, "logo.png");
  await run(await ffmpeg(), [
    ...["-v", "error", "-f", "lavfi", "-i", "smptebars=s=320x180", "-frames:v", "1", still],
  ]);
  const placed: Decisions = {
    ...(await recorded()),
    broll: [{ broll: "logo", start: 5, end: 7.5, source: "talk", line: 4, reason: "The logo." }],
  };
  const { claude, requests } = recordedClaude({ plan: [placed] });
  const edit = await plan({
    inputs: [index, { image: still }],
    length: 15,
    aspect: "16:9",
    out: join(dir, "p.json"),
    claude,
  });
  assert.match(textOf(requests[0], 0), /^## logo \(a still image: B-roll for up to 8 s\)$/m);
  const [clip] = edit.project.broll ?? [];
  assert.equal(clip?.source, "logo");
  assert.equal(clip?.in, 0);
  assert.equal(((clip?.out ?? 0) - (clip?.in ?? 0)) / T, 2.48, "2.5 s, in whole frames");
  const source = edit.project.sources.find((s) => s.id === "logo");
  assert.equal(source?.kind, "image");
  assert.ok(source && !("index" in source), "an image has no media index");
  assert.ok(clip?.grade?.auto, "the still is graded too");
  // Stills set no output size: the 160x90 talk renders at the smallest size.
  assert.equal(edit.project.output.height, 360);
});

test("footage under 24 fps is edited at 30 fps, every cut still on its frames", async (t) => {
  const dir = await scratch(t, "plan-slow-");
  const index = await makeTalk(dir);
  const media = JSON.parse(await readFile(index, "utf8"));
  media.source.video.fps = 10;
  await writeFile(index, JSON.stringify(media));
  const { claude } = recordedClaude({ plan: [await recorded()] });
  const edit = await plan({
    inputs: [index],
    length: 15,
    aspect: "16:9",
    out: join(dir, "p.json"),
    claude,
  });
  assert.deepEqual(edit.project.output.fps, { num: 30, den: 1 });
  for (const clip of edit.project.main) {
    assert.equal(clip.in % (T / 10), 0, `${clip.in / T} s is not on a 10 fps frame`);
    assert.equal((clip.out - clip.in) % (T / 30), 0, "whole output frames");
  }
  assertNoCutInWords(edit.project, talkWords());
});

test("each clip is framed on the face the index found, in the output's shape", async (t) => {
  const dir = await scratch(t, "plan-framed-");
  const index = await makeTalk(dir);
  const media = JSON.parse(await readFile(index, "utf8"));
  const end = media.source.duration;
  const boxes = Array.from({ length: Math.floor(end * 5) }, (_, k) => ({
    t: k / 5,
    ...{ x: 0.17, y: 0.2, w: 0.06, h: 0.11 },
  }));
  const face = { id: 0, boxes };
  media.framing = {
    fps: 5,
    shots: [{ start: 0, end, layout: "talking_head", faces: [face], speakers: [] }],
  };
  await writeFile(index, JSON.stringify(media));
  const edit = async (aspect: "9:16" | "16:9") => {
    const { claude } = recordedClaude({ plan: [await recorded()] });
    const out = join(dir, `${aspect.replace(":", "x")}.json`);
    return (await plan({ inputs: [index], length: 15, aspect, out, claude })).project;
  };
  const portrait = await edit("9:16");
  assert.ok(portrait.main.length > 0);
  for (const clip of portrait.main) {
    const crop = clip.framing?.crop;
    assert.ok(crop?.type === "static", JSON.stringify(clip.framing));
    assert.ok(Math.abs(crop.rect.x + crop.rect.w / 2 - 0.2) < 1e-3, JSON.stringify(crop.rect));
  }
  // The footage already has the shape of a 16:9 edit: no crop, only punch-ins at its jump cuts.
  assert.ok((await edit("16:9")).main.every((clip) => clip.framing?.crop === undefined));
});

/** A 40 s track at 120 BPM in two sections, its music index written beside it as vework
 * analyze-music would, and the talk's index given the loudness that sets the music's level. */
async function withMusic(dir: string, talkIndex: string): Promise<string> {
  const song = await makeSong(dir);
  const media = JSON.parse(await readFile(talkIndex, "utf8"));
  media.loudness = { momentary: [], short_term: Array.from({ length: 30 }, () => -20) };
  await writeFile(talkIndex, JSON.stringify(media));
  return song;
}

test("music Claude picks for the content plays under the whole edit, with its licence", async (t) => {
  const dir = await scratch(t, "plan-music-");
  const index = await makeTalk(dir);
  const song = await withMusic(dir, index);
  await makeSource(dir, {
    id: "cutaway",
    pattern: "smptebars",
    width: 160,
    height: 90,
    fps: 25,
    seconds: 6,
    sound: null,
  });
  const decisions: Decisions = {
    ...(await recorded()),
    broll: [{ broll: "cutaway", start: 1, end: 4.5, source: "talk", line: 4, reason: "The tool." }],
    music: { track: "music-song", section: 2, reason: "An upbeat talk." },
  };
  const { claude, requests } = recordedClaude({ plan: [decisions] });
  const out = join(dir, "edit", "project.json");
  await plan({ inputs: [dir], music: [song], length: 15, aspect: "16:9", out, claude });

  assert.match(
    textOf(requests[0], 1),
    /^music-song: song\.wav, 38\.5 s, 120 BPM, licence CC BY 4\.0\. Sections: 1\) 0\.0-16\.3 s, -24 LUFS; 2\) 16\.3-38\.5 s, -15 LUFS$/m,
  );
  assert.ok((requests[0]?.schema.required as string[] | undefined)?.includes("music"));
  const project = await loadJson(out, validateProject);
  const music = project.audio.music ?? [];
  assert.ok(music.length > 0);
  const length = (project.plan?.fit.duration ?? 0) / T;
  const last = music.at(-1);
  assert.ok(
    last && Math.abs((last.start + last.out - last.in) / T - length) < 1e-3,
    "ends with the edit",
  );
  assert.equal(last?.out, 38.5 * T, "on the track's own ending");
  for (const track of music) {
    assert.equal(track.source, "music-song");
    assert.deepEqual(track.license, { name: "CC BY 4.0", attribution: "Song by Someone" });
    // -20 LUFS speech, music at -15: 6 LU under the speech in its pauses, 18 under it in speech.
    assert.equal(track.gainDb, -11);
    assert.deepEqual(track.ducking, { depthDb: -12, attackMs: 250, releaseMs: 750 });
  }
  const source = project.sources.find((s) => s.id === "music-song");
  assert.deepEqual(
    [source?.kind, source?.path, source?.index],
    ["audio", "../song.wav", "../song.music.json"],
  );
  assert.match(project.plan?.rationale ?? "", /\n\nMusic: An upbeat talk\.$/);

  // The B-roll's cuts need not fall between words: its start moves to a beat within 150 ms of
  // its line, and its end to the last beat its length allows, both on the 25 fps grid.
  const [clip] = project.broll ?? [];
  assert.ok(clip);
  const beats = music.flatMap((track) =>
    Array.from({ length: 76 }, (_, i) => 0.25 + i * 0.5)
      .filter((b) => b * T >= track.in && b * T < track.out)
      .map((b) => track.start / T + b - track.in / T),
  );
  const fromBeat = (ticks: number) => Math.min(...beats.map((b) => Math.abs(b - ticks / T)));
  const line = project.captions?.lines.find((l) => l.text.startsWith("那個工具"));
  const lineStart = line?.start ?? 0;
  const expected = fromBeat(lineStart) <= 0.15 ? 0 : fromBeat(lineStart);
  assert.ok(Math.abs(fromBeat(clip.start) - expected) <= 0.02, `start ${clip.start / T} s`);
  const end = clip.start + clip.out - clip.in;
  assert.ok(fromBeat(end) <= 0.02, `end ${end / T} s is ${fromBeat(end)} s from a beat`);
  for (const edge of [clip.start, end]) assert.equal(edge % (T / 25), 0, "on a frame");
});

test("a library track's audio arrives once Claude picks it, and only then", async (t) => {
  const dir = await scratch(t, "plan-library-");
  const index = await makeTalk(dir);
  const song = await withMusic(dir, index);
  // The audio waits outside, as a library track's waits to download.
  const away = join(dir, "away.wav");
  await rename(join(dir, "song.wav"), away);
  const fingerprint = await fingerprintOf(away);
  for (const track of ["music-song", ""]) {
    let fetched = 0;
    const source = join(dir, "library", "song.wav");
    const input = {
      index: song,
      source,
      fingerprint,
      about: '"Song" by Someone, upbeat',
      fetch: async () => {
        fetched++;
        await mkdir(join(dir, "library"), { recursive: true });
        await copyFile(away, source);
      },
    };
    const decisions = { ...(await recorded()), music: { track, section: 1, reason: "-" } };
    const { claude, requests } = recordedClaude({ plan: [decisions] });
    const out = join(dir, `${track || "none"}.json`);
    const edit = await plan({
      inputs: [index],
      music: [input],
      length: 15,
      aspect: "16:9",
      out,
      claude,
    });
    assert.match(textOf(requests[0], 1), /^Music from the built-in library/m);
    assert.match(textOf(requests[0], 1), /^music-song: "Song" by Someone, upbeat, 38\.5 s/m);
    assert.equal(fetched, track ? 1 : 0, track || "none");
    assert.equal((edit.project.audio.music?.length ?? 0) > 0, Boolean(track));
    await rm(join(dir, "library"), { recursive: true, force: true });
  }
});

test("a track Claude names that was not offered, or none, plays no music", async (t) => {
  const dir = await scratch(t, "plan-nomusic-");
  const index = await makeTalk(dir);
  const song = await withMusic(dir, index);
  for (const track of ["music-other", ""]) {
    const decisions = { ...(await recorded()), music: { track, section: 1, reason: "-" } };
    const { claude } = recordedClaude({ plan: [decisions] });
    const out = join(dir, `${track || "none"}.json`);
    const edit = await plan({
      inputs: [index],
      music: [song],
      length: 15,
      aspect: "16:9",
      out,
      claude,
    });
    assert.equal(edit.project.audio.music, undefined);
    assert.ok(edit.project.sources.every((s) => s.kind === "video"));
  }
});

test("plans the synthetic talk with the real API", {
  skip: !process.env.CLAUDE_TESTS,
}, async (t) => {
  const dir = await scratch(t, "plan-live-");
  const index = await makeTalk(dir);
  const edit = await plan({
    inputs: [index],
    length: 15,
    aspect: "16:9",
    out: join(dir, "p.json"),
    claude: anthropicClaude(),
  });
  const said = spoken(edit.project, talkWords()).join("|");
  assert.doesNotMatch(said, /剪輯，不對/, "the false start is cut");
  assert.match(said, /第一件事是自動剪輯/, "the retake is kept");
  assertNoCutInWords(edit.project, talkWords());
});

test("a short is fitted to what its plan reaches only when that is inside its range", () => {
  // The length it reached, to the second, when it is at least the range's shortest.
  assert.equal(fittedLength(46.7, 30), 47);
  assert.equal(fittedLength(30.2, 30), 30);
  assert.equal(fittedLength(30, 30), 30);
  // Rounding never lets one under the range in: 29.5 s is short of a 30 s floor.
  assert.equal(fittedLength(29.5, 30), null);
  assert.equal(fittedLength(29.99, 30), null);
});
