import { checkOrigin, errorResponse } from "../../../../../../lib/http.ts";
import { JobError, jobs } from "../../../../../../lib/jobs.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; index: string }> };

/** One file of the edit, as the raw request body, streamed to disk. */
export async function PUT(request: Request, { params }: Context): Promise<Response> {
  try {
    checkOrigin(request);
    const { id, index } = await params;
    if (!request.body) throw new JobError("The file is empty", 400);
    const job = await jobs().receive(id, Number(index), request.body);
    return Response.json(job);
  } catch (error) {
    return errorResponse(error);
  }
}
