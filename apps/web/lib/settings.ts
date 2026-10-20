// What the page asks for, checked the same way in the browser and on the server.
import {
  CAPTION_STYLES,
  type CaptionStyle,
  DEFAULT_CAPTIONS,
  isCaptionStyle,
} from "@video-editor/engine/captions";
import { LENGTH_RANGE, parseLength, SHORTS_COUNT, SHORTS_RANGE } from "@video-editor/engine/length";
import { type LookId, lookIds } from "@video-editor/engine/looks";
import { kindOf } from "@video-editor/engine/media";
import { en, type Messages } from "./i18n/en.ts";

/** The captions' style (`--captions`): bold, creator, minimal, pop or none. */
export { CAPTION_STYLES, DEFAULT_CAPTIONS, LENGTH_RANGE, parseLength };

export const ASPECTS = ["9:16", "1:1", "16:9"] as const;
export type Aspect = (typeof ASPECTS)[number];

/** Seconds: a short, two social lengths, and two longer edits. Any other length is typed. */
export const LENGTH_PRESETS = [15, 30, 60, 180, 600] as const;

/** The ranges a short's length can lie in, in seconds, and the one chosen unless another is. */
export const SHORT_RANGES = [
  [15, 30],
  [30, 60],
  [60, 90],
  [90, 180],
] as const;
export const DEFAULT_SHORT_RANGE = SHORT_RANGES[1];
/** How many shorts a run makes unless another number is chosen. */
export const DEFAULT_SHORTS = 5;
export { SHORTS_COUNT };

/** Names and terms are each a hint for the speech model; a few hundred is far more than it
 * reads. */
const MAX_NAMES = 200;
const MAX_NAME_LENGTH = 100;
export const MAX_LICENSE_LENGTH = 200;

/** The longest instructions, as `pnpm edit --instructions` takes them. */
export const INSTRUCTIONS_MAX = 2000;

/** The edit's style: one of the engine's looks, or the footage's own colour. */
export type Style = LookId | "none";
export const STYLES: readonly Style[] = [...lookIds, "none"];
export const DEFAULT_STYLE: Style = "clean";

export function styleName(style: Style, t: Messages = en): string {
  return t.looks[style]?.name ?? style;
}

/** A caption style's name. One 0.4.0 had and this version does not (spotlight, sweep, boxed)
 * now renders as bold, and is named so. */
export function captionStyleName(id: string, t: Messages = en): string {
  return t.captions[isCaptionStyle(id) ? id : DEFAULT_CAPTIONS].name;
}

/** Where the speech is heard: by the model on this computer, or on OpenRouter (`--asr cloud`). */
const ASRS = ["local", "cloud"] as const;
export type Asr = (typeof ASRS)[number];

/** What Claude adds over the footage (`--visuals`): B-roll, layouts and sound effects, or none. */
export const VISUALS = ["rich", "minimal"] as const;
export type Visuals = (typeof VISUALS)[number];
export const DEFAULT_VISUALS: Visuals = "rich";

/** The model that plans (`--quality`): Claude Opus, or Claude Sonnet for about half the cost. */
export const QUALITIES = ["best", "economy"] as const;
export type Quality = (typeof QUALITIES)[number];

export interface Settings {
  /** Seconds, LENGTH_RANGE inclusive. */
  length: number;
  aspect: Aspect;
  style: Style;
  /** People's names said in the footage, spelled as the captions should show them; a lower
   * third may show one. */
  names: string[];
  /** Other words said in the footage, such as brands and jargon: only for hearing them. Edits
   * from before the field had none. */
  terms?: string[];
  /** The licence the music is used under, such as "CC0 1.0"; needed when there is music. */
  musicLicense?: string;
  asr: Asr;
  visuals: Visuals;
  /** Edits from before the advanced settings had none of these: best, uncorrected and bold. */
  quality?: Quality;
  correct?: boolean;
  captions?: CaptionStyle;
  /** What the user asks of the edit, in their words, trimmed; absent when they ask nothing. */
  instructions?: string;
  /** Several shorts instead of one video: how many, and the range each one's length lies in, in
   * seconds; `length` is then the range's longest. */
  shorts?: { count: number; min: number; max: number };
}

/** A file as the page offers it: its path inside what was dropped, and its size in bytes. */
export interface FileEntry {
  path: string;
  size: number;
}

/** Why `length` cannot be an edit's length, or null when it can. */
export function lengthProblem(length: number, t: Messages = en): string | null {
  const [shortest, longest] = LENGTH_RANGE;
  if (!Number.isFinite(length)) return t.settings.lengthExample;
  if (length < shortest) return t.settings.shortest(formatLength(shortest, t));
  if (length > longest) return t.settings.longest(formatLength(longest, t));
  return null;
}

/** Why `text` cannot be what the user tells Claude, or null when it can. */
export function instructionsProblem(text: string, t: Messages = en): string | null {
  const length = text.trim().length;
  return length > INSTRUCTIONS_MAX
    ? t.settings.instructionsTooLong(INSTRUCTIONS_MAX, length)
    : null;
}

/** The lines of a names field that hold a name, trimmed, without repeats. */
export function namesFrom(text: string): string[] {
  const names = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return [...new Set(names)];
}

/** The settings in `input`, or why they cannot make an edit; `asr` unless it says otherwise. What
 * the page can ask for wrongly is said in `t`'s words; the rest only a program sends. */
export function checkSettings(
  input: unknown,
  asr: Asr = "local",
  t: Messages = en,
): Settings | string {
  if (typeof input !== "object" || input === null) return "No settings";
  const { length, aspect, style, names, terms, musicLicense, visuals } = input as Record<
    string,
    unknown
  >;
  const { quality, correct, captions, instructions, shorts } = input as Record<string, unknown>;
  const heard = (input as Record<string, unknown>).asr ?? asr;
  if (!ASRS.includes(heard as Asr)) return `Speech is heard ${ASRS.join(" or ")}`;
  const several = shorts === undefined ? null : shortsProblem(shorts);
  if (typeof several === "string") return several;
  if (!several && typeof length !== "number") return "No length";
  const problem = several ? null : lengthProblem(length as number, t);
  if (problem) return problem;
  if (!ASPECTS.includes(aspect as Aspect)) return `The aspect is ${ASPECTS.join(", ")}`;
  const chosen = style ?? DEFAULT_STYLE;
  if (!STYLES.includes(chosen as Style)) return `The style is ${STYLES.join(", ")}`;
  const shown = visuals ?? DEFAULT_VISUALS;
  if (!VISUALS.includes(shown as Visuals)) return `Visuals are ${VISUALS.join(" or ")}`;
  const chosenQuality = quality ?? "best";
  if (!QUALITIES.includes(chosenQuality as Quality)) return `Quality is ${QUALITIES.join(" or ")}`;
  if (typeof (correct ?? false) !== "boolean") return "Transcript correction is on or off";
  const chosenCaptions = captions ?? DEFAULT_CAPTIONS;
  if (typeof chosenCaptions !== "string" || !isCaptionStyle(chosenCaptions)) {
    return `The caption style is ${CAPTION_STYLES.join(", ")}`;
  }
  const lists: Record<"names" | "terms", string[]> = { names: [], terms: [] };
  for (const [key, value] of [
    ["names", names],
    ["terms", terms],
  ] as const) {
    const list = value ?? [];
    if (!Array.isArray(list) || list.some((item) => typeof item !== "string")) {
      return `${key === "names" ? "Names" : "Terms"} are a list of text`;
    }
    if (list.length > MAX_NAMES) return `At most ${MAX_NAMES} ${key}`;
    if (list.some((item: string) => item.length > MAX_NAME_LENGTH || /[\r\n]/.test(item))) {
      return `A ${key === "names" ? "name" : "term"} is one line of at most ${MAX_NAME_LENGTH} characters`;
    }
    lists[key] = list;
  }
  const license = musicLicense ?? "";
  if (typeof license !== "string") return "The music's licence is text";
  if (license.length > MAX_LICENSE_LENGTH || /[\r\n]/.test(license)) {
    return `The music's licence is one line of at most ${MAX_LICENSE_LENGTH} characters`;
  }
  const asked = instructions ?? "";
  if (typeof asked !== "string") return "What you tell Claude is text";
  const tooLong = instructionsProblem(asked, t);
  if (tooLong) return tooLong;
  return {
    length: several ? several.max : (length as number),
    aspect: aspect as Aspect,
    style: chosen as Style,
    names: lists.names,
    terms: lists.terms,
    ...(license.trim() ? { musicLicense: license.trim() } : {}),
    asr: heard as Asr,
    visuals: shown as Visuals,
    quality: chosenQuality as Quality,
    correct: (correct ?? false) as boolean,
    captions: chosenCaptions,
    ...(asked.trim() ? { instructions: asked.trim() } : {}),
    ...(several ? { shorts: several } : {}),
  };
}

/** Shorts as a program asks for them, or why they cannot be made; the page offers only what
 * can. */
function shortsProblem(value: unknown): NonNullable<Settings["shorts"]> | string {
  const { count, min, max } = (value ?? {}) as Record<string, unknown>;
  const [fewest, most] = SHORTS_COUNT;
  if (!Number.isInteger(count) || (count as number) < fewest || (count as number) > most) {
    return `Make ${fewest} to ${most} shorts`;
  }
  const [shortest, longest] = SHORTS_RANGE;
  if (
    typeof min !== "number" ||
    typeof max !== "number" ||
    !(min >= shortest && max <= longest && min < max)
  ) {
    return `A short lasts ${shortest} s to ${longest / 60} min`;
  }
  return { count: count as number, min, max };
}

/** How the page reads a length: 15 s, 1 min, 1 min 30 s, 1 h, in `t`'s units. */
export function formatLength(seconds: number, t: Messages = en): string {
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  const { h, min, s } = t.units;
  const parts = [
    hours ? `${hours} ${h}` : "",
    minutes ? `${minutes} ${min}` : "",
    rest || whole === 0 ? `${rest} ${s}` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

/** A running clock: 0:07, 12:30, 1:02:03. */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = String(whole % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** US dollars as the page shows them: $0.07, or unknown for a model without a price. */
export function formatDollars(dollars: number | null, t: Messages = en): string {
  if (dollars === null) return t.dollars.unknown;
  if (dollars > 0 && dollars < 0.01) return t.dollars.under;
  return `$${dollars.toFixed(2)}`;
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export type Role = "video" | "image" | "music";

/**
 * What an edit does with a file: cuts a video, shows a still as B-roll, or offers sound on its
 * own, which has no picture to cut, as music. Null for a file that is not media at all.
 */
export function roleOf(path: string): Role | null {
  const kind = kindOf(path);
  if (!kind) return null;
  return kind === "audio" ? "music" : kind;
}
