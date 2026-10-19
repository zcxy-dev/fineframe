import { checkOrigin, errorResponse } from "../../../../../lib/http.ts";
import { JobError, jobs } from "../../../../../lib/jobs.ts";
import { checkRevision } from "../../../../../lib/versions.ts";

export const dynamic = "force-dynamic";

/** Where the changes' cuts would land and the length they leave, without rendering. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const revision = checkRevision(await request.json().catch(() => null));
    if (typeof revision === "string") throw new JobError(revision, 400);
    return Response.json(await jobs().preview((await ctx.params).id, revision));
  } catch (error) {
    return errorResponse(error, request);
  }
}
