// The account page's "Manage billing": a signed-in user's link into Paddle's customer portal,
// signed in as their Paddle customer.
import { createClient } from "@supabase/supabase-js";

const PADDLE_API =
  Deno.env.get("PADDLE_ENVIRONMENT") === "production"
    ? "https://api.paddle.com"
    : "https://sandbox-api.paddle.com";

const db = createClient(
  Deno.env.get("SUPABASE_URL") ?? "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
);

// The site calls it from the browser, on another origin.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  const reply = (status: number, body: object) => Response.json(body, { status, headers: CORS });

  const jwt = req.headers.get("Authorization")?.replace(/^Bearer /, "") ?? "";
  const { data: auth } = await db.auth.getUser(jwt);
  if (!auth.user) return reply(401, { error: "Sign in first" });

  const { data: row } = await db
    .from("subscriptions")
    .select("paddle_customer_id,paddle_subscription_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!row) return reply(404, { error: "No subscription" });

  const res = await fetch(`${PADDLE_API}/customers/${row.paddle_customer_id}/portal-sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("PADDLE_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ subscription_ids: [row.paddle_subscription_id] }),
  });
  if (!res.ok) {
    console.error(
      `portal session for ${row.paddle_customer_id}: ${res.status} ${await res.text()}`,
    );
    return reply(502, { error: "Paddle did not answer" });
  }
  const session = (await res.json()) as { data: { urls: { general: { overview: string } } } };
  return reply(200, { url: session.data.urls.general.overview });
});
