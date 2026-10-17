import { errorResponse, fileResponse } from "../../../../../lib/http.ts";
import { JobError, jobs } from "../../../../../lib/jobs.ts";
import { downloadName } from "../../../../../lib/paths.ts";

export const dynamic = "force-dynamic";

/** The credits of the stock footage, icons, screenshots and sound effects the video shows, as
 * text to download. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const store = jobs();
    const job = await store.get((await ctx.params).id);
    const path = await store.output(job.id, "broll");
    if (!path) throw new JobError("This edit has no B-roll credits", 404);
    const name = downloadName(job.settings.length, job.settings.aspect, "broll.txt");
    return await fileResponse(path, request, "text/plain; charset=utf-8", name);
  } catch (error) {
    return errorResponse(error);
  }
}
