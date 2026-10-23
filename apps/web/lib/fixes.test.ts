import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { checkClaude } from "@video-editor/engine/claude";
import { explain, fixFor, withoutPaths } from "./fixes.ts";

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
    [
      "The footage lasts 37.0 s in all, too short for a 60 s edit: ask for a shorter edit or add footage",
      "length",
    ],
    [
      "ENOENT: no such file or directory, open '/tmp/jobs/0c3e/out/analysis/talk-a.json'",
      "missing",
    ],
    ["The edit stopped unexpectedly (exit code 1)", null],
  ];
  for (const [message, kind] of cases) {
    const fix = fixFor(message);
    assert.equal(fix?.kind ?? null, kind, message);
    if (fix) assert.ok(fix.summary.length > 0 && fix.next.length > 0);
  }
});

test("a check of Claude that fails says whether the key was refused or Claude was out of reach", async (t) => {
  const refusing = createServer((_request, response) => {
    response.writeHead(401, { "content-type": "application/json" });
    const error = { type: "authentication_error", message: "invalid x-api-key" };
    response.end(JSON.stringify({ type: "error", error }));
  });
  const address = async (server: ReturnType<typeof createServer>) => {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };
  const refused = await address(refusing);
  t.after(() => refusing.close());
  // A port nothing listens on any more: the connection fails.
  const closed = createServer();
  const unreachable = await address(closed);
  await new Promise((done) => closed.close(done));
  for (const [baseURL, kind] of [
    [refused, "key"],
    [unreachable, "network"],
  ] as const) {
    const client = new Anthropic({ apiKey: "sk-ant-test", baseURL, maxRetries: 0 });
    const message = await checkClaude(undefined, client).then(
      () => assert.fail("the check passed"),
      (error: Error) => error.message,
    );
    assert.equal(fixFor(message)?.kind, kind, message);
  }
});

test("no local path reaches the page, only the file's name", () => {
  const cases: [string, string][] = [
    [
      "ENOENT: no such file or directory, open '/tmp/claude-1000/jobs/0c3e/out/analysis/talk-a.json'",
      "ENOENT: no such file or directory, open 'talk-a.json'",
    ],
    ["open C:\\Users\\Ana\\AppData\\Roaming\\Fineframe\\jobs\\a.mp4 failed", "open a.mp4 failed"],
    [
      "/home/ana/.cache/video-editor/jobs/x/footage/a.mp4: moov atom not found",
      "a.mp4: moov atom not found",
    ],
    ["could not write ~/Movies/out.mp4", "could not write out.mp4"],
    // Not a local path: a web address and a path inside the edit's own folder.
    [
      "Cannot reach https://huggingface.co/Qwen/x: connection error",
      "Cannot reach https://huggingface.co/Qwen/x: connection error",
    ],
    ["footage/a.mp4: the analysis failed", "footage/a.mp4: the analysis failed"],
  ];
  for (const [message, shown] of cases) assert.equal(withoutPaths(message), shown, message);
});

test("an error reads as what happened and what to do, with the raw message behind details", () => {
  const missing = explain(
    "ENOENT: no such file or directory, open '/tmp/jobs/0c3e/out/analysis/talk-a.json'",
    "The changes could not be shown",
  );
  assert.equal(missing.summary, "A file this edit needs can't be found.");
  assert.match(missing.next ?? "", /still where it was/);
  assert.equal(missing.details, "ENOENT: no such file or directory, open 'talk-a.json'");

  // A message the server wrote for people is shown as it is, with nothing behind it.
  assert.deepEqual(explain("Requests from another site are refused", "x"), {
    summary: "Requests from another site are refused",
    next: null,
    details: null,
    kind: null,
  });

  // One that reads as a program's, with nothing to do about it, says what stopped.
  const crashed = explain(
    "The edit stopped unexpectedly (exit code 1)",
    "The edit stopped before it finished.",
  );
  assert.equal(crashed.summary, "The edit stopped before it finished.");
  assert.equal(crashed.details, "The edit stopped unexpectedly (exit code 1)");

  const key = explain(
    'Planning needs Claude, which answered: 401 {"type":"error","error":{"type":"authentication_error"}}',
    "x",
  );
  assert.equal(key.kind, "key");
  assert.equal(key.summary, "Anthropic did not accept the API key.");
  assert.ok(key.details?.includes("authentication_error"));
});
