import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { anthropicClaude, ClaudeError, type ClaudeRequest, PLAN_MODEL } from "./claude.ts";

const request: ClaudeRequest = {
  purpose: "plan",
  model: PLAN_MODEL,
  system: "Plan.",
  content: [{ type: "text", text: "The talk." }],
  schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
  effort: "low",
  maxTokens: 100,
};

const event = (response: ServerResponse, type: string, data: object) =>
  response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);

/** A local API that streams each reply; replies listed as "drop" end the connection mid-way. */
async function api(t: { after: (done: () => void) => void }, replies: ("drop" | "ok")[]) {
  let calls = 0;
  const server = createServer((_request, response) => {
    const reply = replies[Math.min(calls++, replies.length - 1)];
    response.writeHead(200, { "content-type": "text/event-stream" });
    const usage = { input_tokens: 10, output_tokens: 0 };
    event(response, "message_start", {
      message: {
        id: "msg",
        type: "message",
        role: "assistant",
        model: PLAN_MODEL,
        content: [],
        usage,
      },
    });
    if (reply === "drop") {
      // Once the reply has begun, as a connection lost mid-plan does.
      setTimeout(() => response.socket?.destroy(), 50);
      return;
    }
    event(response, "content_block_start", { index: 0, content_block: { type: "text", text: "" } });
    const delta = { type: "text_delta", text: '{"ok":true}' };
    event(response, "content_block_delta", { index: 0, delta });
    event(response, "content_block_stop", { index: 0 });
    const stop = { stop_reason: "end_turn", stop_sequence: null };
    event(response, "message_delta", { delta: stop, usage: { output_tokens: 5 } });
    event(response, "message_stop", {});
    response.end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  t.after(() => server.close());
  const { port } = server.address() as { port: number };
  const client = new Anthropic({ apiKey: "test", baseURL: `http://127.0.0.1:${port}` });
  return { client, calls: () => calls };
}

test("a plan whose stream drops mid-way is asked again", async (t) => {
  const { client, calls } = await api(t, ["drop", "ok"]);
  const reply = await anthropicClaude(client)(request);
  assert.deepEqual(reply.json, { ok: true });
  assert.equal(calls(), 2);
});

test("a stream that keeps dropping fails as a Claude error naming the request", async (t) => {
  const { client, calls } = await api(t, ["drop"]);
  await assert.rejects(
    anthropicClaude(client)(request),
    (error: Error) =>
      error instanceof ClaudeError &&
      error.message.startsWith(`The plan request to ${PLAN_MODEL} failed: `),
  );
  assert.equal(calls(), 3);
});
