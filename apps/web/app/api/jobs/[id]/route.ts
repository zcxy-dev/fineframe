import { checkOrigin, errorResponse } from "../../../../lib/http.ts";
import { jobs } from "../../../../lib/jobs.ts";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  try {
    return Response.json(await jobs().get((await params).id));
  } catch (error) {
    return errorResponse(error, request);
  }
}

/** Cancels the edit: stops it if it runs, and drops its footage. */
export async function DELETE(request: Request, { params }: Context): Promise<Response> {
  try {
    checkOrigin(request);
    return Response.json(await jobs().cancel((await params).id));
  } catch (error) {
    return errorResponse(error, request);
  }
}
