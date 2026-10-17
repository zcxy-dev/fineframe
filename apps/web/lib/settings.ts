// What the page asks for, checked the same way in the browser and on the server.
import { LENGTH_RANGE, parseLength } from "@video-editor/engine/length";
import { LOOKS, type LookId, lookIds } from "@video-editor/engine/looks";
import { kindOf } from "@video-editor/engine/media";

export { LENGTH_RANGE, parseLength };

export const ASPECTS = ["9:16", "1:1", "16:9"] as const;
export type Aspect = (typeof ASPECTS)[number];

/** Seconds: a short, two social lengths, and two longer edits. Any other length is typed. */
export const LENGTH_PRESETS = [15, 30, 60, 180, 600] as const;

/** Names and terms are a hint for the speech model; a few hundred is far more than it reads. */
export const MAX_NAMES = 200;
export const MAX_NAME_LENGTH = 100;
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
export const ASRS = ["local", "cloud"] as const;
export type Asr = (typeof ASRS)[number];

export interface Settings {
  /** Seconds, LENGTH_RANGE inclusive. */
  length: number;
  aspect: Aspect;
  style: Style;
  /** Names and terms said in the footage, spelled as the captions should show them. */
  names: string[];
  /** The licence the music is used under, such as "CC0 1.0"; needed when there is music. */
  musicLicense?: string;
  asr: Asr;
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
  const { length, aspect, style, names, musicLicense } = input as Record<string, unknown>;
  const heard = (input as Record<string, unknown>).asr ?? asr;
  if (!ASRS.includes(heard as Asr)) return `Speech is heard ${ASRS.join(" or ")}`;
  if (typeof length !== "number") return "No length";
  const problem = lengthProblem(length);
  if (problem) return problem;
  if (!ASPECTS.includes(aspect as Aspect)) return `The aspect is ${ASPECTS.join(", ")}`;
  const chosen = style ?? DEFAULT_STYLE;
  if (!STYLES.includes(chosen as Style)) return `The style is ${STYLES.join(", ")}`;
  const list = names ?? [];
  if (!Array.isArray(list) || list.some((name) => typeof name !== "string")) {
    return "Names are a list of text";
  }
  if (list.length > MAX_NAMES) return `At most ${MAX_NAMES} names and terms`;
  if (list.some((name: string) => name.length > MAX_NAME_LENGTH || /[\r\n]/.test(name))) {
    return `A name or term is one line of at most ${MAX_NAME_LENGTH} characters`;
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
    names: list as string[],
    ...(license.trim() ? { musicLicense: license.trim() } : {}),
    asr: heard as Asr,
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
