// Several shorts from one long video (`pnpm edit --shorts`), and an edit of one stretch of a video
// (`--within`), on the synthetic talk said over and over, with a stand-in for vework and Claude.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  loadJson,
  type Progress,
  secondsToTicks,
  validateProject,
  validateShorts,
} from "@video-editor/schema";
import type { Claude, ClaudeRequest } from "../plan/claude.ts";
import type { CutVerdict, Decisions } from "../plan/prompt.ts";
import { makeTalk } from "../plan/talk.ts";
import { scratch } from "../testing.ts";
import type { Worker } from "./analyze.ts";
import { edit, editShorts, type ShortsOptions } from "./edit.ts";
import { EditError } from "./error.ts";

const vework: Worker = {
  command: [process.execPath, fileURLToPath(new URL("fixtures/vework.ts", import.meta.url))],
  version: "test",
};

/** Lines in each saying of the talk. */
const LINES = 7;

const recorded = async (): Promise<Decisions> =>
  JSON.parse(
    await readFile(new URL("../plan/fixtures/talk-plan.json", import.meta.url), "utf8"),
  )[0];

/** A moment of the `n`th saying of the talk, counted from 0. */
const saying = (n: number, title: string, length = 15) => ({
  source: "talk",
  first: 1 + n * LINES,
  last: (n + 1) * LINES,
  length,
  title,
  description: `${title}, said once more.`,
  hashtags: ["#talk", "editing", "#two words", "#talk"],
});

const text = (request: ClaudeRequest) =>
  request.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");

/**
 * Claude finding `moments`, then planning each short as recorded for the talk, moved to the lines
 * of the saying it is given; a short titled "Too thin" is planned from one line, too little for
 * its length. Every request costs `dollars` by its purpose.
 */
function claudeFor(moments: unknown[], dollars: Partial<Record<string, number>> = {}) {
  const requests: ClaudeRequest[] = [];
  let thin = false;
  const claude: Claude = async (request) => {
    requests.push(request);
    let json: unknown;
    if (request.purpose === "find") json = { moments };
    else if (request.purpose === "plan") {
      const all = text(request);
      if (all.includes("This short is about:"))
        thin = all.includes("This short is about: Too thin");
      const first = Number(all.match(/^Lines:\n(\d+) /m)?.[1] ?? 1) - 1;
      const filler = Number(all.match(/⟨f(\d+) /)?.[1] ?? 1) - 1;
      const plan = await recorded();
      const at = <T extends { first: number; last: number }>(range: T) => ({
        ...range,
        first: range.first + first,
        last: range.last + first,
      });
      json = {
        ...plan,
        segments: (thin ? plan.segments.slice(0, 1) : plan.segments).map(at),
        fillers: plan.fillers.map((id) => `f${Number(id.slice(1)) + filler}`),
        cut_words: plan.cut_words.map((cut) => ({ ...cut, line: cut.line + first })),
        emphasis: [],
      };
    } else if (request.purpose === "graphics") json = { graphics: [] };
    else {
      const fine: CutVerdict = { problem: "none", fix: "none", confidence: 0.9, reason: "Clean." };
      json = fine;
    }
    const usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
    return {
      json,
      usage: {
        purpose: request.purpose,
        model: request.model,
        ...usage,
        dollars: dollars[request.purpose] ?? 0.01,
      },
    };
  };
  return { claude, requests };
}

/** The talk said 16 times, about 6.5 minutes: room for 3 moments. */
async function longTalk(dir: string) {
  const folder = join(dir, "footage");
  await mkdir(folder);
  await makeTalk(folder, "talk", undefined, 16);
  process.env.FAKE_VEWORK_LOG = join(dir, "vework.jsonl");
  return folder;
}

test("the best moments become shorts, each from its own stretch, listed as each is done", async (t) => {
  const dir = await scratch(t, "shorts-");
  const folder = await longTalk(dir);
  const lines: Progress[] = [];
  const logs: string[] = [];
  const { claude, requests } = claudeFor([
    saying(5, "The fifth time"),
    // Shares lines with the one before, so it is not a short of its own.
    { ...saying(5, "Overlapping"), first: 4 + 5 * LINES, last: 3 + 6 * LINES },
    saying(2, "Too thin"),
    // One line, under the shortest a short may be with every word kept.
    { ...saying(11, "One line"), last: 1 + 11 * LINES },
    // One saying holds well under 30 s of speech: after both requests it is fitted to what it
    // reaches, within the range.
    saying(7, "Fitted to what it reaches", 30),
    // Past the most moments 6.5 minutes of footage gives.
    saying(12, "One too many"),
  ]);
  const options: ShortsOptions = {
    inputs: [folder],
    count: 5,
    range: [15, 30],
    aspect: "9:16",
    out: join(dir, "shorts"),
    claude,
    worker: vework,
    cache: join(dir, "cache"),
    visuals: "minimal",
    onProgress: (line) => lines.push(line),
    onLog: (line) => logs.push(line),
  };
  const result = await editShorts(options);

  // Two shorts: the overlapping moment, the one line and the one past the most were never made,
  // and the thin one reached under the range and was left out. Folders count the shorts made,
  // best first.
  const shorts = await loadJson(join(dir, "shorts", "shorts.json"), validateShorts);
  assert.deepEqual(shorts, result.shorts);
  assert.deepEqual(
    shorts.shorts.map((short) => [short.folder, short.title]),
    [
      ["01", "The fifth time"],
      ["02", "Fitted to what it reaches"],
    ],
  );
  const [fifth, fitted] = shorts.shorts;
  assert.equal(fifth?.length, 15);
  // The length it reached, recorded as its length, and its video within 5 % of it.
  assert.ok(fitted && fitted.length >= 15 && fitted.length < 30, `${fitted?.length} s`);
  assert.ok(
    lines.some((line) =>
      new RegExp(
        `after 2 requests; fitting it to ${fitted?.length} s, within the range asked$`,
      ).test(line.message),
    ),
  );
  assert.deepEqual(await readdir(join(dir, "shorts")), ["01", "02", "shorts.json"]);
  assert.deepEqual(shorts.shorts[0]?.hashtags, ["#talk", "#editing", "#twowords"]);
  assert.equal(shorts.shorts[0]?.source, join(folder, "talk.mp4"));
  assert.ok(logs.some((line) => line.startsWith('The moment "Too thin" was left out: ')));

  // Each short plays only its stretch, hook first as a short edit, within 5 % of its length.
  for (const short of shorts.shorts) {
    const project = await loadJson(
      join(dir, "shorts", short.folder, "edit.project.json"),
      validateProject,
    );
    for (const clip of project.main) {
      assert.ok(clip.in >= secondsToTicks(short.start) - secondsToTicks(0.5), short.title);
      assert.ok(clip.out <= secondsToTicks(short.end) + secondsToTicks(0.5), short.title);
    }
    assert.ok(Math.abs(short.seconds - short.length) <= short.length * 0.05, `${short.seconds} s`);
    assert.ok(existsSync(join(dir, "shorts", short.folder, "edit.mp4")));
    assert.ok(existsSync(join(dir, "shorts", short.folder, "edit.srt")));
  }
  const plans = requests.filter((request) => request.purpose === "plan").map(text);
  assert.match(plans[0] ?? "", /^Make a short edit: the strongest self-contained moments\./m);
  assert.match(plans[0] ?? "", /^This short is about: The fifth time\. The fifth time, said/m);
  assert.doesNotMatch(plans[0] ?? "", /^Give the video a title/m);

  // The finding request reads every line of the footage and asks for at most 3 moments.
  const find = requests.find((request) => request.purpose === "find");
  assert.ok(find && text(find).includes(`${16 * LINES} [`));
  assert.match(text(find), /^Find at most 3 moments, best first\.\nEach short lasts 15 to 30 s\./m);

  // Lines name the short they are about, a line says each short is done, and the last says why
  // fewer were made, with what Claude cost: finding, then every short, the failed one included.
  const done = lines.filter((line) => line.stage === "short");
  assert.deepEqual(
    done.map((line) => "short" in line && line.short),
    [
      { n: 1, of: 3 },
      { n: 2, of: 2 },
    ],
  );
  assert.ok(
    lines.some((line) => line.stage === "render" && "short" in line && line.short?.n === 2),
  );
  for (let i = 1; i < lines.length; i++) {
    assert.ok((lines[i]?.fraction ?? 0) >= (lines[i - 1]?.fraction ?? 0), `line ${i} goes back`);
  }
  const last = lines.at(-1);
  assert.equal(last?.stage, "done");
  assert.equal(
    last?.message,
    "Made 2 shorts, not 5: only 2 moments of the footage could be made into shorts of 15-30 s",
  );
  assert.deepEqual(last && "outputs" in last && last.outputs, {
    shorts: join(dir, "shorts", "shorts.json"),
  });
  const cost = last?.claude;
  assert.deepEqual(cost?.find, { dollars: 0.01, requests: 1 });
  const planned = requests.filter((request) => request.purpose === "plan").length;
  assert.equal(planned, 5, "the fifth once, the thin one and the fitted one twice each");
  assert.equal(cost?.plan.requests, planned);
  assert.equal(result.usage.calls, requests.length);
});

test("a short's stretch can be edited again on its own, and a stretch the file lacks is refused", async (t) => {
  const dir = await scratch(t, "within-");
  const folder = await longTalk(dir);
  const { claude } = claudeFor([]);
  const lines: Progress[] = [];
  const options = {
    inputs: [join(folder, "talk.mp4")],
    length: 15,
    aspect: "9:16" as const,
    out: join(dir, "out", "edit.mp4"),
    claude,
    worker: vework,
    cache: join(dir, "cache"),
    visuals: "minimal" as const,
    onProgress: (line: Progress) => lines.push(line),
  };
  const index = JSON.parse(await readFile(join(folder, "talk.index.json"), "utf8"));
  const words = index.transcript.words as { start: number; end: number }[];
  const start = words.find((word) => word.start > 60)?.start ?? 0;
  const result = await edit({ ...options, within: { start: start - 0.1, end: start + 30 } });
  const project = await loadJson(result.outputs.project, validateProject);
  for (const clip of project.main) {
    assert.ok(clip.in >= secondsToTicks(start - 0.6) && clip.out <= secondsToTicks(start + 30.5));
  }

  const refused = async (within: { start: number; end: number }, message: string) =>
    assert.rejects(
      edit({ ...options, within }),
      (error: Error) => error instanceof EditError && error.message === message,
    );
  const duration = index.source.duration as number;
  await refused(
    { start: duration - 10, end: duration + 20 },
    `${join(folder, "talk.mp4")} lasts ${duration.toFixed(1)} s: the stretch ${duration - 10}-${duration + 20} s is not inside it`,
  );
  await refused(
    { start: 10, end: 20 },
    "The stretch lasts 10.0 s, too short for a 15 s edit: ask for a shorter edit or a longer stretch",
  );
});

test("shorts that cannot be made, or cost past their cap, stop with the reason", async (t) => {
  const dir = await scratch(t, "shorts-refused-");
  const folder = await longTalk(dir);
  const base = {
    inputs: [folder],
    count: 2,
    range: [15, 30] as const,
    aspect: "9:16" as const,
    worker: vework,
    cache: join(dir, "cache"),
    visuals: "minimal" as const,
  };
  const fails = async (
    changes: Partial<ShortsOptions> & { out: string },
    moments: unknown[],
    pattern: RegExp,
    dollars: Partial<Record<string, number>> = {},
  ) => {
    const lines: Progress[] = [];
    const { claude } = claudeFor(moments, dollars);
    await assert.rejects(
      editShorts({ ...base, claude, onProgress: (line) => lines.push(line), ...changes }),
      (error: Error) => {
        assert.ok(error instanceof EditError, error.message);
        assert.match(error.message, pattern);
        return true;
      },
    );
    assert.equal(lines.at(-1)?.stage, "error");
    return lines;
  };
  await fails({ out: join(dir, "a"), count: 11 }, [], /^Make 1 to 10 shorts, not 11$/);
  await fails({ out: join(dir, "a"), range: [10, 30] }, [], /A short lasts 15 s to 3 min/);
  await fails({ out: folder }, [], /already holds files/);
  const once = join(dir, "once");
  await mkdir(once);
  await makeTalk(once);
  await fails(
    { out: join(dir, "b"), inputs: [once], range: [30, 60] },
    [],
    /^The footage lasts 25\.0 s in all, too short for a short of 30-60 s: ask for shorter ones or add footage$/,
  );
  await fails({ out: join(dir, "c") }, [], /^No moment of the footage stands alone/);
  const found = await fails(
    { out: join(dir, "d") },
    [saying(1, "Costly")],
    /^Finding the moments cost \$1\.50, over the \$1\.00 it may/,
    { find: 1.5 },
  );
  assert.deepEqual(found.at(-1)?.claude?.find, { dollars: 1.5, requests: 1 });
  await fails(
    { out: join(dir, "e") },
    [saying(1, "First"), saying(3, "Second")],
    /^Short 1 cost \$1\.\d\d, over the \$1 a short may, so the run stopped; the 1 made are in /,
    { plan: 1 },
  );
  const kept = await loadJson(join(dir, "e", "shorts.json"), validateShorts);
  assert.deepEqual(
    kept.shorts.map((short) => short.title),
    ["First"],
  );
});
