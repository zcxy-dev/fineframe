import { attachment, checkOrigin, errorResponse, shortParam } from "../../../../../lib/http.ts";
import { jobs } from "../../../../../lib/jobs.ts";
import { zipStream } from "../../../../../lib/zip.ts";

export const dynamic = "force-dynamic";

/** Exports the version shown for an editing app, so the zip then downloads at once. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    await jobs().exportArchive((await ctx.params).id, shortParam(request));
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error, request);
  }
}

/** "Export to an editing app": the timelines for Final Cut Pro, DaVinci Resolve and Premiere
 * Pro, the captions and the files they play but the footage, in one zip. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { name, entries } = await jobs().exportArchive(
      (await ctx.params).id,
      shortParam(request),
    );
    const stream = await zipStream(entries);
    return new Response(stream, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": attachment(name),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return errorResponse(error, request);
  }
}
