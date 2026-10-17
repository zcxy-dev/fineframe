import { checkOrigin, errorResponse } from "../../../lib/http.ts";
import { JobError } from "../../../lib/jobs.ts";
import {
  checkKey,
  keyProblem,
  readKey,
  SERVICES,
  type Service,
  saveKey,
} from "../../../lib/key.ts";

export const dynamic = "force-dynamic";

/** Whether there is an Anthropic key (`set`), an OpenRouter one, and Pexels and Pixabay ones;
 * never the keys themselves. */
export async function GET(): Promise<Response> {
  return Response.json({
    set: (await readKey("anthropic")) !== undefined,
    openrouter: (await readKey("openrouter")) !== undefined,
    pexels: (await readKey("pexels")) !== undefined,
    pixabay: (await readKey("pixabay")) !== undefined,
  });
}

/** A new key for `service` (Anthropic unless given), saved once the service accepts it. */
export async function PUT(request: Request): Promise<Response> {
  try {
    checkOrigin(request);
    const body = (await request.json().catch(() => null)) as {
      key?: unknown;
      service?: unknown;
    } | null;
    const service = (body?.service ?? "anthropic") as Service;
    if (!SERVICES.includes(service)) throw new JobError("No such service", 400);
    const key = typeof body?.key === "string" ? body.key.trim() : "";
    const problem = keyProblem(key, service) ?? (await checkKey(key, service));
    if (problem) throw new JobError(problem, 400);
    await saveKey(key, service);
    return GET();
  } catch (error) {
    return errorResponse(error);
  }
}
