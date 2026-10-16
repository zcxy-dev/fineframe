import { errorResponse } from "../../../../lib/http.ts";
import { jobs } from "../../../../lib/jobs.ts";

export const dynamic = "force-dynamic";

/** The newest edit, which the page shows when it opens; null before the first. */
export async function GET(): Promise<Response> {
  try {
    return Response.json(await jobs().latest());
  } catch (error) {
    return errorResponse(error);
  }
}
