import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TICKS_PER_SECOND } from "@video-editor/schema";
import { outputWords, type TimedWord } from "./captions.ts";
import { CHECK_MODEL, ClaudeError, totalUsage, type Usage } from "./claude.ts";
import { lengthOf } from "./place.ts";
import { assemble, dollars, PlanError, type PlannedEdit, type PlanSource, write } from "./plan.ts";
import { CHECK_SCHEMA, CHECK_SYSTEM, type CutVerdict } from "./prompt.ts";
import { cutStrip, SILENCE } from "./strip.ts";
import { joinWords } from "./text.ts";

/** Reviews per edit, enforced here whoever calls. */
export const MAX_REVIEW_PASSES = 3;
/** A check less sure than this, or one that would drop a clip, goes to the planning model. */
const ESCALATE_BELOW = 0.7;
/** Seconds shown on each side of a cut. */
const WINDOW = 1;
/** Words of context on each side of a cut. */
const CONTEXT_WORDS = 12;
const CONCURRENCY = 4;

export interface CutFinding {
  /** Seconds into the rendered video. */
  at: number;
  verdict: CutVerdict | null;
  /** Whether the planning model decided the fix. */
  escalated: boolean;
  /** Why the check could not run, such as a declined request. */
  error?: string;
}

export interface ReviewResult {
  /** This review's number, 1 to MAX_REVIEW_PASSES; 0 when no passes were left. */
  pass: number;
  /** Whether the project changed and should be rendered and reviewed again. */
  changed: boolean;
  findings: CutFinding[];
  usage: Usage[];
  /** Why fixes found were not applied, if they were not. */
  note?: string;
}

/**
 * Checks every cut of `video`, the render of `edit`, and fixes what the checks find: a strip of
 * frames and waveform around each cut goes to the check model, which can escalate to the
 * planning model. A fix keeps more silence beside a clipped word, moves a cut to the next pause,
 * puts back a filler whose cut clipped its neighbours, or drops a clip; the length is then
 * fitted again and the project rewritten. Call it after each render until `changed` is false;
 * it does nothing after MAX_REVIEW_PASSES reviews of the same edit.
 */
export async function review(
  edit: PlannedEdit,
  video: string,
  options: {
    onProgress?: (message: string) => void;
    /** The render's voice stem (RenderOptions.stems), drawn under the frames instead of the
     * video's sound when the edit has music. */
    voice?: string;
  } = {},
): Promise<ReviewResult> {
  const { state } = edit;
  const progress = options.onProgress ?? state.progress;
  if (state.reviews >= MAX_REVIEW_PASSES) {
    return { pass: 0, changed: false, findings: [], usage: [], note: "No review passes left" };
  }
  const pass = ++state.reviews;
  const clips = edit.assembly.clips;
  const words = outputWords(clips, state.sources);
  const length = lengthOf(clips) / TICKS_PER_SECOND;
  const cuts: number[] = [];
  let position = 0;
  for (const clip of clips.slice(0, -1)) {
    position += clip.out - clip.in;
    cuts.push(position / TICKS_PER_SECOND);
  }

  const dir = await mkdtemp(join(tmpdir(), "review-"));
  const usage: Usage[] = [];
  let findings: CutFinding[];
  try {
    progress(`Review ${pass}: checking ${cuts.length} cuts with ${CHECK_MODEL}`);
    findings = await pool(cuts, CONCURRENCY, async (at, k) => {
      const start = Math.max(0, at - WINDOW);
      const end = Math.min(length, at + WINDOW);
      const png = await cutStrip(video, dir, {
        start,
        end,
        mark: at,
        silences: silences(words, start, end),
        ...(options.voice ? { audio: options.voice } : {}),
      });
      const context = describe(edit, words, k, at);
      const content = [
        { type: "image" as const, png },
        {
          type: "text" as const,
          text: `The strip runs from ${start.toFixed(2)} s to ${end.toFixed(2)} s; the cut is at ${at.toFixed(2)} s.\n${context}`,
        },
      ];
      try {
        const check = await state.claude({
          purpose: "check",
          model: CHECK_MODEL,
          system: CHECK_SYSTEM,
          content,
          schema: CHECK_SCHEMA as unknown as Record<string, unknown>,
          effort: "low",
          maxTokens: 4000,
        });
        usage.push(check.usage);
        let verdict = check.json as CutVerdict;
        const doubtful = verdict.confidence < ESCALATE_BELOW || verdict.fix.startsWith("drop");
        if (verdict.problem === "none" || verdict.fix === "none" || !doubtful) {
          return { at, verdict, escalated: false };
        }
        const judged = await state.claude({
          purpose: "judge",
          model: state.planModel,
          system: CHECK_SYSTEM,
          content: [
            ...content,
            {
              type: "text",
              text: `A first check reported: ${JSON.stringify(verdict)}\nDecide the fix yourself; answer none if the cut is fine.`,
            },
          ],
          schema: CHECK_SCHEMA as unknown as Record<string, unknown>,
          effort: "medium",
          maxTokens: 16_000,
        });
        usage.push(judged.usage);
        verdict = judged.json as CutVerdict;
        return { at, verdict, escalated: true };
      } catch (error) {
        if (!(error instanceof ClaudeError)) throw error;
        return { at, verdict: null, escalated: false, error: error.message };
      }
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  state.usage.push(...usage);
  const judged = findings.filter((finding) => finding.escalated).length;
  progress(
    `Review ${pass}: ${cuts.length} cuts checked, ${judged} judged by ${state.planModel} ` +
      `(${dollars(totalUsage(usage).dollars)})`,
  );

  // Each change, as the step that undoes it, should the edit no longer fit afterwards.
  const changes: (() => void)[] = [];
  const exclude = (source: string, first: number, last: number, reason: string) => {
    for (let i = first; i <= last; i++) {
      const key = `${source}:${i}`;
      if (state.excluded.has(key)) continue;
      state.excluded.set(key, reason);
      changes.push(() => state.excluded.delete(key));
    }
  };
  const room = (id: string, word: number) => {
    const roomy = (state.sources.get(id) as PlanSource).roomy;
    if (roomy.has(word)) return;
    roomy.add(word);
    changes.push(() => roomy.delete(word));
  };
  for (const [k, finding] of findings.entries()) {
    const verdict = finding.verdict;
    if (!verdict || verdict.problem === "none" || verdict.fix === "none") continue;
    const before = clips[k];
    const after = clips[k + 1];
    if (!before || !after) continue;
    // A cut that only took out fillers is undone rather than moved: words run on beside a
    // filler, so moving the cut would take the rest of the phrase with it.
    const between = Array.from(
      { length: Math.max(0, after.first - before.last - 1) },
      (_, i) => `${before.source}:${before.last + 1 + i}`,
    );
    const fillers =
      before.source === after.source &&
      between.length > 0 &&
      between.every((key) => state.cuts.get(key) === "filler");
    if (fillers && !verdict.fix.startsWith("drop")) {
      for (const key of between.filter((key) => !state.restored.has(key))) {
        state.restored.add(key);
        changes.push(() => state.restored.delete(key));
      }
      continue;
    }
    const reason = `Review ${pass}: ${verdict.problem.replace("_", " ")} at ${finding.at.toFixed(2)} s; ${verdict.reason}`;
    if (verdict.fix === "more_room") {
      room(before.source, before.last);
      room(after.source, after.first);
    }
    if (verdict.fix === "move_earlier") exclude(before.source, before.last, before.last, reason);
    if (verdict.fix === "move_later") exclude(after.source, after.first, after.first, reason);
    if (verdict.fix === "drop_before") exclude(before.source, before.first, before.last, reason);
    if (verdict.fix === "drop_after") exclude(after.source, after.first, after.last, reason);
  }
  if (changes.length === 0) return { pass, changed: false, findings, usage };
  progress(`Review ${pass}: fixing cuts and fitting again`);
  // Fitting again may ask the planner once more, which replaces its decisions; a refit that
  // fails puts back the ones the written project was built from. The request stays counted.
  const { decisions, segments, cuts: planned, model } = state;
  try {
    const assembly = await assemble(state);
    const same = (clip: (typeof clips)[number], i: number) => {
      const other = assembly.clips[i];
      return other?.source === clip.source && other.in === clip.in && other.out === clip.out;
    };
    if (assembly.clips.length === clips.length && clips.every(same)) {
      return { pass, changed: false, findings, usage, note: "The fixes moved no cut" };
    }
    const written = await write(state, assembly);
    edit.project = written.project;
    edit.assembly = written.assembly;
  } catch (error) {
    Object.assign(state, { decisions, segments, cuts: planned, model });
    for (const undo of changes) undo();
    if (!(error instanceof PlanError || error instanceof ClaudeError)) throw error;
    return { pass, changed: false, findings, usage, note: `Fixes not applied: ${error.message}` };
  }
  return { pass, changed: true, findings, usage };
}

/** Silences between words inside [start, end], from the output timeline. */
function silences(words: readonly TimedWord[], start: number, end: number): [number, number][] {
  const spans: [number, number][] = [];
  let previous = start;
  for (const word of words) {
    const from = word.start / TICKS_PER_SECOND;
    const to = word.end / TICKS_PER_SECOND;
    if (to <= start) {
      previous = Math.max(previous, to);
      continue;
    }
    if (from >= end) break;
    if (from - previous >= SILENCE) spans.push([previous, from]);
    previous = Math.max(previous, to);
  }
  if (end - previous >= SILENCE) spans.push([previous, end]);
  return spans;
}

/** What the check reads besides the picture: the words on each side and what the cut does. */
function describe(edit: PlannedEdit, words: readonly TimedWord[], k: number, at: number): string {
  const clips = edit.assembly.clips;
  const before = clips[k] as (typeof clips)[number];
  const after = clips[k + 1] as (typeof clips)[number];
  const ticks = at * TICKS_PER_SECOND;
  const said = words.filter((w) => w.end <= ticks).slice(-CONTEXT_WORDS);
  const next = words.filter((w) => w.start >= ticks).slice(0, CONTEXT_WORDS);
  let kind = "a jump to another part of the footage";
  if (before.source === after.source && after.first === before.last + 1) {
    kind = "a long pause shortened to a breath";
  } else if (
    before.source === after.source &&
    after.first > before.last &&
    after.first - before.last < 6
  ) {
    kind = "a few words removed, such as a filler";
  }
  return [
    `This cut is ${kind}.`,
    `Before the cut: …${joinWords(said.map((w) => w.text))}`,
    `After the cut: ${joinWords(next.map((w) => w.text))}…`,
  ].join("\n");
}

/** Runs `task` over `items`, at most `limit` at a time, keeping their order. */
async function pool<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T, i: number) => Promise<R>,
) {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await task(items[i] as T, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
