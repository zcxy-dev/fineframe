import { totalmem } from "node:os";
import { checkOrigin, errorResponse } from "../../../lib/http.ts";
import { defaultAsr, LOCAL_SPEECH_MEMORY, setup } from "../../../lib/setup.ts";

export const dynamic = "force-dynamic";

/** Whether the analysis can run yet, and where speech is heard unless the page says otherwise,
 * from this computer's memory. Asking starts the analysis's setup where it is needed. */
export async function GET(): Promise<Response> {
  const current = setup();
  current.start();
  const memory = totalmem();
  return Response.json({
    ...current.state,
    memory,
    needed: LOCAL_SPEECH_MEMORY,
    asr: defaultAsr(memory),
  });
}

/** Tries a failed setup again. */
export async function POST(request: Request): Promise<Response> {
  try {
    checkOrigin(request);
    setup().start();
    return GET();
  } catch (error) {
    return errorResponse(error, request);
  }
}
