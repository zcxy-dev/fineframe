import { FACES, faceIds } from "@video-editor/engine/faces";
import { checkOrigin, errorResponse } from "../../../lib/http.ts";
import { createKit, listKits } from "../../../lib/kits.ts";

export const dynamic = "force-dynamic";

/** Every brand kit, the default's id, and the bundled faces a kit can name. */
export async function GET(request: Request): Promise<Response> {
  try {
    const faces = faceIds.map((id) => ({ id, name: FACES[id].name }));
    return Response.json({ ...(await listKits()), faces });
  } catch (error) {
    return errorResponse(error, request);
  }
}

/** A new kit, named as the page asks, in the house colours. */
export async function POST(request: Request): Promise<Response> {
  try {
    checkOrigin(request);
    const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
    return Response.json(await createKit(body?.name as string));
  } catch (error) {
    return errorResponse(error, request);
  }
}
