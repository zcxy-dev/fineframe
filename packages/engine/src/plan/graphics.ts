// Motion graphics for a planned edit. Once its cut is known, Claude writes each graphic for this
// video as HTML and CSS, on the words it lands on; code times each on those words, checks each as
// drawn (text on the frame and off the captions and faces, nothing overlapping or cut off, a
// full-frame graphic filled, every part entering and staying, and every word said near it), has
// Claude fix one that fails once, and leaves out one that still fails, so its line keeps the
// speaker.

import { dirname } from "node:path";
import {
  type Box,
  checkGraphics,
  FULL_SHARE,
  GRAPHIC_SECONDS,
  type GraphicCheckJob,
  type GraphicLayout,
  graphicFrame,
  graphicsGuide,
  isOverlayLayout,
  LEAD,
} from "@video-editor/effects";
import {
  type BrollClip,
  type Graphic,
  type Project,
  type SoundEffect,
  secondsToTicks,
  TICKS_PER_SECOND,
  ticksPerFrame,
} from "@video-editor/schema";
import { pickSfx } from "../broll/sfx.ts";
import { faceZones } from "../captions/faces.ts";
import { captionAreas } from "../captions/index.ts";
import { chrome } from "../chrome.ts";
import { fingerprintOf, loadSources } from "../sources.ts";
import { buildTimeline } from "../timeline.ts";
import type { TimedWord } from "./captions.ts";
import { type Claude, totalUsage, type Usage } from "./claude.ts";
import { bare, joinWords } from "./text.ts";
import { projectCredit, sfxCredit, visualPath } from "./visuals.ts";
import { repeated, restates, unnamed, unsaid } from "./wording.ts";

/** The sounds a graphic may ask for: one for something landing, a list, a check or an X. */
const GRAPHIC_SFX = ["none", "tap", "paper", "tone", "stop"] as const;
type GraphicSfx = (typeof GRAPHIC_SFX)[number];

/** A graphic as Claude wrote it, on the words it lands on and those it shows, by source word. */
export interface GraphicWish {
  layout: GraphicLayout;
  /** The first word it lands on. */
  anchor: { source: string; index: number };
  /** The words it shows, as said. */
  words: { source: string; word: number }[];
  /** How long it stays, as asked. */
  seconds: number;
  /** What it shows and why, as Claude put it. */
  shows: string;
  html: string;
  css: string;
  sfx: GraphicSfx;
}

/** At most this much of an edit goes to one request: a request writes all of its graphics. */
const WINDOW = 180;
/** A graphic is checked against the speech this long before it and after it. */
const NEAR_BEFORE = 20;
const NEAR_AFTER = 10;
/** Between two graphics, the speaker shows alone at least this long. */
const GAP = 0.4;
/** A sound effect plays at most once in this many seconds, with those of the visuals. */
const SFX_EVERY = 6;
const SFX_GAIN: Record<Exclude<GraphicSfx, "none">, number> = {
  tap: -16,
  stop: -16,
  paper: -12,
  tone: -14,
};
/** At 9:16 the picture changes every 2 to 4 s, at other aspects every 5 to 8 s. */
const CADENCE = { portrait: [2, 4], landscape: [5, 8] } as const;

/** What a graphic must keep clear of, and when the picture already changes, on the output
 * timeline: the context a request writes graphics in and a check checks them against. */
interface Context {
  /** Where captions may be drawn, in any style, in output frames and pixels. */
  captions: { start: number; end: number; box: Box }[];
  /** Faces on screen, in output frames and pixels. */
  faces: { start: number; end: number; boxes: Box[] }[];
  /** Where the picture changes already: cuts, framing steps, B-roll and effects, in ticks. */
  changes: number[];
  /** What no graphic may overlap: B-roll, captures, footage and the effects, in ticks. */
  taken: { start: number; end: number; what: string }[];
}

/** Where the project's captions may be drawn in any style, its faces as rendered, and what
 * already changes and covers the picture. */
async function contextOf(project: Project, projectPath: string): Promise<Context> {
  const sources = await loadSources(project, projectPath);
  const timeline = buildTimeline(project, sources);
  const captions = (await captionAreas(project, timeline)).map(({ start, end, ...box }) => ({
    start,
    end,
    box,
  }));
  const faces = faceZones(timeline, project.output).map((zone) => ({
    start: zone.start,
    end: zone.end,
    boxes: zone.boxes.map((b) => ({ x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 })),
  }));
  const changes: number[] = [];
  let at = 0;
  for (const clip of project.main) {
    if (at > 0) changes.push(at);
    const scale = clip.framing?.scale;
    if (scale && typeof scale === "object") {
      // A step between two framings is two keyframes a tick apart.
      for (const [k, key] of scale.keyframes.entries()) {
        const next = scale.keyframes[k + 1];
        if (next && next.t - key.t <= 1 && next.scale !== key.scale) {
          changes.push(at + next.t - clip.in);
        }
      }
    }
    at += clip.out - clip.in;
  }
  const speakers = new Set(project.main.map((clip) => clip.source));
  const taken = [
    ...(project.broll ?? [])
      .filter((clip) => !speakers.has(clip.source))
      .map((clip) => ({ start: clip.start, end: clip.start + clip.out - clip.in, what: "B-roll" })),
    ...(project.overlays ?? []).map((overlay) => ({
      start: overlay.start,
      end: overlay.start + overlay.duration,
      what: overlay.template,
    })),
  ];
  for (const span of taken) changes.push(span.start, span.end);
  return { captions, faces, changes: [...new Set(changes)].sort((a, b) => a - b), taken };
}

const seconds = (ticks: number) => (ticks / TICKS_PER_SECOND).toFixed(2);

/** The system prompt every graphics request shares. */
function systemPrompt(output: Project["output"]): string {
  const { aspect, width, height } = output;
  const [often, most] = aspect === "9:16" ? CADENCE.portrait : CADENCE.landscape;
  return `You design the motion graphics of a finished edit of a talking-head video, as a top editor would, and write each as HTML and CSS that a headless browser renders frame by frame.

## What a graphic may show
- Only keywords, numbers, comparisons or lists the speaker says. Never the sentence being spoken: the captions already show it, and they stay on.
- Every word on a graphic is said in the edit near it, or is a two-to-four-character label for a list or a comparison taken from their words (以前 / 現在). Never a number, a name or a term they do not say, and never another word for what they say (長焦 when they say 中焦).
- The speaker's language: Traditional Chinese as written in Taiwan, and English words as English.
- A full-frame graphic or a panel carries enough to read on its own: a thesis in a few words, a list of two to five items, a number with what it counts, or two things compared with a word or two each. One or two words is a label, not a panel or a full-frame graphic.
- A list or a comparison may build up as the speaker says each item, but every box enters with its own text: never an empty box waiting for words.

## Timing and amount
- Each graphic lands on words the speaker says, its anchor: code starts it ${LEAD} s before the first of them is said.
- The picture changes every ${often} to ${most} s in a good edit of this shape: something new at least every ${most} s. The changes already in the edit are listed; put graphics where nothing changes for longer than that, on the words that carry a point.
- Full-frame graphics stay ${GRAPHIC_SECONDS.full.min} to ${GRAPHIC_SECONDS.full.max} s and take at most ${FULL_SHARE * 100} % of the edit in all; labels ${GRAPHIC_SECONDS.label.min} to ${GRAPHIC_SECONDS.label.max} s, lower thirds ${GRAPHIC_SECONDS["lower-third"].min} to ${GRAPHIC_SECONDS["lower-third"].max} s${aspect === "9:16" ? `, panels ${GRAPHIC_SECONDS.panel.min} to ${GRAPHIC_SECONDS.panel.max} s` : ""}. Most graphics keep the speaker in shot.
${aspect === "9:16" ? "- This is a vertical short: most graphics are panels, the graphic on top and the speaker below, one after another on the points of the speech; labels and lower thirds are for a word in between, and a full frame only for the one or two points that carry the video." : "- This is a landscape video: corner labels and lower thirds carry most points with the speaker in shot; a full frame is for a thesis, a list, a number or a comparison worth a held frame."}
- One graphic at a time, with at least ${GAP} s of the speaker alone between two, and none over the stretches listed as taken.
- sfx: tap when a number or a hero word lands, paper for a list, tone for a check, stop for an X, and none for most.

${graphicsGuide(aspect, width, height)}

## Where things are
The request lists where the captions are drawn and where faces are, in output pixels. A label or a lower third keeps off every face and every caption; no text of any graphic lies where captions are drawn while it shows.${aspect === "9:16" ? " While a panel shows, the captions move onto the seam between the panel and the speaker, about y 740 to 1030, and they stay there for a caption that starts during it." : ""}

## Your answer
Plan the graphics for the stretch, then write each one. For each give: layout; anchor, the words it lands on exactly as they appear in the speech; at, the time in seconds of the anchor's first word; seconds, how long it stays; quotes, each phrase of the speech it shows, exactly as it appears there; shows, what it shows and why it is a keyword, number, comparison or list the speaker says; sfx; html; css.`;
}

/** The answer's schema. */
function answerSchema(aspect: Project["output"]["aspect"]): Record<string, unknown> {
  const layouts =
    aspect === "9:16"
      ? ["label", "lower-third", "panel", "full"]
      : ["label", "lower-third", "full"];
  return {
    type: "object",
    additionalProperties: false,
    required: ["graphics"],
    properties: {
      graphics: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["layout", "anchor", "at", "seconds", "quotes", "shows", "sfx", "html", "css"],
          properties: {
            layout: { type: "string", enum: layouts },
            anchor: { type: "string" },
            at: { type: "number" },
            seconds: { type: "number" },
            quotes: { type: "array", items: { type: "string" } },
            shows: { type: "string" },
            sfx: { type: "string", enum: [...GRAPHIC_SFX] },
            html: { type: "string" },
            css: { type: "string" },
          },
        },
      },
    },
  };
}

interface Answer {
  layout: GraphicLayout;
  anchor: string;
  at: number;
  seconds: number;
  quotes: string[];
  shows: string;
  sfx: GraphicSfx;
  html: string;
  css: string;
}

/** The speech between `from` and `to` (ticks), a phrase a line, each word with its start. */
function speechText(words: readonly TimedWord[], from: number, to: number): string {
  const lines: string[] = [];
  let phrase: TimedWord[] = [];
  const flush = () => {
    const first = phrase[0];
    const last = phrase.at(-1);
    if (first && last) {
      const said = phrase.map((w) => `${w.text}@${seconds(w.start)}`).join(" ");
      lines.push(`[${seconds(first.start)}–${seconds(last.end)}] ${said}`);
    }
    phrase = [];
  };
  for (const word of words) {
    if (word.start < from || word.start >= to) continue;
    const last = phrase.at(-1);
    if (last && word.start - last.end > secondsToTicks(0.25)) flush();
    phrase.push(word);
  }
  flush();
  return lines.join("\n");
}

/** Spans of output frames with one value, joined where they follow on: [from, to) ticks, as text. */
function spansText<T>(
  items: readonly { start: number; end: number; value: T }[],
  frame: number,
  show: (value: T) => string,
): string {
  const joined: { start: number; end: number; text: string }[] = [];
  for (const item of items) {
    const text = show(item.value);
    const last = joined.at(-1);
    if (last && last.text === text && item.start - last.end <= 1) last.end = item.end;
    else joined.push({ start: item.start, end: item.end, text });
  }
  return joined
    .map((s) => `${seconds(s.start * frame)}–${seconds(s.end * frame)} s: ${s.text}`)
    .join("\n");
}

/** The request for the graphics of output ticks [from, to). */
function requestText(
  project: Project,
  words: readonly TimedWord[],
  context: Context,
  from: number,
  to: number,
): string {
  const frame = ticksPerFrame(project.output.fps);
  const inside = <T extends { start: number; end: number }>(list: readonly T[]) =>
    list.filter((item) => item.end * frame > from && item.start * frame < to);
  const round = (n: number) => Math.round(n);
  const captions = spansText(
    inside(context.captions).map((c) => ({ ...c, value: c.box })),
    frame,
    (b) => `y ${round(b.y)}–${round(b.y + b.height)}`,
  );
  const faces = spansText(
    inside(context.faces).map((f) => ({ ...f, value: f.boxes })),
    frame,
    (boxes) =>
      boxes
        .map(
          (b) =>
            `x ${round(b.x)}–${round(b.x + b.width)}, y ${round(b.y)}–${round(b.y + b.height)}`,
        )
        .join("; "),
  );
  const changes = context.changes.filter((t) => t >= from && t < to).map(seconds);
  const taken = context.taken
    .filter((t) => t.end > from && t.start < to)
    .map((t) => `${seconds(t.start)}–${seconds(t.end)} s: ${t.what}`);
  const { aspect, width, height } = project.output;
  return `The edit is ${aspect}, ${width}×${height} px, ${seconds(project.output.target.duration)} s long. Write the graphics for ${seconds(from)}–${seconds(to)} s of it.

Speech, a phrase a line, each word@its start in seconds:
${speechText(words, from, to)}

Captions drawn:
${captions || "none"}

Faces on screen:
${faces || "none"}

The picture already changes at (s): ${changes.length > 0 ? changes.join(", ") : "nowhere in this stretch"}

Taken, no graphic over these:
${taken.length > 0 ? taken.join("\n") : "none"}`;
}

/** The words of `quote` among `words`, nearest `at` (ticks), as their positions in `words`. */
export function findQuote(
  words: readonly TimedWord[],
  quote: string,
  at: number,
): [number, number] | null {
  const wanted = bare(quote).replace(/\s+/g, "");
  if (!wanted) return null;
  let best: [number, number] | null = null;
  for (let i = 0; i < words.length; i++) {
    let said = "";
    for (let j = i; j < words.length; j++) {
      said += bare((words[j] as TimedWord).text).replace(/\s+/g, "");
      if (said === wanted) {
        const distance = Math.abs((words[i] as TimedWord).start - at);
        const bestDistance = best ? Math.abs((words[best[0]] as TimedWord).start - at) : Infinity;
        if (distance < bestDistance) best = [i, j];
        break;
      }
      if (!wanted.startsWith(said)) break;
    }
  }
  return best;
}

/** Claude's graphics as wishes on the edit's words; one whose anchor is not in the speech is left
 * out. */
export function wishesOf(
  answers: readonly Answer[],
  words: readonly TimedWord[],
  progress: (message: string) => void,
): GraphicWish[] {
  return answers.flatMap((answer): GraphicWish[] => {
    const at = secondsToTicks(answer.at);
    const anchor = findQuote(words, answer.anchor, at);
    if (!anchor) {
      progress(`Left out a graphic on words the edit does not say: "${answer.anchor}"`);
      return [];
    }
    // Each phrase it shows must be said: one that is not leaves the graphic nothing to go with
    // when a cut takes its words, so it is left out.
    const spans: [number, number][] = [anchor];
    for (const quote of answer.quotes) {
      const found = findQuote(words, quote, at);
      if (!found) {
        progress(`Left out a graphic on words the edit does not say: "${quote}"`);
        return [];
      }
      spans.push(found);
    }
    const seen = new Set<number>();
    const depends = spans
      .flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, k) => from + k))
      .filter((i) => !seen.has(i) && seen.add(i))
      .sort((a, b) => a - b)
      .map((i) => ({
        source: (words[i] as TimedWord).source,
        word: (words[i] as TimedWord).index,
      }));
    const first = words[anchor[0]] as TimedWord;
    return [
      {
        layout: answer.layout,
        anchor: { source: first.source, index: first.index },
        words: depends,
        seconds: answer.seconds,
        shows: answer.shows,
        html: answer.html,
        css: answer.css,
        sfx: answer.sfx,
      },
    ];
  });
}

/** Asks Claude for the edit's graphics, a request per window of at most WINDOW s. */
export async function writeGraphics(
  project: Project,
  projectPath: string,
  words: readonly TimedWord[],
  options: { claude: Claude; model: string; usage: Usage[]; progress: (m: string) => void },
): Promise<GraphicWish[]> {
  const context = await contextOf(project, projectPath);
  const edit = project.output.target.duration;
  const parts = Math.max(1, Math.ceil(edit / secondsToTicks(WINDOW)));
  const wishes: GraphicWish[] = [];
  const before = options.usage.length;
  for (let k = 0; k < parts; k++) {
    const from = Math.round((edit * k) / parts);
    const to = k === parts - 1 ? Number.MAX_SAFE_INTEGER : Math.round((edit * (k + 1)) / parts);
    // A request that fails leaves its stretch without graphics, its lines with the speaker.
    let reply: Awaited<ReturnType<Claude>>;
    try {
      reply = await options.claude({
        purpose: "graphics",
        model: options.model,
        system: systemPrompt(project.output),
        content: [{ type: "text", text: requestText(project, words, context, from, to) }],
        schema: answerSchema(project.output.aspect),
        effort: "medium",
        maxTokens: 64_000,
      });
    } catch (error) {
      options.progress(
        `Wrote no graphics for ${seconds(from)}–${seconds(Math.min(to, edit))} s: ${(error as Error).message}`,
      );
      continue;
    }
    options.usage.push(reply.usage);
    const answers = ((reply.json as { graphics?: Answer[] }).graphics ?? []).filter(
      (a) => project.output.aspect === "9:16" || a.layout !== "panel",
    );
    wishes.push(...wishesOf(answers, words, options.progress));
  }
  const spent = totalUsage(options.usage.slice(before)).dollars;
  options.progress(
    `${options.model} wrote ${wishes.length} graphics (${spent === null ? "cost unknown" : `$${spent.toFixed(4)}`})`,
  );
  return wishes;
}

/** A graphic placed on the edit, with the wish it came from. */
interface Placed {
  wish: GraphicWish;
  graphic: Graphic;
}

/**
 * Places each wish on the words the edit keeps: from LEAD s before its anchor is said, for as long
 * as it asked within its layout's range, until the next thing it may not overlap. One whose anchor
 * or quoted words were cut, that would come within GAP of the one before, start over something
 * taken or run shorter than its layout allows is left out, earliest first; so are full-frame
 * graphics past FULL_SHARE of the edit.
 */
export function placeGraphics(
  wishes: readonly GraphicWish[],
  words: readonly TimedWord[],
  edit: number,
  frame: number,
  taken: readonly { start: number; end: number }[],
  progress: (message: string) => void,
): Placed[] {
  const key = (source: string, index: number) => `${source}:${index}`;
  const timeOf = new Map(words.map((w) => [key(w.source, w.index), w.start]));
  const onFrame = (ticks: number) => Math.max(0, Math.round(ticks / frame) * frame);
  const left = (wish: GraphicWish, why: string, at?: number) =>
    progress(
      at === undefined
        ? `Left out a ${wish.layout} graphic: ${why}`
        : `Left out the ${wish.layout} graphic at ${seconds(at)} s: ${why}`,
    );
  const wanted = wishes.flatMap((wish) => {
    const said = timeOf.get(key(wish.anchor.source, wish.anchor.index));
    if (said === undefined) {
      left(wish, "the words it lands on were cut");
      return [];
    }
    if (wish.words.some((w) => !timeOf.has(key(w.source, w.word)))) {
      left(wish, "it shows words the edit no longer says", said);
      return [];
    }
    return [{ wish, start: onFrame(said - secondsToTicks(LEAD)) }];
  });
  wanted.sort((a, b) => a.start - b.start);
  const placed: Placed[] = [];
  let full = 0;
  for (const { wish, start } of wanted) {
    const range = GRAPHIC_SECONDS[wish.layout];
    const least = secondsToTicks(range.min);
    const before = placed.at(-1);
    if (before && start < before.graphic.start + before.graphic.duration + secondsToTicks(GAP)) {
      // A label gives way to a panel or a full-frame graphic that wants its time.
      const yields =
        isOverlayLayout(before.wish.layout) &&
        !isOverlayLayout(wish.layout) &&
        start >= before.graphic.start;
      if (!yields) {
        left(wish, "too close to the graphic before", start);
        continue;
      }
      placed.pop();
      left(
        before.wish,
        `it gives way to the ${wish.layout} graphic after it`,
        before.graphic.start,
      );
    }
    if (taken.some((t) => start < t.end && t.start < start + least)) {
      left(wish, "it would start over B-roll or an effect", start);
      continue;
    }
    const after = taken.filter((t) => t.start >= start).map((t) => t.start - secondsToTicks(GAP));
    const asked = Math.min(Math.max(wish.seconds, range.min), range.max);
    let end = Math.min(start + secondsToTicks(asked), edit, ...after);
    end = Math.floor(end / frame) * frame;
    if (end - start < least - frame / 2) {
      left(wish, "too little time before the edit ends or something it may not cover", start);
      continue;
    }
    if (wish.layout === "full") {
      if (full + end - start > FULL_SHARE * edit) {
        left(
          wish,
          `full-frame graphics would take more than ${FULL_SHARE * 100} % of the edit`,
          start,
        );
        continue;
      }
      full += end - start;
    }
    placed.push({
      wish,
      graphic: {
        layout: wish.layout,
        html: wish.html,
        css: wish.css,
        ...(wish.words.length > 0 ? { words: wish.words } : {}),
        start,
        duration: end - start,
      },
    });
  }
  return placed;
}

/** One graphic's check: what it must keep clear of over its frames, from the context. */
function checkJob(graphic: Graphic, project: Project, context: Context): GraphicCheckJob {
  const frame = ticksPerFrame(project.output.fps);
  const start = Math.round(graphic.start / frame);
  const end = Math.round((graphic.start + graphic.duration) / frame);
  const during = <T extends { start: number; end: number }>(list: readonly T[]) =>
    list.filter((item) => item.end > start && item.start < end);
  const area = graphicFrame(graphic.layout, project.output);
  return {
    layout: graphic.layout,
    html: graphic.html,
    css: graphic.css,
    output: project.output,
    frames: end - start,
    // A panel's own captions are those over it; a full-frame graphic's, all of them.
    captions: during(context.captions)
      .map((c) => c.box)
      .filter((b) => b.y < area.height),
    faces: isOverlayLayout(graphic.layout) ? during(context.faces).flatMap((f) => f.boxes) : [],
  };
}

/** The speech around a graphic, for its wording check. */
function speechNear(words: readonly TimedWord[], graphic: Graphic): string {
  const from = graphic.start - secondsToTicks(NEAR_BEFORE);
  const to = graphic.start + graphic.duration + secondsToTicks(NEAR_AFTER);
  return joinWords(words.filter((w) => w.start >= from && w.start < to).map((w) => w.text));
}

/** What is said while a graphic shows, and a second before. */
function speechDuring(words: readonly TimedWord[], graphic: Graphic): string {
  return joinWords(wordsDuring(words, graphic).map((w) => w.text));
}

/** The words said from a second before the graphic to its end. */
function wordsDuring(words: readonly TimedWord[], graphic: Graphic): TimedWord[] {
  const from = graphic.start - secondsToTicks(1);
  const to = graphic.start + graphic.duration;
  return words.filter((w) => w.start >= from && w.start < to);
}

/** A pause this long, or a sentence's end, closes a phrase. Seconds. */
const PHRASE_PAUSE = 0.25;

/** The phrases said while the graphic shows, each as its words read. */
function phrasesDuring(words: readonly TimedWord[], graphic: Graphic): string[] {
  const phrases: TimedWord[][] = [];
  let phrase: TimedWord[] = [];
  for (const word of wordsDuring(words, graphic)) {
    const last = phrase.at(-1);
    if (
      last &&
      (word.start - last.end >= secondsToTicks(PHRASE_PAUSE) || /[。？！?!.]$/.test(last.text))
    ) {
      phrases.push(phrase);
      phrase = [];
    }
    phrase.push(word);
  }
  if (phrase.length > 0) phrases.push(phrase);
  return phrases.map((p) => joinWords(p.map((w) => w.text)));
}

/** The stretches of an edit `edit` ticks long where nothing new comes into the picture for longer
 * than `most` seconds: no cut or shot change in `changes`, and no graphic starting or ending. */
export function stillStretches(
  changes: readonly number[],
  graphics: readonly { start: number; end: number }[],
  edit: number,
  most: number,
): { start: number; end: number }[] {
  const times = [...new Set([0, edit, ...changes, ...graphics.flatMap((g) => [g.start, g.end])])]
    .filter((t) => t >= 0 && t <= edit)
    .sort((a, b) => a - b);
  return times.slice(1).flatMap((end, i) => {
    const start = times[i] as number;
    return end - start > secondsToTicks(most) ? [{ start, end }] : [];
  });
}

/** One request for the graphics that failed their checks, each to be fixed, and for a graphic in
 * each still stretch, where one fits. */
async function fixGraphics(
  failing: { placed: Placed; problems: string[]; shot: Buffer | null }[],
  still: readonly { start: number; end: number }[],
  project: Project,
  words: readonly TimedWord[],
  options: { claude: Claude; model: string; usage: Usage[] },
): Promise<{ fixes: (Pick<GraphicWish, "html" | "css"> | null)[]; added: Answer[] }> {
  const content: Parameters<Claude>[0]["content"] = [];
  for (const [i, { placed, problems, shot }] of failing.entries()) {
    const { graphic, wish } = placed;
    if (shot) content.push({ type: "image", png: shot });
    content.push({
      type: "text",
      text: `Graphic ${i + 1}, a ${graphic.layout} from ${seconds(graphic.start)} to ${seconds(graphic.start + graphic.duration)} s (${wish.shows}). The speech around it: ${speechNear(words, graphic)}
Its problems, as drawn${shot ? " (the image above, at half size)" : ""}:
${problems.map((p) => `- ${p}`).join("\n")}
Its code: ${JSON.stringify({ html: graphic.html, css: graphic.css })}`,
    });
  }
  const [, most] = project.output.aspect === "9:16" ? CADENCE.portrait : CADENCE.landscape;
  if (still.length > 0) {
    content.push({
      type: "text",
      text: `In these stretches nothing new comes into the picture for longer than ${most} s:\n${still
        .map(
          (s) => `${seconds(s.start)}–${seconds(s.end)} s:\n${speechText(words, s.start, s.end)}`,
        )
        .join("\n\n")}`,
    });
  }
  content.push({
    type: "text",
    text: `${failing.length > 0 ? "Fix each graphic's problems and keep the rest of it: answer with the whole new html and css of each, in the order given, as graphics. " : "Answer with graphics empty. "}${still.length > 0 ? "In each still stretch, write one new graphic on the words that carry its point, as added, or none where nothing there is worth showing." : "Answer with added empty."}`,
  });
  try {
    const reply = await options.claude({
      purpose: "graphics",
      model: options.model,
      system: systemPrompt(project.output),
      content,
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["graphics", "added"],
        properties: {
          graphics: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["html", "css"],
              properties: { html: { type: "string" }, css: { type: "string" } },
            },
          },
          added: (answerSchema(project.output.aspect).properties as { graphics: object }).graphics,
        },
      },
      effort: "medium",
      maxTokens: 64_000,
    });
    options.usage.push(reply.usage);
    const json = reply.json as { graphics?: Pick<GraphicWish, "html" | "css">[]; added?: Answer[] };
    const fixed = json.graphics ?? [];
    return { fixes: failing.map((_, i) => fixed[i] ?? null), added: json.added ?? [] };
  } catch {
    return { fixes: failing.map(() => null), added: [] };
  }
}

/**
 * The project with its graphics: the wishes placed on its words, each checked as drawn against
 * its captions, faces and the speech near it. With `fix`, the ones that fail are sent back to
 * Claude once together, and their fixes kept in the wishes; one that still fails, or any that
 * fails without `fix`, is left out. A label's or lower third's box is where it was drawn. A
 * graphic that asks for a sound gets one on its first frame, at most one every SFX_EVERY s with
 * those already in the project.
 */
export async function withGraphics(
  project: Project,
  projectPath: string,
  wishes: GraphicWish[],
  words: readonly TimedWord[],
  options: {
    claude: Claude;
    model: string;
    usage: Usage[];
    progress: (message: string) => void;
    /** The speaker beside each split screen of these spans, as B-roll. */
    speakers: (spans: readonly { start: number; end: number; layout: string }[]) => BrollClip[];
    fix: boolean;
  },
): Promise<Project> {
  if (wishes.length === 0) return project;
  const frame = ticksPerFrame(project.output.fps);
  const edit = Math.round(project.output.target.duration / frame) * frame;
  const base = await contextOf(project, projectPath);
  let placed = placeGraphics(wishes, words, edit, frame, base.taken, options.progress);
  if (placed.length === 0) return project;
  // A panel splits the screen, with the speaker below it, and the captions move for it: they are
  // laid out with the graphics and their splits in place.
  const trial = (list: readonly Placed[]): Project => {
    const panels = list
      .filter((p) => p.graphic.layout === "panel")
      .map((p) => ({
        start: p.graphic.start,
        end: p.graphic.start + p.graphic.duration,
        layout: "panel",
      }));
    const broll = [...(project.broll ?? []), ...options.speakers(panels)];
    return {
      ...project,
      ...(broll.length > 0 ? { broll } : {}),
      ...(list.length > 0 ? { graphics: list.map((p) => p.graphic) } : {}),
    };
  };
  const browser = await chrome();
  const check = async (list: readonly Placed[]) => {
    const context = await contextOf(trial(list), projectPath);
    const results = await checkGraphics(
      list.map((p) => checkJob(p.graphic, project, context)),
      browser,
    );
    return results.map((result, i) => {
      const { graphic } = list[i] as Placed;
      const missing = unsaid(result.text, speechNear(words, graphic));
      const echoed =
        repeated(result.pieces, speechDuring(words, graphic)) ??
        restates(result.pieces, phrasesDuring(words, graphic));
      const brands = unnamed(graphic.html, speechNear(words, graphic));
      const problems = [
        ...result.problems,
        ...brands.map(
          (brand) => `It shows the ${brand} logo, but the speaker does not name ${brand} near it.`,
        ),
        ...(missing.length > 0
          ? [
              `It says ${missing.map((m) => `"${m}"`).join(", ")}, which the speaker does not say near it.`,
            ]
          : []),
        ...(echoed
          ? [
              `"${echoed}" repeats the sentence the captions show: give the keyword, number or list, not the sentence.`,
            ]
          : []),
      ];
      return { ...result, problems };
    });
  };
  let results = await check(placed);
  const failing = placed.flatMap((p, i) => {
    const r = results[i];
    return r && r.problems.length > 0 ? [{ placed: p, problems: r.problems, shot: r.shot }] : [];
  });
  // Where the picture would hold still too long for the edit's shape, Claude is asked for more.
  const [, most] = project.output.aspect === "9:16" ? CADENCE.portrait : CADENCE.landscape;
  const still = options.fix
    ? stillStretches(
        base.changes,
        placed.map((p) => ({ start: p.graphic.start, end: p.graphic.start + p.graphic.duration })),
        edit,
        most,
      )
    : [];
  if ((failing.length > 0 || still.length > 0) && options.fix) {
    const before = options.usage.length;
    const { fixes, added } = await fixGraphics(failing, still, project, words, options);
    for (const [i, fix] of fixes.entries()) {
      const { placed: item } = failing[i] as (typeof failing)[number];
      if (!fix) continue;
      // Kept in the wish, so the graphic stays fixed when the edit is fitted again.
      item.wish.html = fix.html;
      item.wish.css = fix.css;
      item.graphic.html = fix.html;
      item.graphic.css = fix.css;
    }
    if (added.length > 0) {
      const spent = totalUsage(options.usage.slice(before)).dollars;
      options.progress(
        `${options.model} wrote ${added.length} graphics (${spent === null ? "cost unknown" : `$${spent.toFixed(4)}`})`,
      );
      // Kept in the wishes, so they stay when the edit is fitted again; checked with the rest,
      // and left out without another request when they fail.
      wishes.push(...wishesOf(added, words, options.progress));
      placed = placeGraphics(wishes, words, edit, frame, base.taken, options.progress);
    }
    results = await check(placed);
  }
  const kept: Placed[] = [];
  for (const [i, p] of placed.entries()) {
    const result = results[i];
    if (!result || result.problems.length > 0) {
      options.progress(
        `Left out the ${p.wish.layout} graphic at ${seconds(p.graphic.start)} s: ${result?.problems.join(" ") ?? "it was not checked"}`,
      );
      continue;
    }
    if (isOverlayLayout(p.graphic.layout)) {
      if (!result.box) continue;
      const { width, height } = project.output;
      p.graphic.box = {
        x: result.box.x / width,
        y: result.box.y / height,
        w: result.box.width / width,
        h: result.box.height / height,
      };
    }
    kept.push(p);
  }
  placed = kept;
  options.progress(`Kept ${placed.length} of ${wishes.length} graphics`);
  const sfx = await graphicSounds(placed, project, projectPath);
  const done = trial(placed);
  return {
    ...done,
    sources: [...project.sources, ...sfx.sources] as Project["sources"],
    audio: {
      ...project.audio,
      ...(sfx.effects.length + (project.audio.sfx?.length ?? 0) > 0
        ? { sfx: [...(project.audio.sfx ?? []), ...sfx.effects].sort((a, b) => a.start - b.start) }
        : {}),
    },
  };
}

/** A sound's attack rings on this long; with a cut in it, or just before it, the splice no longer
 * shows as clean in the mix (vebench render counts it as a click). Seconds. */
const SOUND_RING = 0.5;
const SOUND_BEFORE = 0.1;

/** The sounds the graphics ask for, at most one every SFX_EVERY s with the project's own, and
 * none with a cut within its first SOUND_RING s. */
async function graphicSounds(
  placed: readonly Placed[],
  project: Project,
  projectPath: string,
): Promise<{ sources: Project["sources"][number][]; effects: SoundEffect[] }> {
  const folder = dirname(projectPath);
  const taken = (project.audio.sfx ?? []).map((s) => s.start);
  const sources: Project["sources"][number][] = [];
  const effects: SoundEffect[] = [];
  const ids = new Map<string, string>();
  const every = secondsToTicks(SFX_EVERY);
  // Where the main track's clips join, on the output timeline.
  const cuts: number[] = [];
  let at = 0;
  for (const clip of project.main) {
    if (at > 0) cuts.push(at);
    at += clip.out - clip.in;
  }
  const near = (start: number) =>
    cuts.some(
      (cut) =>
        cut >= start - secondsToTicks(SOUND_BEFORE) && cut <= start + secondsToTicks(SOUND_RING),
    );
  let nth = 0;
  for (const { wish, graphic } of placed) {
    if (wish.sfx === "none") continue;
    if (taken.some((t) => Math.abs(t - graphic.start) < every) || near(graphic.start)) continue;
    const sound = pickSfx(wish.sfx, nth++);
    let id = ids.get(sound.path);
    if (!id) {
      id = `graphic-sfx-${ids.size + 1}`;
      ids.set(sound.path, id);
      sources.push({
        id,
        kind: "audio",
        path: await visualPath(folder, sound.path),
        fingerprint: await fingerprintOf(sound.path),
        credit: projectCredit(sfxCredit(sound.path, sound.source)),
      });
    }
    effects.push({ source: id, start: graphic.start, gainDb: SFX_GAIN[wish.sfx] });
    taken.push(graphic.start);
  }
  return { sources, effects };
}
