// What the page asks for, checked the same way in the browser and on the server.
import { PRESETS } from "@video-editor/engine/captions";
import { LENGTH_RANGE, parseLength } from "@video-editor/engine/length";
import { LOOKS, type LookId, lookIds } from "@video-editor/engine/looks";
import { kindOf } from "@video-editor/engine/media";

export { LENGTH_RANGE, parseLength };

export const ASPECTS = ["9:16", "1:1", "16:9"] as const;
export type Aspect = (typeof ASPECTS)[number];

/** Seconds: a short, two social lengths, and two longer edits. Any other length is typed. */
export const LENGTH_PRESETS = [15, 30, 60, 180, 600] as const;

/** Names and terms are each a hint for the speech model; a few hundred is far more than it
 * reads. */
const MAX_NAMES = 200;
const MAX_NAME_LENGTH = 100;
export const MAX_LICENSE_LENGTH = 200;

/** The edit's style: one of the engine's looks, or the footage's own colour. */
export type Style = LookId | "none";
export const STYLES: readonly Style[] = [...lookIds, "none"];
export const DEFAULT_STYLE: Style = "clean";
export const STYLE_TEXT: Record<Style, string> = {
  ...(Object.fromEntries(lookIds.map((id) => [id, LOOKS[id].description])) as Record<
    LookId,
    string
  >),
  none: "No look: the footage's own colour, balanced and matched between cameras.",
};

export function styleName(style: Style): string {
  return style === "none" ? "None" : `${style[0]?.toUpperCase()}${style.slice(1)}`;
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

/** The captions' look (`--captions`): one of the engine's caption presets. */
export const CAPTION_STYLES = Object.keys(PRESETS);
export const DEFAULT_CAPTIONS = "bold";

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
  captions?: string;
}

/** A file as the page offers it: its path inside what was dropped, and its size in bytes. */
export interface FileEntry {
  path: string;
  size: number;
}

/** Why `length` cannot be an edit's length, or null when it can. */
export function lengthProblem(length: number): string | null {
  const [shortest, longest] = LENGTH_RANGE;
  if (!Number.isFinite(length)) return "Type a length such as 90 s, 2:30 or 1 h";
  if (length < shortest) return `The shortest edit is ${formatLength(shortest)}`;
  if (length > longest) return `The longest edit is ${formatLength(longest)}`;
  return null;
}

/** The lines of a names field that hold a name, trimmed, without repeats. */
export function namesFrom(text: string): string[] {
  const names = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return [...new Set(names)];
}

/** The settings in `input`, or why they cannot make an edit; `asr` unless it says otherwise. */
export function checkSettings(input: unknown, asr: Asr = "local"): Settings | string {
  if (typeof input !== "object" || input === null) return "No settings";
  const { length, aspect, style, names, terms, musicLicense, visuals } = input as Record<
    string,
    unknown
  >;
  const { quality, correct, captions } = input as Record<string, unknown>;
  const heard = (input as Record<string, unknown>).asr ?? asr;
  if (!ASRS.includes(heard as Asr)) return `Speech is heard ${ASRS.join(" or ")}`;
  if (typeof length !== "number") return "No length";
  const problem = lengthProblem(length);
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
  if (!CAPTION_STYLES.includes(chosenCaptions as string)) {
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
  return {
    length,
    aspect: aspect as Aspect,
    style: chosen as Style,
    names: lists.names,
    terms: lists.terms,
    ...(license.trim() ? { musicLicense: license.trim() } : {}),
    asr: heard as Asr,
    visuals: shown as Visuals,
    quality: chosenQuality as Quality,
    correct: (correct ?? false) as boolean,
    captions: chosenCaptions as string,
  };
}

/** How the page reads a length: 15 s, 1 min, 1 min 30 s, 1 h. */
export function formatLength(seconds: number): string {
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  const parts = [
    hours ? `${hours} h` : "",
    minutes ? `${minutes} min` : "",
    rest || whole === 0 ? `${rest} s` : "",
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
export function formatDollars(dollars: number | null): string {
  if (dollars === null) return "unknown";
  if (dollars > 0 && dollars < 0.01) return "under $0.01";
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
