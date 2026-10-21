import { checkOrigin, errorResponse } from "../../../lib/http.ts";
import { messagesOf } from "../../../lib/i18n/messages.ts";
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

/** A new edit: its settings, the files the page will send and the links the server will fetch. */
export async function POST(request: Request): Promise<Response> {
  try {
    checkOrigin(request);
    const body = (await request.json().catch(() => null)) as {
      settings?: unknown;
      files?: FileEntry[];
      links?: unknown[];
    } | null;
    const settings = checkSettings(body?.settings, defaultAsr(), messagesOf(request));
    if (typeof settings === "string") throw new JobError(settings, 400);
    // Refused before the page sends any footage, which could not be analysed yet.
    const { state, error } = setup().state;
    if (state !== "ready") {
      throw new JobError(
        (t) => (state === "failed" ? t.server.setupFailed(String(error)) : t.server.settingUp),
        409,
      );
    }
    const links = Array.isArray(body?.links) ? body.links.map(String) : [];
    if (!Array.isArray(body?.files) || body.files.length + links.length === 0) {
      throw new JobError((t) => t.server.noFootage, 400);
    }
    const files = body.files.map((file) => ({
      path: String(file?.path),
      size: Number(file?.size),
    }));
    return Response.json(await jobs().create(settings, files, links), { status: 201 });
  } catch (error) {
    return errorResponse(error, request);
  }
}
