import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type TestContext, test } from "node:test";
import { loadJson, validateProject } from "@video-editor/schema";
import { ffmpeg, run } from "../ffmpeg.ts";
import { QUIET } from "../graph/encode.ts";
import { scratch } from "../testing.ts";
import { ClaudeError, type Quality, recordedClaude } from "./claude.ts";
import { plan } from "./plan.ts";
import type { CutVerdict, Decisions } from "./prompt.ts";
import { MAX_REVIEW_PASSES, review } from "./review.ts";
import { cutStrip } from "./strip.ts";
import { makeTalk } from "./talk.ts";

const T = 120_000;
const fine: CutVerdict = { problem: "none", fix: "none", confidence: 0.9, reason: "Clean." };
const clipped: CutVerdict = {
  problem: "clipped_word",
  fix: "move_later",
  confidence: 0.9,
  reason: "The first word after the cut starts abruptly.",
};

/** The talk planned from the recorded reply, with `verdicts[k]` as the check's answer for cut k
 * whatever order the checks run in, and `judge` as the planning model's. */
async function planned(
  t: TestContext,
  verdicts: CutVerdict[],
  judge: CutVerdict[] = [],
  replan?: (decisions: Decisions) => Decisions,
  quality: Quality = "best",
) {
  const dir = await scratch(t, "review-");
  const index = await makeTalk(dir);
  const [decisions] = JSON.parse(
    await readFile(new URL("fixtures/talk-plan.json", import.meta.url), "utf8"),
  ) as Decisions[];
  const again = replan ? replan(decisions as Decisions) : decisions;
  const recorded = recordedClaude({ plan: [decisions, again], judge });
  const out = join(dir, "edit", "project.json");
  const edit = await plan({
    inputs: [index],
    length: 15,
    aspect: "16:9",
    out,
    claude: recorded.claude,
    quality,
  });
  edit.state.claude = async (request) => {
    if (request.purpose !== "check") return recorded.claude(request);
    recorded.requests.push(request);
    const text = request.content.find((block) => block.type === "text")?.text ?? "";
    const at = Number(text.match(/the cut is at ([0-9.]+) s/)?.[1]);
    let position = 0;
    const cuts = edit.assembly.clips.map((clip) => {
      position += clip.out - clip.in;
      return position / T;
    });
    const k = cuts.findIndex((cut) => Math.abs(cut - at) < 0.01);
    const json = verdicts[k] ?? fine;
    return {
      json,
      usage: {
        purpose: "check",
        model: request.model,
        input: 0,
        cacheWrite: 0,
        cacheRead: 0,
        output: 0,
        dollars: 0,
      },
    };
  };
  // The strips only need a video with sound; the source stands in for the render.
  return { edit, video: join(dir, "talk.mp4"), requests: recorded.requests, out };
}

test("a sure fix at a jump moves the cut to the next pause and fits again", async (t) => {
  const { edit, video, requests, out } = await planned(t, [clipped, fine]);
  assert.equal(edit.project.main.length - 1, 2);
  const after = edit.assembly.clips[1];
  const result = await review(edit, video);
  assert.equal(result.pass, 1);
  assert.equal(result.changed, true);
  assert.ok(edit.state.excluded.has(`talk:${after?.first}`), "the word after the cut is out");
  const rewritten = await loadJson(out, validateProject);
  assert.deepEqual(rewritten, edit.project);
  assert.ok(rewritten.plan?.dropped.some((d) => d.reason.startsWith("Review 1: clipped word")));
  const { fit } = rewritten.plan ?? assert.fail("no plan");
  assert.ok(Math.abs(fit.duration - 15 * T) <= 0.05 * 15 * T);
  const checks = requests.filter((r) => r.purpose === "check");
  assert.equal(checks.length, 2);
  assert.equal(checks[0]?.model, "claude-haiku-5-5");
  assert.equal(checks[0]?.content[0]?.type, "image");
});

test("a clipped word beside a filler cut puts the filler back", async (t) => {
  const { edit, video } = await planned(t, [fine, clipped]);
  const [, before, after] = edit.assembly.clips;
  assert.ok(before && after && after.first === before.last + 2, "one filler cut out between");
  const result = await review(edit, video);
  assert.equal(result.changed, true);
  assert.ok(edit.state.restored.has(`talk:${before.last + 1}`));
  const lines = edit.project.captions?.lines.map((line) => line.text) ?? [];
  assert.ok(lines.includes("第二件事是字幕\u3000嗯\u3000字幕要用繁體中文"), lines.join("|"));
});

test("a doubtful check goes to the planning model, whose answer stands", async (t) => {
  const unsure: CutVerdict = { ...clipped, fix: "drop_after", confidence: 0.4 };
  const { edit, video, requests } = await planned(t, [unsure, fine], [fine]);
  const result = await review(edit, video);
  assert.equal(result.changed, false);
  assert.equal(result.findings[0]?.escalated, true);
  const judge = requests.find((r) => r.purpose === "judge");
  assert.equal(judge?.model, "claude-opus-5-5");
});

test("an economy edit's doubtful checks go to Sonnet, and each pass says what it cost", async (t) => {
  const unsure: CutVerdict = { ...clipped, fix: "drop_after", confidence: 0.4 };
  const { edit, video, requests } = await planned(t, [unsure, fine], [fine], undefined, "economy");
  const lines: string[] = [];
  const result = await review(edit, video, { onProgress: (line) => lines.push(line) });
  assert.equal(result.findings[0]?.escalated, true);
  const judge = requests.find((r) => r.purpose === "judge");
  assert.equal(judge?.model, "claude-sonnet-5-5");
  assert.ok(lines.includes("Review 1: 2 cuts checked, 1 judged by claude-sonnet-5-5 ($0.0000)"));
});

/** Drops on both sides of every cut leave too little for the length, so the refit asks the
 * planner again. */
const dropAll = [0, 1].map(() => ({ ...clipped, problem: "broken_sentence", fix: "drop_after" }));

test("fixes that leave the edit short, even after a second plan, change nothing", async (t) => {
  const thin = (d: Decisions) => ({ ...d, segments: d.segments.slice(0, 1) });
  const drops = dropAll as CutVerdict[];
  const { edit, video, out } = await planned(t, drops, drops, thin);
  const before = { ...edit.state, excluded: new Map(edit.state.excluded) };
  const written = await readFile(out, "utf8");
  const result = await review(edit, video);
  assert.equal(result.changed, false);
  assert.match(result.note ?? "", /^Fixes not applied: After 2 requests/);
  assert.equal(edit.state.planCalls, 2, "the second request was spent");
  assert.equal(edit.state.decisions, before.decisions);
  assert.equal(edit.state.segments, before.segments);
  assert.equal(edit.state.cuts, before.cuts);
  assert.deepEqual(edit.state.excluded, before.excluded);
  assert.equal(await readFile(out, "utf8"), written);
});

test("a declined second plan during a review leaves the edit as it was", async (t) => {
  const drops = dropAll as CutVerdict[];
  const { edit, video } = await planned(t, drops, drops);
  const inner = edit.state.claude;
  edit.state.claude = async (request) => {
    if (request.purpose === "plan")
      throw new ClaudeError("claude-opus-5-5 declined the plan request");
    return inner(request);
  };
  const result = await review(edit, video);
  assert.equal(result.changed, false);
  assert.match(result.note ?? "", /declined the plan request/);
  assert.equal(edit.state.excluded.size, 0);
});

test(`an edit is reviewed at most ${MAX_REVIEW_PASSES} times`, async (t) => {
  const { edit, video } = await planned(t, [clipped, clipped]);
  const passes = [];
  for (let i = 0; i < MAX_REVIEW_PASSES + 2; i++) passes.push((await review(edit, video)).pass);
  assert.deepEqual(passes.slice(MAX_REVIEW_PASSES), [0, 0]);
  assert.equal(edit.state.reviews, MAX_REVIEW_PASSES);
});

test("a cut strip draws the sound it is given instead of the video's, such as the voice stem", async (t) => {
  const dir = await scratch(t, "strip-");
  await makeTalk(dir);
  const silent = join(dir, "voice.wav");
  const bin = await ffmpeg();
  await run(bin, [...QUIET, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "4", silent]);
  /** Lit pixels in the waveform band under the frames. */
  const lit = async (audio?: string) => {
    const png = await cutStrip(join(dir, "talk.mp4"), dir, {
      start: 1,
      end: 3,
      mark: 2,
      silences: [],
      ...(audio ? { audio } : {}),
    });
    const file = join(dir, "strip.png");
    await writeFile(file, png);
    const raw = join(dir, "wave.gray");
    await run(bin, [...QUIET, "-y", "-i", file, "-vf", "crop=iw:160:0:ih-160,format=gray", "-f", "rawvideo", raw]); // biome-ignore format: one line
    return [...(await readFile(raw))].filter((value) => value > 60).length;
  };
  const tone = await lit();
  const quiet = await lit(silent);
  assert.ok(quiet < tone / 10, `${quiet} lit pixels with silence, ${tone} with the tone`);
});
