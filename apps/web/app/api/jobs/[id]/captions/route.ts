import { errorResponse, fileResponse } from "../../../../../lib/http.ts";
import { JobError, jobs } from "../../../../../lib/jobs.ts";
import { downloadName } from "../../../../../lib/paths.ts";

export const dynamic = "force-dynamic";

/** The captions burned into the video, as SubRip to download. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const store = jobs();
    const job = await store.get((await ctx.params).id);
    const path = await store.output(job.id, "captions");
    if (!path) throw new JobError("This edit has no captions", 404);
    const name = downloadName(job.settings.length, job.settings.aspect, "srt");
    return await fileResponse(path, request, "application/x-subrip; charset=utf-8", name);
  } catch (error) {
    return errorResponse(error);
  }
}
