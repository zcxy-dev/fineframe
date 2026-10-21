import { errorResponse, fileResponse } from "../../../../../../lib/http.ts";
import { JobError } from "../../../../../../lib/jobs.ts";
import { kitFile } from "../../../../../../lib/kits.ts";

export const dynamic = "force-dynamic";

/** A kit's logo or uploaded font, for the page's preview. */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ id: string; which: string }> },
) {
  try {
    const { id, which } = await ctx.params;
    if (which !== "logo" && which !== "graphics" && which !== "captions") {
      throw new JobError("No such file", 404);
    }
    const file = await kitFile(id, which);
    if (!file) throw new JobError("No such file", 404);
    const response = await fileResponse(file.path, request, file.type);
    // An SVG opened on its own runs nothing and loads nothing.
    response.headers.set(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
    return response;
  } catch (error) {
    return errorResponse(error, request);
  }
}
