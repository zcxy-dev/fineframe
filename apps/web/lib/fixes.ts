// What a person can do about an edit that failed, from the engine's message. The message stays
// on the page as it is; this adds the step that fixes it, when there is one.

export type FixKind = "key" | "openrouter" | "credit" | "disk" | "file" | "network";

export interface Fix {
  kind: FixKind;
  text: string;
}

const FIXES: [FixKind, RegExp, string][] = [
  [
    "key",
    /authentication_error|invalid x-api-key|ANTHROPIC_API_KEY|permission_error/i,
    "Anthropic did not accept the API key. Replace it, then start the edit again.",
  ],
  [
    "openrouter",
    /OpenRouter rejected|OPENROUTER_API_KEY|OpenRouter has no credit/i,
    "OpenRouter did not accept the key or has no credit left for it. Replace the key or add credit at openrouter.ai/settings/credits, then start the edit again.",
  ],
  [
    "credit",
    /credit balance is too low|billing/i,
    "The Anthropic account is out of credit. Add some at console.anthropic.com/settings/billing, then start the edit again: the analysis is kept.",
  ],
  [
    "disk",
    /no space left on device|ENOSPC|disk is full/i,
    "The disk is full. Free some space (the speech model takes about 3.5 GB on its first use, and each edit's files a few times its footage), then start the edit again.",
  ],
  [
    "file",
    /invalid data found|not an image FFmpeg can read|moov atom not found|no video stream|unsupported codec|could not open/i,
    "One of the files cannot be read: it may be damaged, still copying, or in a format FFmpeg does not know. Leave it out, or convert it to MP4 (H.264), and start again.",
  ],
  [
    "network",
    /connection error|cannot reach|could not download|ENOTFOUND|ECONNRESET|ETIMEDOUT|temporary failure in name resolution/i,
    "Could not reach the internet. Check the connection and start the edit again: what was analysed or downloaded is kept.",
  ],
];

/** The step that fixes an edit that failed with `message`, or null when there is none to give. */
export function fixFor(message: string): Fix | null {
  for (const [kind, pattern, text] of FIXES) {
    if (pattern.test(message)) return { kind, text };
  }
  return null;
}
