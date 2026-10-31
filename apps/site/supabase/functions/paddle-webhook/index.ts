// Paddle's webhook: keeps `public.subscriptions` in step with each user's Paddle subscription.
// Paddle sends every `subscription.*` event here; the checkout's `custom_data.user_id` says whose
// it is.
import { createClient } from "@supabase/supabase-js";
import { type PaddleSubscription, rpcArgs } from "./subscription.ts";

const SECRET = Deno.env.get("PADDLE_WEBHOOK_SECRET") ?? "";
/** How old a signed event may be, against replays. */
const MAX_AGE_S = 300;

const db = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}").default ?? "",
);

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await req.text();
  if (!(await signed(req.headers.get("Paddle-Signature") ?? "", body))) {
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

/** Checks `Paddle-Signature: ts=<unix seconds>;h1=<hex HMAC-SHA256 of "<ts>:<body>">`. */
async function signed(header: string, body: string): Promise<boolean> {
  const parts = Object.fromEntries(header.split(";").map((part) => part.split("=", 2)));
  const ts = Number(parts.ts);
  if (!SECRET || !parts.h1 || !(Math.abs(Date.now() / 1000 - ts) <= MAX_AGE_S)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const mac = new Uint8Array(
    parts.h1.match(/../g)?.map((byte: string) => parseInt(byte, 16)) ?? [],
  );
  // `verify` compares in constant time.
  return crypto.subtle.verify("HMAC", key, mac, new TextEncoder().encode(`${parts.ts}:${body}`));
}
