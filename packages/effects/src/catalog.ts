// The effect templates as the planner reads them: what each is for, when it serves the story,
// how long it runs and which parameters it takes, as a JSON Schema per template.

import { projectSchema, type Rect } from "@video-editor/schema";

/** `#rrggbb`, or the template's default. */
type Color = string;

// Types, not interfaces, so params pass as project.json's open `params` record.
export type TitleParams = {
  text: string;
  subtitle?: string;
  accent?: Color;
};
export type LowerThirdParams = {
  name: string;
  role?: string;
  accent?: Color;
};
export type KeywordParams = {
  text: string;
  position?: "upper" | "lower";
  accent?: Color;
};
export type ChapterParams = {
  title: string;
  index: number;
  total: number;
  accent?: Color;
};
export type CalloutParams = {
  rect: Rect;
  label?: string;
  dim?: boolean;
  accent?: Color;
};
export type WipeParams = {
  direction?: "left" | "right" | "up" | "down";
  color?: Color;
  accent?: Color;
};

export interface TemplateParams {
  title: TitleParams;
  "lower-third": LowerThirdParams;
  keyword: KeywordParams;
  chapter: ChapterParams;
  callout: CalloutParams;
  wipe: WipeParams;
}
export type TemplateId = keyof TemplateParams;

export interface Template<P> {
  /** What the effect says to the viewer. */
  purpose: string;
  /** The moments in an edit it serves. */
  whenToUse: string;
  /** Where it does not belong. */
  avoid: string;
  /** Where its `start` goes relative to the speech or the cut it marks. */
  timing: string;
  /** How long it runs: the shortest its motion allows, a typical length and the longest. */
  seconds: { min: number; typical: number; max: number };
  /** A JSON Schema (draft 2020-12) for its `params`. */
  params: object;
  example: P;
}

export const accent = {
  description: "The accent colour, `#rrggbb`; leave it out for the house amber.",
  type: "string",
  pattern: "^#[0-9a-fA-F]{6}$",
} as const;

/** Text the templates draw on one or two lines, so its length is capped. */
export const text = (description: string, maxLength: number) =>
  ({ description, type: "string", minLength: 1, maxLength, pattern: "\\S" }) as const;

export const object = (properties: Record<string, object>, required: string[]) => ({
  type: "object",
  additionalProperties: false,
  required,
  properties,
});

export const catalog: { [Id in TemplateId]: Template<TemplateParams[Id]> } = {
  title: {
    purpose: "Names the video or a major section in large type at the centre of the frame.",
    whenToUse:
      "The opening seconds, over a hook or establishing shot, and the start of a major section " +
      "in a long edit.",
    avoid: "Over a face mid-sentence; more than one per section.",
    timing: "Starts as the section's first sentence starts, or over the pause just before it.",
    seconds: { min: 1.6, typical: 3, max: 6 },
    params: object(
      {
        text: text("The title, in the video's language; a short phrase, not a sentence.", 24),
        subtitle: text("A line under the title that says what the viewer gets.", 40),
        accent,
      },
      ["text"],
    ),
    example: { text: "三分鐘看懂 TypeScript 型別", subtitle: "從零開始的實戰筆記" },
  },
  "lower-third": {
    purpose: "Identifies a person on screen: their name and, optionally, their role.",
    whenToUse: "The first time each person speaks on camera, once their face is settled in shot.",
    avoid: "A second time for the same person; over screen recordings with no one on camera.",
    timing: "Starts about 1 s after the person begins speaking in their first shot.",
    seconds: { min: 2, typical: 4, max: 8 },
    params: object(
      {
        name: text("The person's name as they want it shown.", 16),
        role: text("Their role or affiliation, short.", 28),
        accent,
      },
      ["name"],
    ),
    example: { name: "林語安", role: "前端工程師 · Frontend Engineer" },
  },
  keyword: {
    purpose: "Pops the one word or number a sentence turns on, as a highlighter swipe.",
    whenToUse:
      "The one to three claims per minute that carry the argument: a result, a number, a " +
      "term the viewer must remember.",
    avoid: "Every sentence, filler words, or words the captions already make obvious.",
    timing: "Starts 0.15 s before the spoken word, so the swipe lands as it is said.",
    seconds: { min: 0.8, typical: 1.5, max: 3 },
    params: object(
      {
        text: text("The word or short phrase exactly as spoken, or the number.", 12),
        position: {
          description:
            "upper: the top of the frame, clear of a speaker's chest; lower: just above the " +
            "captions, which at 9:16 is a talking head's chin, so only for shots with no one on camera.",
          type: "string",
          enum: ["upper", "lower"],
          default: "upper",
        },
        accent,
      },
      ["text"],
    ),
    example: { text: "效能提升 3 倍" },
  },
  chapter: {
    purpose: "Marks where a new chapter starts and how far through the video it is.",
    whenToUse: "Edits over about two minutes with three or more distinct sections.",
    avoid: "Short edits, or sections under 30 s.",
    timing: "Starts with the chapter's first sentence; pair it with a wipe at the cut before.",
    seconds: { min: 2, typical: 3.5, max: 6 },
    params: object(
      {
        title: text("The chapter's name.", 20),
        index: { description: "This chapter's number, from 1.", type: "integer", minimum: 1 },
        total: {
          description: "How many chapters the video has.",
          type: "integer",
          minimum: 1,
          maximum: 12,
        },
        accent,
      },
      ["title", "index", "total"],
    ),
    example: { title: "環境設定", index: 2, total: 5 },
  },
  callout: {
    purpose: "Draws the eye to one region of the frame: outlines it and dims the rest.",
    whenToUse:
      "Screen recordings, when the speaker refers to a button, a line of code or a number on " +
      "screen.",
    avoid: "Talking-head shots; regions that move during the callout.",
    timing: "Starts 0.3 s before the speaker names the thing it points at.",
    seconds: { min: 1.5, typical: 3, max: 8 },
    params: object(
      {
        rect: {
          ...projectSchema.$defs.Rect,
          description: "The region, as fractions of the output frame from its top-left corner.",
        },
        label: text("A short label beside the region.", 20),
        dim: {
          description: "Dims the frame outside the region.",
          type: "boolean",
          default: true,
        },
        accent,
      },
      ["rect"],
    ),
    example: { rect: { x: 0.266, y: 0.297, w: 0.625, h: 0.064 }, label: "影片會輸出到這裡" },
  },
  wipe: {
    purpose: "A band that sweeps across the frame and covers it for a moment, hiding the cut.",
    whenToUse: "A change of topic or chapter, where the edit should feel like a new page.",
    avoid: "Ordinary jump cuts; more than one every 30 s.",
    timing:
      "Centred on the cut: start = cut - duration / 2. The frame is fully covered for the " +
      "middle 12 % of it.",
    seconds: { min: 0.4, typical: 0.6, max: 1 },
    params: object(
      {
        direction: {
          description: "The way the band travels.",
          type: "string",
          enum: ["left", "right", "up", "down"],
          default: "right",
        },
        color: { ...accent, description: "The band's colour, `#rrggbb`; near-black without it." },
        accent: { ...accent, description: "Its leading edge's colour, `#rrggbb`." },
      },
      [],
    ),
    example: { direction: "right" },
  },
};

export const templateIds = Object.keys(catalog) as TemplateId[];

export function isTemplateId(id: string): id is TemplateId {
  return Object.hasOwn(catalog, id);
}

/**
 * How the planner places effects, beside each template's own `whenToUse`: effects serve the
 * story, so most cuts get none.
 */
export const guidance = [
  "Effects mark what the viewer must notice or remember; most cuts get no effect.",
  "Place an effect only where its template's whenToUse fits the content at that moment.",
  "At most two overlays on screen at once, and never two of the same template.",
  "At 9:16 the lower third, the chapter marker and an upper keyword all sit at the top of the " +
    "frame, so none of them overlaps another in time there.",
  "Write every text param in the language the speaker uses at that point; Traditional Chinese " +
    "for Mandarin.",
];
