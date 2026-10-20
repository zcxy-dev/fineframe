// Finds the moments of a long video that make the best shorts, for `pnpm edit --shorts`: one
// request reads every transcript, and code checks what it answers.

import { TICKS_PER_SECOND, ticksPerFrame, type Word } from "@video-editor/schema";
import { mostMoments } from "../edit/length.ts";
import { type Claude, PLAN_MODELS, type Quality, type Usage } from "./claude.ts";
import { packSource } from "./pack.ts";
import { lengthOf } from "./place.ts";
import { loadSources, type PlanInput, type PlanSource, placeAll } from "./plan.ts";

/** The hashtags each short gets. */
const HASHTAGS = [3, 5] as const;

/** A moment found: one continuous run of lines of one file, best first. */
export interface Moment {
  /** The file's absolute path. */
  path: string;
  /** Its lines, inclusive, numbered as the transcript the request read numbers them. */
  first: number;
  last: number;
  /** Where its first line starts and its last ends, in seconds into the file. */
  start: number;
  end: number;
  /** Seconds: the short's target, within the range. */
  length: number;
  title: string;
  description: string;
  hashtags: string[];
}

export interface FindOptions {
  /** The videos' indexes with their files, in recording order. */
  inputs: PlanInput[];
  /** The shortest and longest a short may be, in seconds. */
  range: readonly [number, number];
  claude: Claude;
  quality?: Quality;
  /** What the user asks of the shorts, in their words. */
  instructions?: string;
  /** Every request's usage goes here. */
  usage: Usage[];
}

/**
 * Asks Claude for the moments of the footage that stand alone as shorts, best first, and keeps
 * those code can make: on lines that exist, not sharing a line with a better one, with a length
 * in the range that the stretch's speech, every word kept, reaches.
 */
export async function findMoments(options: FindOptions): Promise<Moment[]> {
  const sources = await loadSources(options.inputs);
  const videos = [...sources.values()].filter((s) => s.index && s.lines.length > 0);
  const footage = videos.reduce((sum, s) => sum + (s.index?.source.duration ?? 0), 0);
  const most = mostMoments(footage);
  const [shortest, longest] = options.range;
  const model = PLAN_MODELS[options.quality ?? "best"];
  const packed = videos
    .map((s) => packSource(s.id, s.index as NonNullable<PlanSource["index"]>, s.lines, [], s.name))
    .join("\n\n");
  const instructions = options.instructions?.trim();
  const request = [
    `Find at most ${most} moments, best first.`,
    `Each short lasts ${shortest} to ${longest} s.`,
    ...(instructions
      ? [
          "What the user asks of the shorts, in their own words; follow it as far as the footage " +
            "and the rules above allow:",
          `<instructions>\n${instructions}\n</instructions>`,
        ]
      : []),
  ].join("\n");
  const reply = await options.claude({
    purpose: "find",
    model,
    system: FIND_SYSTEM,
    content: [
      { type: "text", text: packed, cache: true },
      { type: "text", text: request },
    ],
    schema: FIND_SCHEMA,
    effort: "high",
    maxTokens: 32_000,
  });
  options.usage.push(reply.usage);
  const answer = reply.json as { moments: Answer[] };
  // The output's frame only rounds where cuts fall; 30 fps measures a stretch near enough.
  const frame = ticksPerFrame({ num: 30, den: 1 });
  const taken: Moment[] = [];
  const used = new Map<string, Set<number>>();
  for (const moment of answer.moments) {
    if (taken.length >= most) break;
    const source = sources.get(moment.source);
    if (!source?.index) continue;
    const lines = source.lines.filter((line) => line.n >= moment.first && line.n <= moment.last);
    const first = lines[0];
    const last = lines.at(-1);
    if (!first || !last) continue;
    const own = used.get(source.id) ?? new Set<number>();
    if (lines.some((line) => own.has(line.n))) continue;
    const hashtags = [
      ...new Set(moment.hashtags.map((tag) => `#${tag.replace(/[#\s]/g, "")}`)),
    ].filter((tag) => tag.length > 1);
    const title = moment.title.trim();
    const description = moment.description.trim();
    if (hashtags.length < HASHTAGS[0] || !title || !description) continue;
    // Every word of the stretch at the longest breath: no short of it runs longer.
    const stretch = new Map([[source.id, { ...source, lines }]]);
    const whole = lengthOf(placeAll(stretch, frame)) / TICKS_PER_SECOND;
    const length = Math.min(longest, Math.max(shortest, Math.round(moment.length)));
    if (whole < length) continue;
    for (const line of lines) own.add(line.n);
    used.set(source.id, own);
    taken.push({
      path: source.path,
      first: first.n,
      last: last.n,
      start: (source.words[first.first] as Word).start,
      end: (source.words[last.last] as Word).end,
      length,
      title,
      description,
      hashtags: hashtags.slice(0, HASHTAGS[1]),
    });
  }
  return taken;
}

interface Answer {
  source: string;
  first: number;
  last: number;
  length: number;
  title: string;
  description: string;
  hashtags: string[];
}

const FIND_SYSTEM = `\
You find the moments in long footage that make the best shorts for social media. You read the \
transcripts of the footage; code then edits each moment you choose into a short of its own.

## The footage

The files are one recording, in the order it was made, split into files. Each file starts with \
a header: its length, picture, how much of it is speech, its long pauses, its loudness peaks and \
audio events (laughter, applause, music). Then come its lines, numbered within the file:

12 [034.20-038.95] text

A line is a phrase between pauses, or a sentence. Times are seconds into that file. The \
transcript comes from a speech model: it mishears some words, and writes Chinese in Taiwan \
Traditional characters.

## What a moment is

One continuous run of lines of one file: one self-contained topic or moment. Code cuts the \
fillers, pauses and side tangents inside it and may open the short on its strongest hook from \
later in the run, but never adds anything from outside it. Weigh each candidate on:
1. Hook: something in it stops the scroll within the first three seconds: a bold claim, a \
surprising number, a direct question. Dead air or a continuation is weak.
2. Standalone: a viewer follows it with no context from the rest of the footage. "As I said \
earlier" is weak; a complete idea is strong.
3. Arc: a setup and a payoff: a build-up to a punchline, a problem to a solution, a question to \
an answer.
4. Ending: it ends on a completed thought or a strong line, never mid-sentence.

No two moments share a line. List the moments best first, the one most worth posting first, \
and give fewer than asked when the footage holds fewer that stand on their own: a weak moment \
is worse than none.

## What you give for each

- source, first and last: the file id, as in its header, and its first and last line.
- length: the short's length in whole seconds, within the range the request gives, to fit the \
moment. Its lines must hold more speech than that: about 1.5 times the length, so code can \
leave out fillers, retakes and weaker lines and still reach it.
- title: a title to post the short under, at most 60 characters.
- description: one or two sentences to post with it.
- hashtags: ${HASHTAGS[0]} to ${HASHTAGS[1]} hashtags, each one word or phrase with no spaces, \
starting with #.
Write the title, description and hashtags in the language the footage is spoken in: for \
Mandarin, in Taiwan Traditional Chinese with Taiwan's wording.`;

const FIND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["moments"],
  properties: {
    moments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source", "first", "last", "length", "title", "description", "hashtags"],
        properties: {
          source: { type: "string", description: "File id, as in its header." },
          first: { type: "integer", description: "First line number." },
          last: { type: "integer", description: "Last line number, inclusive." },
          length: { type: "integer", description: "The short's length in seconds." },
          title: { type: "string" },
          description: { type: "string" },
          hashtags: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;
