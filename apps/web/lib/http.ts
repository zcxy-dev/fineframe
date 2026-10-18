// Serving the outputs: byte ranges for the player, whole files for a download.
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { en, messagesOf } from "./i18n/messages.ts";
import { JobError } from "./jobs.ts";

/**
 * The bytes a Range header asks for, as `[start, end]` inclusive; null without one, or for a
 * form a player does not send (several ranges, other units). "invalid" when it lies past the end.
 */
function byteRange(header: string | null, size: number): [number, number] | null | "invalid" {
  const match = header?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const [, from, to] = match;
  if (from === "" && to === "") return null;
  let start: number;
  let end: number;
  if (from === "") {
    // The last `to` bytes.
    start = Math.max(0, size - Number(to));
    end = size - 1;
  } else {
    start = Number(from);
    end = to === "" ? size - 1 : Math.min(Number(to), size - 1);
  }
  if (start > end || start >= size) return "invalid";
  return [start, end];
}

/** A file as a response, with byte ranges so the player can seek, and as a download if named. */
export async function fileResponse(
  path: string,
  request: Request,
  type: string,
  download?: string,
): Promise<Response> {
  const { size } = await stat(path);
  const headers = new Headers({
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  });
  if (download) headers.set("Content-Disposition", attachment(download));
  const range = byteRange(request.headers.get("range"), size);
  if (range === "invalid") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  const [start, end] = range ?? [0, size - 1];
  headers.set("Content-Length", String(end - start + 1));
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
  const stream = createReadStream(path, { start, end });
  request.signal.addEventListener("abort", () => stream.destroy());
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
    status: range ? 206 : 200,
    headers,
  });
}

function attachment(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Refuses a request another site sends through the user's browser: a plain form or text POST
 * needs no CORS preflight, and listening on 127.0.0.1 does not stop it.
 */
export function checkOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (origin && URL.parse(origin)?.host !== request.headers.get("host")) {
    throw new JobError((t) => t.server.otherSite, 403);
  }
}

/** A JobError as the JSON the page reads, in the language `request` asks for; anything else is a
 * bug, logged and hidden. */
export function errorResponse(error: unknown, request?: Request): Response {
  const t = request ? messagesOf(request) : en;
  if (error instanceof JobError) {
    const code = error.code ? { code: error.code } : {};
    return Response.json({ error: error.say(t), ...code }, { status: error.status });
  }
  console.error(error);
  return Response.json({ error: t.server.wrong }, { status: 500 });
}
