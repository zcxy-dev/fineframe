import { checkOrigin, errorResponse } from "../../../../../lib/http.ts";
import { messagesOf } from "../../../../../lib/i18n/messages.ts";
import { JobError, jobs } from "../../../../../lib/jobs.ts";
import { checkRevision } from "../../../../../lib/versions.ts";

export const dynamic = "force-dynamic";

/** Applies the changes as a new version of the edit, and renders it. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const body = (await request.json().catch(() => null)) as {
      revision?: unknown;
      summary?: unknown;
    } | null;
    const revision = checkRevision(body?.revision);
    if (typeof revision === "string") throw new JobError(revision, 400);
    if (Object.keys(revision).length === 0) throw new JobError((t) => t.server.noChanges, 400);
    const summary =
      typeof body?.summary === "string"
        ? body.summary.slice(0, 200)
        : messagesOf(request).versions.changes;
    return Response.json(await jobs().revise((await ctx.params).id, revision, summary));
  } catch (error) {
    return errorResponse(error, request);
  }
}
