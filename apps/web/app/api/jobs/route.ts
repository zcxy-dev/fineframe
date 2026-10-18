import { checkOrigin, errorResponse } from "../../../lib/http.ts";
import { JobError, jobs } from "../../../lib/jobs.ts";
import { checkSettings, type FileEntry } from "../../../lib/settings.ts";
import { defaultAsr, setup } from "../../../lib/setup.ts";

export const dynamic = "force-dynamic";

/** Every project, newest first, with the disk space each takes. */
export async function GET(): Promise<Response> {
  try {
    return Response.json(await jobs().list());
  } catch (error) {
    return errorResponse(error);
  }
}

/** A new edit: its settings and the files the page will send. */
export async function POST(request: Request): Promise<Response> {
  try {
    checkOrigin(request);
    const body = (await request.json().catch(() => null)) as {
      settings?: unknown;
      files?: FileEntry[];
    } | null;
    const settings = checkSettings(body?.settings, defaultAsr());
    if (typeof settings === "string") throw new JobError(settings, 400);
    // Refused before the page sends any footage, which could not be analysed yet.
    const { state, error } = setup().state;
    if (state !== "ready") {
      throw new JobError(
        state === "failed"
          ? `The analysis could not be set up: ${error}`
          : "The analysis is still being set up; the page shows how far it is",
        409,
      );
    }
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
