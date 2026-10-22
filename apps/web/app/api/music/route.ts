import { libraryTracks } from "@video-editor/engine/library";
import { errorResponse } from "../../../lib/http.ts";

export const dynamic = "force-dynamic";

/** The built-in music library: each track's id, title, artist, mood, length and tempo. */
export async function GET(request: Request): Promise<Response> {
  try {
    return Response.json(
      libraryTracks().map(({ id, title, artist, mood, seconds, bpm }) => ({
        ...{ id, title, artist, mood, seconds, bpm },
      })),
    );
  } catch (error) {
    return errorResponse(error, request);
  }
}
