import { errorResponse } from "../../../../../lib/http.ts";
import { jobs } from "../../../../../lib/jobs.ts";

export const dynamic = "force-dynamic";

/** What the re-edit panel shows of the version shown, or of `?v=<n>`. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const v = new URL(request.url).searchParams.get("v");
    return Response.json(await jobs().view((await ctx.params).id, v ? Number(v) : undefined));
  } catch (error) {
    return errorResponse(error);
  }
}
