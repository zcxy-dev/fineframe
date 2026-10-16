import { checkOrigin, errorResponse } from "../../../../../lib/http.ts";
import { jobs } from "../../../../../lib/jobs.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    return Response.json(await jobs().start((await ctx.params).id));
  } catch (error) {
    return errorResponse(error);
  }
}
