// Paddle's webhook: keeps `public.subscriptions` in step with Paddle, one row per subscription.
// Paddle sends every `subscription.*` event here; the checkout's `custom_data.user_id` says whose
// it is.
import { createClient } from "@supabase/supabase-js";
import { signed } from "./signature.ts";
import { type PaddleSubscription, rpcArgs } from "./subscription.ts";

const SECRET = Deno.env.get("PADDLE_WEBHOOK_SECRET") ?? "";

const db = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default ?? "",
);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await req.text();
  if (!(await signed(req.headers.get("Paddle-Signature") ?? "", body, SECRET, Date.now()))) {
    return new Response("Bad signature", { status: 401 });
  }
  const event = JSON.parse(body) as { event_type: string; data: PaddleSubscription };
  if (!event.event_type.startsWith("subscription.")) return new Response("Ignored");

  const sub = event.data;
  const args = rpcArgs(sub);
  if (!args) {
    // Not one of the site's checkouts: nothing to file, and nothing for Paddle to retry.
    console.warn(`${event.event_type} ${sub.id}: no user id or plan`);
    return new Response("Ignored");
  }
  const { error } = await db.rpc("apply_paddle_subscription", args);
  if (error) {
    // Paddle retries a failed delivery.
    console.error(`${event.event_type} ${sub.id}: ${error.message}`);
    return new Response("Could not save", { status: 500 });
  }
  return new Response("OK");
});
