import { checkOrigin, errorResponse } from "../../../../lib/http.ts";
import { removeKit, saveKit } from "../../../../lib/kits.ts";

export const dynamic = "force-dynamic";

/** Saves a kit's name, colours, fonts, logo settings and custom captions. */
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const body = await request.json().catch(() => null);
    return Response.json(await saveKit((await ctx.params).id, body));
  } catch (error) {
    return errorResponse(error, request);
  }
}

/** Deletes a kit; edits made with it keep their own copy. */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    await removeKit((await ctx.params).id);
    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error, request);
  }
}
