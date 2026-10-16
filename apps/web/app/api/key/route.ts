import { checkOrigin, errorResponse } from "../../../lib/http.ts";
import { JobError } from "../../../lib/jobs.ts";
import { checkKey, keyProblem, readKey, saveKey } from "../../../lib/key.ts";

export const dynamic = "force-dynamic";

/** Whether there is a key; never the key itself. */
export async function GET(): Promise<Response> {
  return Response.json({ set: (await readKey()) !== undefined });
}

/** A new key, saved once Anthropic accepts it. */
export async function PUT(request: Request): Promise<Response> {
  try {
    checkOrigin(request);
    const body = (await request.json().catch(() => null)) as { key?: unknown } | null;
    const key = typeof body?.key === "string" ? body.key.trim() : "";
    const problem = keyProblem(key) ?? (await checkKey(key));
    if (problem) throw new JobError(problem, 400);
    await saveKey(key);
    return Response.json({ set: true });
  } catch (error) {
    return errorResponse(error);
  }
}
