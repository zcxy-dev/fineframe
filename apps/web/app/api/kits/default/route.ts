import { checkOrigin, errorResponse } from "../../../../lib/http.ts";
import { setDefault } from "../../../../lib/kits.ts";

export const dynamic = "force-dynamic";

/** Makes a kit the one the start settings pick, or none with `{ "id": null }`. */
export async function PUT(request: Request): Promise<Response> {
  try {
    checkOrigin(request);
    const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
    await setDefault(typeof body?.id === "string" ? body.id : null);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error, request);
  }
}
