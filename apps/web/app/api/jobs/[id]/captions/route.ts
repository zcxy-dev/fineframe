import { errorResponse, fileResponse, shortParam } from "../../../../../lib/http.ts";
import { JobError, jobs } from "../../../../../lib/jobs.ts";
import { downloadName } from "../../../../../lib/paths.ts";

export const dynamic = "force-dynamic";

/** The captions burned into the video, as SubRip to download. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const store = jobs();
    const job = await store.get((await ctx.params).id);
    const short = shortParam(request);
    const path = await store.output(job.id, "captions", short);
    if (!path) throw new JobError((t) => t.server.noCaptions, 404);
    const name = downloadName({ ...job, ...(short ? { short } : {}) }, "srt");
    return await fileResponse(path, request, "application/x-subrip; charset=utf-8", name);
  } catch (error) {
    return errorResponse(error, request);
  }
}
