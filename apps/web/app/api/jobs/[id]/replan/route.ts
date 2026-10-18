import { checkOrigin, errorResponse } from "../../../../../lib/http.ts";
import { messagesOf } from "../../../../../lib/i18n/messages.ts";
import { checkReplan, JobError, jobs } from "../../../../../lib/jobs.ts";

export const dynamic = "force-dynamic";

/** Plans the edit again from the same footage as a new version. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const choice = checkReplan(await request.json().catch(() => null));
    if (typeof choice === "string") throw new JobError(choice, 400);
    return Response.json(await jobs().replan((await ctx.params).id, choice, messagesOf(request)));
  } catch (error) {
    return errorResponse(error, request);
  }
}
