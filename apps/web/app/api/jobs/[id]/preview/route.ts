import { checkOrigin, errorResponse, shortParam } from "../../../../../lib/http.ts";
import { JobError, jobs } from "../../../../../lib/jobs.ts";
import { checkRevision } from "../../../../../lib/versions.ts";

export const dynamic = "force-dynamic";

/** Where the changes' cuts would land and the length they leave, without rendering. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const revision = checkRevision(await request.json().catch(() => null));
    if (typeof revision === "string") throw new JobError(revision, 400);
    const id = (await ctx.params).id;
    return Response.json(await jobs().preview(id, revision, shortParam(request)));
  } catch (error) {
    return errorResponse(error, request);
  }
}
