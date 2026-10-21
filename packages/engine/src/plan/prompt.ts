// The planner's instructions and the shape of its answer.

import { catalog, type TemplateId } from "@video-editor/effects";
import { DEFAULT_FILLERS, type FillerMode } from "./fillers.ts";
import type { CalloutWish } from "./locate.ts";
import { SFX_WISHES, type VisualWish } from "./visuals.ts";

/** The most characters a template's text param takes, as its schema in the catalog allows. */
const most = (id: TemplateId, param: string) =>
  (catalog[id].params as { properties: Record<string, { maxLength?: number }> }).properties[param]
    ?.maxLength;

/** The planner's instructions, which tell of chapters only when the request may ask for them,
 * of callouts only when a file has a screen recording, of visuals only when the edit is rich
 * with them and of the fillers the mode cuts; the same for every plan of either kind, so it is
 * cached with the transcripts after it. */
export function planSystem(
  extras: Pick<PlanExtras, "chapters" | "callouts"> &
    Partial<Pick<PlanExtras, "visuals" | "stock" | "fillers">>,
): string {
  return (
    system(
      (extras.chapters ? CHAPTERS_EFFECT : "") + (extras.callouts ? CALLOUTS_EFFECT : ""),
      extras.fillers ?? DEFAULT_FILLERS,
    ) + (extras.visuals ? visualsSection(extras.stock ?? false) : "")
  );
}

/** What a filler mark means, by mode; off marks none. */
const MARKS: Record<FillerMode, string> = {
  natural: `⟨f3 嗯⟩ marks a possible filler: a hesitation, or words said again at once \
(⟨f4 我⟩我媽); f3 is its id. `,
  aggressive: `⟨f3 嗯⟩ marks a possible filler: a hesitation, words said again at once \
(⟨f4 我⟩我媽), or a word that is often a verbal tic (⟨f5 然後⟩); f3 is its id. `,
  off: "",
};

const CLEAR_FILLERS = `- fillers: ids of marked words to cut: hesitations, which 嗯, 呃 and um almost always \
are, and stutters, the first of words said twice (the first 我 of 我我媽, the first the of the \
the). Keep a repeat that is one word, said for emphasis or two different words (謝謝, 慢慢, \
最最最, 對對對 agreeing, 差不多，多一點).`;

const CUT_WORDS = (missed: string) => `- cut_words: words inside a line to cut. ${missed} the \
marks missed, such as a hesitation the speech model wrote as another character at the start of \
a sentence (您大家好 for 嗯，大家好), or a false start the speaker restarts within the line \
(第一件事是剪輯，不對， before 第一件事是自動剪輯). Give the file, the line, the text exactly as \
it appears in the line, and which kind it is.`;

/** The answer's fillers and cut_words, by mode. */
const FILLERS: Record<FillerMode, string> = {
  natural: `${CLEAR_FILLERS}
${CUT_WORDS("A hesitation or stutter")}`,
  aggressive: `${CLEAR_FILLERS} Also cut each marked tic (啊, 喔, 欸, 那個, 這個, 就是, 然後, 對, \
like, you know, I mean, so opening a sentence, basically) that adds nothing where it is said, \
and keep it where it carries meaning: 那個 click 聲 means "that click", 然後 can order two \
events, 對 can answer a question, and like can mean to enjoy or to be similar.
${CUT_WORDS("A filler")}`,
  off: `- fillers and cut_words: always empty: the user keeps every word said, fillers and false \
starts included.`,
};

/** How the planner proposes B-roll for each point: stock footage when a key allows it, or a web
 * capture of a page the speaker names. Motion graphics are written once the cut is known. */
function visualsSection(stock: boolean): string {
  const kinds = [
    ...(stock
      ? [
          "stock: real footage of the thing named, when it is a physical thing, place or scene \
(the Sun, a satellite, a server room, a city at night). Give a search query in English of two \
to four plain words for a stock footage library; the footage must show the thing itself, not \
a person at a computer.",
        ]
      : []),
    "web: the real page of a product, model, project, paper or organisation the speaker names in \
that line, captured and zoomed into the part talked about. Give its own address (https://…), one \
you are sure exists, such as a product's page or a model's page on Hugging Face, never a search \
page, a home page that only advertises, or a guessed deep link, and the words on that page to \
zoom into exactly as the page writes them (its name, a heading, a price, a number). Never a page \
for a place or brand mentioned in passing (meeting at a café is not about the café).",
  ];
  return `

## Visuals

The edit cuts away from the speaker to show the real thing they talk about. Offer a visual \
only where they name it: code keeps those on lines the length keeps, at most one every 5 seconds, \
and motion graphics for numbers, lists and comparisons are added once the cut is known, so leave \
those to them. Give each on the line and the words it lands on, exactly as they appear in the \
line, words that name the thing: code cuts to it as the first of those words is said and back to \
the speaker a few seconds later, picks a full-frame or split-screen layout and leaves out what \
does not fit. Prefer, in this order:
${kinds.map((kind, i) => `${i + 1}. ${kind}`).join("\n")}

Give the visuals as one JSON array in the visuals string, [] for none, each an object with \
these keys, every value a string except line: source and line, the line it lands on; text, the \
words it lands on; kind, ${kinds.length === 2 ? '"stock" or "web"' : '"web"'}; query, the stock \
search in English; url, the page's address; focus, the words on the page to zoom into; name, \
the product or site's name exactly as the speaker says it in the line, which code checks; sfx, \
"none" or one of ${SFX_WISHES.map((s) => `"${s}"`).join(", ")}; and reason. Leave the keys of \
other kinds empty.

sfx: a sound only on a visible action, and none for most visuals: click for a small piece of UI \
(a search, a chat, a terminal), paper for a document. Never whoosh on a cut.`;
}

const CHAPTERS_EFFECT = `
- chapters, when the request asks for them: ${catalog.chapter.purpose} \
${catalog.chapter.whenToUse} Avoid: ${catalog.chapter.avoid} Name each chapter in at most \
${most("chapter", "title")} characters, and give the file and line that opens it: the first \
line of a segment, the first chapter opening the video. List them in play order, or none when \
the edit has no distinct sections. Code numbers them, joins a section under 30 s to the one \
before, and hides the cut into each chapter with a wipe.`;

const CALLOUTS_EFFECT = `
- callouts, on screen recordings (a file's header says when it shows one): \
${catalog.callout.purpose} ${catalog.callout.whenToUse} Avoid: ${catalog.callout.avoid} Only \
where a viewer would otherwise hunt for the thing, at most one every 20 seconds, and none when \
nothing is pointed at. Give the file, the line, the words that name the thing exactly as they \
appear in it, what to look for on screen in a few words in English (the Save button, the API \
key field), and a label of at most ${most("callout", "label")} characters in the speaker's \
language, or an empty one. Code finds the thing on the frame shown as it is named, and leaves \
the callout out when it is not there or does not hold still.`;

const system = (effects: string, fillers: FillerMode) => `\
You are the editor in an automatic video editor. You read the transcripts of raw footage and \
decide what the finished video uses and in what order. Code then does the precise work: it \
cuts on word boundaries inside pauses, removes the fillers you confirm, shortens dead air, \
leaves a breath at every join, and fits the length. So you never give times; you choose \
transcript lines.

## The footage

Each file starts with a header: its length, picture, how much of it is speech, its long \
pauses, its loudness peaks and audio events (laughter, applause, music). Then come its lines, \
numbered within the file:

12 [034.20-038.95] text

A line is a phrase between pauses of 0.5 s or more, or a sentence. Times are seconds into that \
file. The transcript comes from a speech model: it mishears some words, and writes Chinese in \
Taiwan Traditional characters. ${MARKS[fillers]}A file without speech is B-roll: pictures to \
show over a long talking stretch.

## What you decide

- segments: what the video plays, in play order. Each is a run of consecutive lines of one \
file. Order by story, not by file name or recording order: a hook recorded last can open the \
video. Give each a priority from 1 to 5: 1 means the video falls apart without it, 5 is a \
nice-to-have. When the edit runs long, code drops the highest numbers first, the later one \
among equals, or keeps only the first lines of a segment when dropping all of it would \
undershoot. So put setup before payoff inside a segment, and split a segment where its second \
half could go on its own.
- removed: lines you leave out on purpose, with the reason: retake (an attempt at a line that \
is said again; keep the best take, usually the last complete one, and remove the others), \
mistake (a slip, a false start, an abandoned sentence, a correction such as 不對，我重講), \
off_topic, or other. A line is never both in a segment and removed.
${FILLERS[fillers]}
- broll: shots from B-roll files to show over long talking stretches, each over one line of a \
segment; empty when there is no B-roll. Give the B-roll file, the seconds of it to show (2 to \
8 s), and the file and line it covers.
- emphasis: the strongest beats of the edit, about one every 15 to 30 seconds: a key number, a \
punchline, the promise of the video. Give the file, the line and the words exactly as they \
appear in it. Code pushes the picture in there.
- content: in two or three sentences, what the footage is and the story the edit tells.

## Length

The request says which kind of edit to make.

A short edit picks the strongest self-contained moments. Weigh each candidate on:
1. Hook: does it open with something that stops the scroll within the first three seconds? \
Dead air, a filler or a continuation is weak; a bold claim, a surprising number or a direct \
question is strong.
2. Standalone: can a viewer follow it with no context from the rest of the footage? "As I said \
earlier" is weak; a complete idea is strong.
3. Arc: does it hold a setup and a payoff: a build-up to a punchline, a problem to a solution, \
a question to an answer?
4. Ending: does it end on a completed thought or a strong line, never mid-sentence?
Open on the strongest hook, and never start or end a segment mid-thought.

A long edit keeps the whole story: every point the footage makes, once, in story order, with \
the best take of each. Drop content only when the footage runs well past the target, least \
important points first.

Pick about 1.25 times the target in lines when the footage has that much, so code can trim to \
the length by priority.

## Effects

Animated text over the picture marks what the viewer must notice or remember, so most of the \
edit has none. Code times each effect on the speech, shows one at a time and drops what does \
not fit.
- title, when the request asks for one: ${catalog.title.purpose} It shows over the edit's \
opening. A short phrase of at most ${most("title", "text")} characters in the video's language, \
and optionally a subtitle of at most ${most("title", "subtitle")} that says what the viewer gets; \
an empty text for none.
- people, when the request lists names: ${catalog["lower-third"].purpose} \
${catalog["lower-third"].whenToUse} Only for a person on camera whose name is in the list, \
spelled as there, with their role when the footage says it (at most \
${most("lower-third", "role")} characters), and the line where they first speak in the edit. \
Never guess a name.${effects}

## Music

When the request lists music tracks, choose the one whose mood fits what is said and how: \
judge by its name, tempo and how loud its sections are. Give the section the edit should open \
on, counted from 1: a quiet one under a calm or serious talk, a full one under an energetic \
one. Code places it under the speech, ducks it while anyone speaks, loops or shortens it on \
its phrases to the length, and ends it on its own ending. Answer an empty track when none \
fits.`;

const lineRange = {
  source: { type: "string", description: "File id, as in its header." },
  first: { type: "integer", description: "First line number." },
  last: { type: "integer", description: "Last line number, inclusive." },
};

/** The planner's answer, as a JSON Schema for structured output. */
const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["content", "segments", "removed", "fillers", "cut_words", "broll", "emphasis"],
  properties: {
    content: { type: "string" },
    segments: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source", "first", "last", "priority", "reason"],
        properties: {
          ...lineRange,
          priority: { type: "integer", enum: [1, 2, 3, 4, 5] },
          reason: { type: "string" },
        },
      },
    },
    removed: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source", "first", "last", "kind", "reason"],
        properties: {
          ...lineRange,
          kind: { type: "string", enum: ["retake", "mistake", "off_topic", "other"] },
          reason: { type: "string" },
        },
      },
    },
    fillers: { type: "array", items: { type: "string" } },
    cut_words: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source", "line", "text", "kind"],
        properties: {
          source: { type: "string" },
          line: { type: "integer" },
          text: { type: "string" },
          kind: { type: "string", enum: ["filler", "false_start"] },
        },
      },
    },
    broll: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["broll", "start", "end", "source", "line", "reason"],
        properties: {
          broll: { type: "string", description: "B-roll file id." },
          start: { type: "number", description: "Seconds into the B-roll file." },
          end: { type: "number" },
          source: { type: "string", description: "File of the line it covers." },
          line: { type: "integer" },
          reason: { type: "string" },
        },
      },
    },
    emphasis: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source", "line", "text", "reason"],
        properties: {
          source: { type: "string" },
          line: { type: "integer" },
          text: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

const TITLE = {
  type: "object",
  additionalProperties: false,
  required: ["text", "subtitle"],
  properties: {
    text: { type: "string", description: "The title, or empty for none." },
    subtitle: { type: "string", description: "A line under it, or empty." },
  },
} as const;

const CHAPTERS = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["title", "source", "line"],
    properties: {
      title: { type: "string" },
      source: { type: "string", description: "File of the line that opens the chapter." },
      line: { type: "integer" },
    },
  },
} as const;

const CALLOUTS = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["source", "line", "text", "target", "label", "reason"],
    properties: {
      source: { type: "string" },
      line: { type: "integer" },
      text: { type: "string", description: "The words that name the thing, as in the line." },
      target: { type: "string", description: "What to look for on screen." },
      label: { type: "string", description: "A short label beside it, or empty." },
      reason: { type: "string" },
    },
  },
} as const;

const PEOPLE = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["name", "role", "source", "line"],
    properties: {
      name: { type: "string", description: "As in the list of names." },
      role: { type: "string", description: "Their role, or empty." },
      source: { type: "string", description: "File of the line where they first speak." },
      line: { type: "integer" },
    },
  },
} as const;

/** What a plan may hold besides the edit itself: a music choice when tracks are offered, a title
 * for a long edit, chapters for one of two minutes or more, lower thirds when names are given,
 * callouts when a file has a screen recording and visuals for a rich edit, stock footage among
 * them when a key allows it. */
export interface PlanExtras {
  music: boolean;
  title: boolean;
  chapters: boolean;
  people: boolean;
  callouts: boolean;
  visuals?: boolean;
  stock?: boolean;
  /** Which fillers the planner cuts: DEFAULT_FILLERS unless given. */
  fillers?: FillerMode;
}

/** The visuals in the plan's schema, stock footage only when it can be searched. */
/** The visuals in the plan's schema: one JSON string, read and checked by `parseVisuals`. */
const VISUALS = {
  type: "string",
  description: "The visuals as a JSON array, [] for none.",
} as const;

/** The plan's schema, with the extras offered. */
export function planSchema(extras: PlanExtras): Record<string, unknown> {
  const required: string[] = [...PLAN_SCHEMA.required];
  const properties: Record<string, unknown> = { ...PLAN_SCHEMA.properties };
  if (extras.music) {
    required.push("music");
    properties.music = {
      type: "object",
      additionalProperties: false,
      required: ["track", "section", "reason"],
      properties: {
        track: { type: "string", description: "Track id, or empty for no music." },
        section: { type: "integer", description: "The section to open on, from 1." },
        reason: { type: "string" },
      },
    };
  }
  if (extras.title) {
    required.push("title");
    properties.title = TITLE;
  }
  if (extras.chapters) {
    required.push("chapters");
    properties.chapters = CHAPTERS;
  }
  if (extras.people) {
    required.push("people");
    properties.people = PEOPLE;
  }
  if (extras.callouts) {
    required.push("callouts");
    properties.callouts = CALLOUTS;
  }
  if (extras.visuals) {
    required.push("visuals");
    properties.visuals = VISUALS;
  }
  return { ...PLAN_SCHEMA, required, properties };
}

/** The planner's answer as structured output returns it. */
export interface Decisions {
  content: string;
  segments: { source: string; first: number; last: number; priority: number; reason: string }[];
  removed: {
    source: string;
    first: number;
    last: number;
    kind: "retake" | "mistake" | "off_topic" | "other";
    reason: string;
  }[];
  fillers: string[];
  cut_words: { source: string; line: number; text: string; kind: "filler" | "false_start" }[];
  broll: {
    broll: string;
    start: number;
    end: number;
    source: string;
    line: number;
    reason: string;
  }[];
  emphasis: { source: string; line: number; text: string; reason: string }[];
  /** Present when music was offered. */
  music?: { track: string; section: number; reason: string };
  /** Present for a long edit; an empty text is no title. */
  title?: { text: string; subtitle: string };
  /** Present for an edit of two minutes or more, in play order; empty for none. */
  chapters?: { title: string; source: string; line: number }[];
  /** Present when names were given: a lower third for each. */
  people?: { name: string; role: string; source: string; line: number }[];
  /** Present when a file has a screen recording: what to point at, and where it is named. */
  callouts?: CalloutWish[];
  /** Present for a rich edit: what to show over each point. */
  visuals?: VisualWish[];
}

/** What the request asks for after the cached transcripts; `music` lists the tracks offered. */
export function planRequest(options: {
  target: number;
  aspect: string;
  short: boolean;
  speech: number;
  music?: string;
  /** A title is asked for. */
  title?: boolean;
  /** Chapters are asked for. */
  chapters?: boolean;
  /** Names the user gave, which lower thirds may show. */
  names?: readonly string[];
  /** What the user asks of this edit, in their words. */
  instructions?: string;
  /** What the edit is about: a short's title and description. */
  about?: string;
}): string {
  const { target, aspect, short, speech, music, title, chapters, names, instructions } = options;
  const kind = short
    ? "a short edit: the strongest self-contained moments"
    : "a long edit: the whole story";
  return [
    `Make ${kind}.`,
    `Target length: ${target.toFixed(0)} s (±5 %), aspect ${aspect}.`,
    `The files hold ${speech.toFixed(0)} s of speech before fillers and pauses are removed.`,
    ...(options.about ? [`This short is about: ${options.about}`] : []),
    ...asks(title, chapters, names, instructions),
    ...(music ? ["", music] : []),
  ].join("\n");
}

/** The lines asking for a title and chapters, listing the names and passing on what the user
 * asks, in every request for the plan. */
function asks(
  title?: boolean,
  chapters?: boolean,
  names?: readonly string[],
  instructions?: string,
): string[] {
  return [
    ...(title ? ["Give the video a title over its opening."] : []),
    ...(chapters ? ["Divide the video into chapters."] : []),
    ...(names?.length
      ? [`Names the user gave, of people and terms said in the footage: ${names.join("; ")}.`]
      : []),
    ...(instructions
      ? [
          "What the user asks of this edit, in their own words; follow it as far as the footage, " +
            "the target length and the rules above allow:",
          `<instructions>\n${instructions}\n</instructions>`,
        ]
      : []),
  ];
}

/** Asks for more material after code fitted the first answer and it came out short. */
export function moreRequest(
  previous: Decisions,
  length: number,
  target: number,
  extras: {
    music?: string;
    title?: boolean;
    chapters?: boolean;
    names?: readonly string[];
    instructions?: string;
  } = {},
): string {
  const { music, title, chapters, names, instructions } = extras;
  const asked = asks(title, chapters, names, instructions);
  return [
    `Your selection below lasts ${length.toFixed(1)} s once code removed its fillers and pauses, \
short of the ${target.toFixed(0)} s target.`,
    "Answer again with the whole selection, adding lines you left out, unless they are retakes \
or mistakes, until it holds about 1.25 times the target.",
    ...(asked.length > 0 ? [asked.join("\n")] : []),
    ...(music ? [music] : []),
    JSON.stringify(previous),
  ].join("\n\n");
}

/** Cut checks: the same for every cut. Too short to cache. */
export const CHECK_SYSTEM = `\
You check one cut in an automatically edited video. You get a picture of the two seconds \
around the cut: frames across the top, and below them the sound's waveform, with the cut marked \
by a red line and silence shaded blue. You also get the words just before and after the cut.

Report a problem only if a viewer would notice it:
- clipped_word: a word cut off at the cut. The waveform runs into the red line at full height \
on either side, or the words read broken.
- broken_sentence: the words before and after the cut do not join into sense.
- long_silence: more than about a second of silence at the cut.
- bad_picture: a black, frozen or half-dissolved frame right at the cut.
A jump cut between two parts of the same talking shot is normal and not a problem.

Then pick a fix: more_room (the right words are kept, but one is clipped: keep more of the \
silence on both sides of the cut), move_earlier (end the clip before the cut a word earlier, \
when its last word is broken or wrong), move_later (start the clip after the cut a word later), \
drop_before or drop_after (leave out that whole clip), or none. Say how sure you are, from 0 \
to 1.`;

export const CHECK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["problem", "fix", "confidence", "reason"],
  properties: {
    problem: {
      type: "string",
      enum: ["none", "clipped_word", "broken_sentence", "long_silence", "bad_picture"],
    },
    fix: {
      type: "string",
      enum: ["none", "more_room", "move_earlier", "move_later", "drop_before", "drop_after"],
    },
    confidence: { type: "number" },
    reason: { type: "string" },
  },
} as const;

export interface CutVerdict {
  problem: "none" | "clipped_word" | "broken_sentence" | "long_silence" | "bad_picture";
  fix: "none" | "more_room" | "move_earlier" | "move_later" | "drop_before" | "drop_after";
  confidence: number;
  reason: string;
}
