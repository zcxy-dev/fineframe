import { checkOrigin, errorResponse, shortParam } from "../../../../../lib/http.ts";
import { LOCALES } from "../../../../../lib/i18n/locale.ts";
import { JobError, jobs } from "../../../../../lib/jobs.ts";
import { checkRevision } from "../../../../../lib/versions.ts";

export const dynamic = "force-dynamic";

/** Applies the changes as a new version of the edit, and renders it. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const body = (await request.json().catch(() => null)) as {
      revision?: unknown;
      summary?: unknown;
      summaries?: Record<string, unknown>;
    } | null;
    const revision = checkRevision(body?.revision);
    if (typeof revision === "string") throw new JobError(revision, 400);
    if (Object.keys(revision).length === 0) throw new JobError((t) => t.server.noChanges, 400);
    const summary = typeof body?.summary === "string" ? body.summary.slice(0, 200) : "Changes";
    // The same summary in each language the page speaks, as the page wrote them.
    const summaries = Object.fromEntries(
      LOCALES.flatMap((locale) => {
        const said = body?.summaries?.[locale];
        return typeof said === "string" ? [[locale, said.slice(0, 200)]] : [];
      }),
    );
    const id = (await ctx.params).id;
    return Response.json(
      await jobs().revise(id, revision, summary, summaries, shortParam(request)),
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
