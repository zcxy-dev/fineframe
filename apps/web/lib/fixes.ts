// What a person reads when something fails: what happened in plain words and the step that fixes
// it, with the program's own message kept behind "Show details", never with a local path in it.

export type FixKind = "key" | "openrouter" | "credit" | "disk" | "file" | "missing" | "network";

export interface Fix {
  kind: FixKind;
  /** What happened. */
  summary: string;
  /** What to do about it. */
  next: string;
}

const FIXES: [FixKind, RegExp, string, string][] = [
  [
    "key",
    /authentication_error|invalid x-api-key|ANTHROPIC_API_KEY|permission_error/i,
    "Anthropic did not accept the API key.",
    "Replace it, then start the edit again.",
  ],
  [
    "openrouter",
    /OpenRouter rejected|OPENROUTER_API_KEY|OpenRouter has no credit/i,
    "OpenRouter did not accept the key, or has no credit left for it.",
    "Replace the key or add credit at openrouter.ai/settings/credits, then start the edit again.",
  ],
  [
    "credit",
    /credit balance is too low|billing/i,
    "The Anthropic account is out of credit.",
    "Add some at console.anthropic.com/settings/billing, then start the edit again: the analysis is kept.",
  ],
  [
    "disk",
    /no space left on device|ENOSPC|disk is full/i,
    "The disk is full.",
    "Free some space, then start the edit again. The speech model takes about 3.5 GB on its first use, and each edit's files a few times its footage; deleting older projects frees theirs.",
  ],
  [
    "file",
    /invalid data found|not an image FFmpeg can read|moov atom not found|no video stream|unsupported codec|could not open/i,
    "One of the files can't be read.",
    "It may be damaged, still copying, or in a format FFmpeg does not know. Leave it out, or convert it to MP4 (H.264), and start again.",
  ],
  [
    "missing",
    /ENOENT|no such file or directory/i,
    "A file this edit needs can't be found.",
    "Check that it is still where it was and that its drive is connected, then try again.",
  ],
  [
    "network",
    /connection error|cannot reach|could not download|ENOTFOUND|ECONNRESET|ETIMEDOUT|temporary failure in name resolution/i,
    "Fineframe could not reach the internet.",
    "Check the connection and start the edit again: what was analysed or downloaded is kept.",
  ],
];

/** The step that fixes an edit that failed with `message`, or null when there is none to give. */
export function fixFor(message: string): Fix | null {
  for (const [kind, pattern, summary, next] of FIXES) {
    if (pattern.test(message)) return { kind, summary, next };
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

/** `message` for a person to read. `fallback` says what failed when nothing better can be said
 * of a message that reads as a program's. A message the server wrote for people stays as it is. */
export function explain(message: string, fallback: string): Explained {
  const details = withoutPaths(message);
  const fix = fixFor(message);
  if (fix) return { summary: fix.summary, next: fix.next, details, kind: fix.kind };
  if (TECHNICAL.test(message) || details !== message || message.length > 200) {
    return { summary: fallback, next: null, details, kind: null };
  }
  return { summary: message, next: null, details: null, kind: null };
}
