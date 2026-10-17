import { setTimeout } from "node:timers/promises";
import Anthropic from "@anthropic-ai/sdk";

/** What an edit spends on Claude: `best` plans with Opus, `economy` with Sonnet at half its
 * price per token in and out. */
export type Quality = "best" | "economy";
export const QUALITIES: readonly Quality[] = ["best", "economy"];
/** Edit planning and the decisions a cut check escalates, by quality. */
export const PLAN_MODELS: Record<Quality, string> = {
  best: "claude-opus-5-5",
  economy: "claude-sonnet-5-5",
};
/** Bulk frame checks, whatever the quality: one request per cut, and one per callout to find
 * what it points at. */
export const CHECK_MODEL = "claude-haiku-5-5";

/** What one request to Claude asks, independent of the SDK, so tests can replay recorded
 * replies through the same code. */
export interface ClaudeRequest {
  /** Which step asks; recorded replies are keyed by it. */
  purpose: "plan" | "check" | "judge" | "locate" | "repair";
  model: string;
  system: string;
  /** In order. A text block marked `cache` ends a prefix that later requests reuse. */
  content: ({ type: "text"; text: string; cache?: boolean } | { type: "image"; png: Buffer })[];
  /** The JSON Schema the reply follows (structured output). */
  schema: Record<string, unknown>;
  effort: "low" | "medium" | "high";
  maxTokens: number;
}

/** Tokens one request used, by kind, and what they cost. */
export interface Usage {
  purpose: ClaudeRequest["purpose"];
  /** The model that answered: the requested one, or the fallback that served a declined request. */
  model: string;
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
  /** US dollars at list price; null for a model missing from PRICES. */
  dollars: number | null;
}

export interface ClaudeReply {
  /** The structured output, parsed. */
  json: unknown;
  usage: Usage;
}

export type Claude = (request: ClaudeRequest) => Promise<ClaudeReply>;

/** Raised when Claude declines a request or cannot finish it; the message says which. */
export class ClaudeError extends Error {
  override name = "ClaudeError";
}

// US dollars per million tokens. Cache writes cost 1.25 × input (5-minute TTL).
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
  // Where a declined Opus 5.5 or Sonnet 5.5 request falls back to.
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
};

export function cost(
  model: string,
  tokens: { input: number; cacheWrite: number; cacheRead: number; output: number },
): number | null {
  const price = PRICES[model];
  if (!price) return null;
  const { input, cacheWrite, cacheRead, output } = tokens;
  return (
    (input * price.input +
      cacheWrite * price.input * 1.25 +
      cacheRead * price.cacheRead +
      output * price.output) /
    1e6
  );
}

/** Adds up usage, per model and in total. */
export function totalUsage(usages: readonly Usage[]) {
  const sum = { calls: usages.length, input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
  let dollars: number | null = 0;
  for (const usage of usages) {
    sum.input += usage.input;
    sum.cacheWrite += usage.cacheWrite;
    sum.cacheRead += usage.cacheRead;
    sum.output += usage.output;
    dollars = dollars === null || usage.dollars === null ? null : dollars + usage.dollars;
  }
  return { ...sum, dollars };
}

/**
 * Claude through the Anthropic SDK, which reads ANTHROPIC_API_KEY (or an `ant auth login`
 * profile). Requests to a planning model stream, since a long plan can run for minutes, and opt
 * into the server-side fallback: a request it declines is answered by the model Anthropic
 * recommends for that kind of refusal, and the usage names the model that answered.
 */
export function anthropicClaude(client = new Anthropic({ maxRetries: 5 })): Claude {
  return async (request) => {
    const content = request.content.map(
      (block): Anthropic.Beta.BetaContentBlockParam =>
        block.type === "text"
          ? {
              type: "text",
              text: block.text,
              ...(block.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
            }
          : {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: block.png.toString("base64"),
              },
            },
    );
    const params = {
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.system,
      messages: [{ role: "user" as const, content }],
      output_config: {
        effort: request.effort,
        format: { type: "json_schema" as const, schema: request.schema },
      },
    };
    // Haiku has no server-side fallback; a check it declines is reported as unchecked.
    const send = () =>
      PLANNERS.has(request.model)
        ? client.beta.messages
            .stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
            .finalMessage()
        : client.beta.messages.create(params);
    let message: Anthropic.Beta.BetaMessage | undefined;
    for (let attempt = 1; !message; attempt++) {
      try {
        message = await send();
      } catch (error) {
        if (!(error instanceof Anthropic.AnthropicError)) throw error;
        if (attempt <= STREAM_RETRIES && broken(error)) {
          await setTimeout(1000 * attempt);
          continue;
        }
        throw new ClaudeError(
          `The ${request.purpose} request to ${request.model} failed: ${error.message}`,
        );
      }
    }
    if (message.stop_reason === "refusal") {
      const category = message.stop_details?.category ?? "no category";
      throw new ClaudeError(
        `${message.model} declined the ${request.purpose} request (${category})`,
      );
    }
    if (message.stop_reason === "max_tokens") {
      throw new ClaudeError(`${message.model} ran out of tokens on the ${request.purpose} request`);
    }
    const text = message.content.flatMap((block) => (block.type === "text" ? [block.text] : []));
    return { json: JSON.parse(text.join("")), usage: usageOf(request.purpose, message) };
  };
}

const PLANNERS = new Set(Object.values(PLAN_MODELS));

/** The SDK retries a request that fails before its reply starts, but not a reply that breaks
 * off once it has: the connection lost mid-stream, or an error event the server sends in it. A
 * plan can stream for minutes, so those are asked again too. */
const STREAM_RETRIES = 2;
const broken = (error: InstanceType<typeof Anthropic.AnthropicError>) =>
  error instanceof Anthropic.APIError
    ? error.status === undefined && !(error instanceof Anthropic.APIConnectionError)
    : error.cause instanceof Error;

/**
 * Fails, saying why, when `model`, the planning model, cannot be called: no key, a wrong one, or
 * no access to it. Run before work that takes long, so an edit does not fail only once its
 * footage is analysed. Looking a model up costs nothing.
 */
export async function checkClaude(
  model = PLAN_MODELS.best,
  client = new Anthropic({ maxRetries: 2 }),
): Promise<void> {
  try {
    await client.models.retrieve(model);
  } catch (error) {
    throw new ClaudeError(
      `Planning needs Claude (${model}), which answered: ${(error as Error).message}. ` +
        "Set ANTHROPIC_API_KEY, or put it in the .env at the repository root",
    );
  }
}

function usageOf(purpose: Usage["purpose"], message: Anthropic.Beta.BetaMessage): Usage {
  const { usage } = message;
  const tokens = {
    input: usage.input_tokens,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    output: usage.output_tokens,
  };
  // A fallback bills each model that ran for its own tokens.
  const parts = (usage.iterations ?? []).flatMap((part) =>
    "input_tokens" in part && "output_tokens" in part
      ? [
          cost(("model" in part && part.model) || message.model, {
            input: part.input_tokens,
            cacheWrite: part.cache_creation_input_tokens ?? 0,
            cacheRead: part.cache_read_input_tokens ?? 0,
            output: part.output_tokens,
          }),
        ]
      : [],
  );
  const dollars =
    parts.length > 0
      ? parts.reduce<number | null>(
          (sum, part) => (sum === null || part === null ? null : sum + part),
          0,
        )
      : cost(message.model, tokens);
  return { purpose, model: message.model, ...tokens, dollars };
}

/**
 * Replays recorded replies instead of calling the API: each request takes the next reply
 * recorded for its purpose. Every request is kept in `requests` for tests to inspect.
 */
export function recordedClaude(replies: Partial<Record<ClaudeRequest["purpose"], unknown[]>>) {
  const queues = new Map(Object.entries(replies).map(([key, list]) => [key, [...(list ?? [])]]));
  const requests: ClaudeRequest[] = [];
  const claude: Claude = async (request) => {
    requests.push(request);
    const next = queues.get(request.purpose)?.shift();
    if (next === undefined) throw new Error(`No recorded ${request.purpose} reply left`);
    const usage = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 };
    return {
      json: next,
      usage: { purpose: request.purpose, model: request.model, ...usage, dollars: 0 },
    };
  };
  return { claude, requests };
}
