// What a person reads when something fails: what happened in plain words and the step that fixes
// it, with the program's own message kept behind "Show details", never with a local path in it.

import { en, type Messages } from "./i18n/en.ts";

export type FixKind =
  | "key"
  | "openrouter"
  | "credit"
  | "disk"
  | "file"
  | "missing"
  | "network"
  | "length";

export interface Fix {
  kind: FixKind;
  /** What happened. */
  summary: string;
  /** What to do about it. */
  next: string;
}

/** What each fix is for, as a program says it; the fix itself is in each language's words. */
const FIXES: [FixKind, RegExp][] = [
  ["key", /authentication_error|invalid x-api-key|ANTHROPIC_API_KEY|permission_error/i],
  ["openrouter", /OpenRouter rejected|OPENROUTER_API_KEY|OpenRouter has no credit/i],
  ["credit", /credit balance is too low|billing/i],
  ["disk", /no space left on device|ENOSPC|disk is full/i],
  [
    "file",
    /invalid data found|not an image FFmpeg can read|moov atom not found|no video stream|unsupported codec|could not open/i,
  ],
  ["missing", /ENOENT|no such file or directory/i],
  [
    "network",
    /connection error|cannot reach|could not download|ENOTFOUND|ECONNRESET|ETIMEDOUT|temporary failure in name resolution/i,
  ],
  ["length", /^The footage lasts [\d.]+ s in all, too short for a \d+ s edit/],
];

/** The step that fixes an edit that failed with `message`, in `t`'s words, or null when there is
 * none to give. */
export function fixFor(message: string, t: Messages = en): Fix | null {
  for (const [kind, pattern] of FIXES) {
    if (pattern.test(message)) return { kind, ...t.errors.fixes[kind] };
  }
  return null;
}

// An absolute path, on macOS and Linux, on Windows, or from the home folder; the last group is
// its file's name. A web address and a path inside an edit's own folder (`footage/a.mp4`) are not.
const PATHS = [
  /(?<![\w:/.~-])\/(?:[^\s'"/]+\/)+([^\s'"/:,;)]+)/g,
  /\b[A-Za-z]:\\(?:[^\s'"\\]+\\)+([^\s'"\\:,;)]+)/g,
  /~\/(?:[^\s'"/]+\/)*([^\s'"/:,;)]+)/g,
];

/** `message` with each local path shortened to its file's name. */
export function withoutPaths(message: string): string {
  return PATHS.reduce((text, pattern) => text.replace(pattern, "$1"), message);
}

/** What a program writes rather than a person: error codes, data, stack lines, exit codes. */
const TECHNICAL = /\bE[A-Z]{3,}\b|Errno|exit code|Traceback|\w+Error\b|[{}[\]]|\bat \S+ \(/;

export interface Explained {
  summary: string;
  next: string | null;
  /** The message as the program wrote it, without local paths; null when the summary is it. */
  details: string | null;
  kind: FixKind | null;
}

/** Whether `message` is in Chinese, leaving out the names of files, which may be in any
 * language. */
const CHINESE = (message: string) => /\p{Script=Han}/u.test(message.replace(/\S+\.\w{2,4}\b/g, ""));

/** `message` for a person to read, in `t`'s words. `fallback` says what failed when nothing
 * better can be said of a message that reads as a program's. A message the server wrote for
 * people stays as it is; in Chinese, one left in English, as the edit's own program writes, is
 * said by `fallback`, with the message itself behind details. */
export function explain(message: string, fallback: string, t: Messages = en): Explained {
  const details = withoutPaths(message);
  const fix = fixFor(message, t);
  if (fix) return { summary: fix.summary, next: fix.next, details, kind: fix.kind };
  const untranslated = t !== en && !CHINESE(message);
  if (untranslated || TECHNICAL.test(message) || details !== message || message.length > 200) {
    return { summary: fallback, next: null, details, kind: null };
  }
  return { summary: message, next: null, details: null, kind: null };
}
