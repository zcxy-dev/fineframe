import { checkOrigin, errorResponse, shortParam } from "../../../../../../lib/http.ts";
import { jobs } from "../../../../../../lib/jobs.ts";

export const dynamic = "force-dynamic";

/** Shows version `n`, rendering it again from its record when its video was not kept. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string; n: string }> }) {
  try {
    checkOrigin(request);
    const { id, n } = await ctx.params;
    return Response.json(await jobs().show(id, Number(n), shortParam(request)));
  } catch (error) {
    return errorResponse(error, request);
  }
}
