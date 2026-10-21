import { checkOrigin, errorResponse, uploaded } from "../../../../../lib/http.ts";
import { MAX_LOGO_BYTES, putLogo, removeLogo } from "../../../../../lib/kits.ts";

export const dynamic = "force-dynamic";

/** Takes the request's body, a PNG or an SVG, as the kit's logo. */
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const data = await uploaded(request, MAX_LOGO_BYTES);
    return Response.json(await putLogo((await ctx.params).id, data));
  } catch (error) {
    return errorResponse(error, request);
  }
}

/** Takes the kit's logo out. */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    return Response.json(await removeLogo((await ctx.params).id));
  } catch (error) {
    return errorResponse(error, request);
  }
}
