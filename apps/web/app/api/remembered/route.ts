import { errorResponse } from "../../../lib/http.ts";
import { defaultRoot } from "../../../lib/jobs.ts";
import { remembered } from "../../../lib/remembered.ts";

export const dynamic = "force-dynamic";

/** The people's names and terms the last edit was given, to fill in for the next one. */
export async function GET(): Promise<Response> {
  try {
    return Response.json(await remembered(defaultRoot()));
  } catch (error) {
    return errorResponse(error);
  }
}
