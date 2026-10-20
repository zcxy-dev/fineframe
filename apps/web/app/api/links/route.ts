import { checkOrigin, errorResponse } from "../../../lib/http.ts";
import { jobs } from "../../../lib/jobs.ts";

export const dynamic = "force-dynamic";

/** What a pasted link shows, for the page to list it with the footage, or why it cannot be
 * imported. */
export async function POST(request: Request): Promise<Response> {
  try {
    checkOrigin(request);
    const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
    return Response.json(await jobs().readLink(String(body?.url ?? "").trim()));
  } catch (error) {
    return errorResponse(error, request);
  }
}
