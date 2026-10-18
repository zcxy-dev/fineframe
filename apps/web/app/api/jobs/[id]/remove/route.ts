import { checkOrigin, errorResponse } from "../../../../../lib/http.ts";
import { jobs } from "../../../../../lib/jobs.ts";

export const dynamic = "force-dynamic";

/** Deletes the project: its footage, outputs and settings. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    await jobs().remove((await ctx.params).id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
