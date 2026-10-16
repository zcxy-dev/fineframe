import assert from "node:assert/strict";
import { test } from "node:test";
import { fixFor } from "./fixes.ts";

test("an edit that failed for a reason its owner can fix says what to do", () => {
  // Messages as the engine and vework write them.
  const cases: [string, string | null][] = [
    [
      "Planning needs Claude (claude-opus-5-5), which answered: 401 " +
        '{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}. ' +
        "Set ANTHROPIC_API_KEY, or put it in the .env at the repository root",
      "key",
    ],
    [
      "The plan request to claude-opus-5-5 failed: 400 " +
        '{"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance ' +
        'is too low to access the Anthropic API."}}. The analysis is kept, so running the edit ' +
        "again starts at the plan",
      "credit",
    ],
    ["footage/a.mp4: the analysis failed: [Errno 28] No space left on device", "disk"],
    ["ENOSPC: no space left on device, write", "disk"],
    [
      "footage/a.mp4: the analysis failed: footage/a.mp4: Invalid data found when processing input",
      "file",
    ],
    ["footage/logo.png: not an image FFmpeg can read (Invalid data found)", "file"],
    [
      "footage/a.mp4: the analysis failed: Qwen/Qwen3-ASR-0.6B-hf: Cannot reach " +
        "https://huggingface.co: connection error",
      "network",
    ],
    ["The plan request to claude-opus-5-5 failed: Connection error.", "network"],
    ["The edit stopped unexpectedly (exit code 1)", null],
  ];
  for (const [message, kind] of cases) {
    const fix = fixFor(message);
    assert.equal(fix?.kind ?? null, kind, message);
    if (fix) assert.ok(fix.text.length > 0);
  }
});
