import { faceFile } from "@video-editor/engine/brand";
import { isFaceId } from "@video-editor/engine/faces";
import { errorResponse, fileResponse } from "../../../../lib/http.ts";
import { JobError } from "../../../../lib/jobs.ts";

export const dynamic = "force-dynamic";

/** A bundled face, downloaded on its first use, for the brand kit page's preview; 204 for the
 * house face, which the page already has. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    if (!isFaceId(id)) throw new JobError("No such font", 404);
    const path = await faceFile(id);
    if (!path) return new Response(null, { status: 204 });
    return await fileResponse(path, request, path.endsWith(".otf") ? "font/otf" : "font/ttf");
  } catch (error) {
    return errorResponse(error, request);
  }
}
