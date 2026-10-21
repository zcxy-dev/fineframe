import { checkOrigin, errorResponse, uploaded } from "../../../../../../lib/http.ts";
import { JobError } from "../../../../../../lib/jobs.ts";
import { MAX_FONT_BYTES, putFont } from "../../../../../../lib/kits.ts";

export const dynamic = "force-dynamic";

/** Takes the request's body, a TrueType or OpenType font named `?name=`, as the kit's face for
 * the graphics or the captions. */
export async function PUT(request: Request, ctx: { params: Promise<{ id: string; use: string }> }) {
  try {
    checkOrigin(request);
    const { id, use } = await ctx.params;
    if (use !== "graphics" && use !== "captions") throw new JobError("No such use", 404);
    const name = new URL(request.url).searchParams.get("name") ?? "font";
    const data = await uploaded(request, MAX_FONT_BYTES);
    return Response.json(await putFont(id, use, name, data));
  } catch (error) {
    return errorResponse(error, request);
  }
}
