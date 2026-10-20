import { errorResponse, shortParam } from "../../../../../lib/http.ts";
import { jobs } from "../../../../../lib/jobs.ts";

export const dynamic = "force-dynamic";

/** What the re-edit panel shows of the version shown, or of `?v=<n>`, of the edit or of
 * `?short=<folder>`. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const v = new URL(request.url).searchParams.get("v");
    const id = (await ctx.params).id;
    return Response.json(await jobs().view(id, v ? Number(v) : undefined, shortParam(request)));
  } catch (error) {
    return errorResponse(error, request);
  }
}
