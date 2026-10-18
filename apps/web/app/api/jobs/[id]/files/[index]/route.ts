import { checkOrigin, errorResponse } from "../../../../../../lib/http.ts";
import { JobError, jobs } from "../../../../../../lib/jobs.ts";
import { proxy } from "../../../../../../proxy.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; index: string }> };

/** One file of the edit, as the raw request body, streamed to disk. The proxy does not run for
 * it, so the name it is addressed to is checked here. */
export async function PUT(request: Request, { params }: Context): Promise<Response> {
  const refused = proxy(request);
  if (refused) return refused;
  try {
    checkOrigin(request);
    const { id, index } = await params;
    if (!request.body) throw new JobError((t) => t.server.emptyFile, 400);
    const job = await jobs().receive(id, Number(index), request.body);
    return Response.json(job);
  } catch (error) {
    return errorResponse(error, request);
  }
}
