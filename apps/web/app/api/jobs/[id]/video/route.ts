import { errorResponse, fileResponse, shortParam } from "../../../../../lib/http.ts";
import { JobError, jobs } from "../../../../../lib/jobs.ts";
import { downloadName } from "../../../../../lib/paths.ts";

export const dynamic = "force-dynamic";

/** The finished MP4, in byte ranges for the player, or whole with `?download`. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const store = jobs();
    const job = await store.get((await ctx.params).id);
    const short = shortParam(request);
    const path = await store.output(job.id, "video", short);
    if (!path) throw new JobError((t) => t.server.notReady, 404);
    const download = new URL(request.url).searchParams.has("download")
      ? downloadName({ ...job, ...(short ? { short } : {}) }, "mp4")
      : undefined;
    return await fileResponse(path, request, "video/mp4", download);
  } catch (error) {
    return errorResponse(error, request);
  }
}
