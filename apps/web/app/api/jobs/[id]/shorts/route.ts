import { attachment, errorResponse } from "../../../../../lib/http.ts";
import { jobs } from "../../../../../lib/jobs.ts";
import { zipStream } from "../../../../../lib/zip.ts";

export const dynamic = "force-dynamic";

/** "Download all": every short's video and captions, and their titles, descriptions and
 * hashtags, in one zip. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { name, entries } = await jobs().shortsArchive((await ctx.params).id);
    const stream = await zipStream(entries);
    return new Response(stream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": attachment(name),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
