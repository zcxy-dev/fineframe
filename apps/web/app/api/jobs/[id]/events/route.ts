import { errorResponse } from "../../../../../lib/http.ts";
import { type Job, jobs } from "../../../../../lib/jobs.ts";

export const dynamic = "force-dynamic";

/** Server-sent events: the job now, then after every change, until the page goes away. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const store = jobs();
    const job = await store.get((await ctx.params).id);
    const encoder = new TextEncoder();
    let stop = () => {};
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const send = (text: string) => {
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            stop();
          }
        };
        const update = (current: Job) => send(`data: ${JSON.stringify(current)}\n\n`);
        update(job);
        const unsubscribe = store.subscribe(job.id, update);
        // A comment now and then keeps proxies from closing a quiet stream during a long render.
        const timer = setInterval(() => send(": still here\n\n"), 15_000);
        stop = () => {
          clearInterval(timer);
          unsubscribe();
        };
        request.signal.addEventListener("abort", () => {
          stop();
          try {
            controller.close();
          } catch {
            // Already closed.
          }
        });
      },
      cancel() {
        stop();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
