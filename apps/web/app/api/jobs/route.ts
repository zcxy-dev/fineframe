import { checkOrigin, errorResponse } from "../../../lib/http.ts";
import { JobError, jobs } from "../../../lib/jobs.ts";
import { checkSettings, type FileEntry } from "../../../lib/settings.ts";

export const dynamic = "force-dynamic";

/** A new edit: its settings and the files the page will send. */
export async function POST(request: Request): Promise<Response> {
  try {
    checkOrigin(request);
    const body = (await request.json().catch(() => null)) as {
      settings?: unknown;
      files?: FileEntry[];
    } | null;
    const settings = checkSettings(body?.settings);
    if (typeof settings === "string") throw new JobError(settings, 400);
    if (!Array.isArray(body?.files) || body.files.length === 0) {
      throw new JobError("Drop some footage first", 400);
    }
    const files = body.files.map((file) => ({
      path: String(file?.path),
      size: Number(file?.size),
    }));
    return Response.json(await jobs().create(settings, files), { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
