import { catalogTracks, fetchTrack } from "@video-editor/engine/library";
import { errorResponse, fileResponse } from "../../../../lib/http.ts";
import { JobError } from "../../../../lib/jobs.ts";

export const dynamic = "force-dynamic";

/** A library track's audio, for the music picker's preview: downloaded and checked on its first
 * play, as an edit that plays it would. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const track = catalogTracks().find((each) => each.id === id);
    if (!track) throw new JobError((t) => t.server.noTrack, 404);
    return await fileResponse(await fetchTrack(track), request, "audio/mpeg");
  } catch (error) {
    return errorResponse(error, request);
  }
}
