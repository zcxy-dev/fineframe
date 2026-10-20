import { checkOrigin, errorResponse } from "../../../../../lib/http.ts";
import { messagesOf } from "../../../../../lib/i18n/messages.ts";
import { defaultRoot, jobs } from "../../../../../lib/jobs.ts";
import { remember } from "../../../../../lib/remembered.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const job = await jobs().start((await ctx.params).id, messagesOf(request));
    // Offered again for the next edit; the edit goes ahead without it.
    await remember(defaultRoot(), job.settings).catch(() => {});
    return Response.json(job);
  } catch (error) {
    return errorResponse(error, request);
  }
}
