import {
  type AuthError,
  createClient,
  isAuthWeakPasswordError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { shown } from "../supabase/functions/_shared/subscription.ts";
import type { Content } from "./content.ts";
import type { Plan } from "./paddle.ts";
import { href, type Locale } from "./site.ts";

export { entitled, paddleBilled, shown } from "../supabase/functions/_shared/subscription.ts";

let client: SupabaseClient | undefined;

/** The browser's Supabase client. Its session lives in the browser's local storage. */
export function supabase(): SupabaseClient {
  client ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  return client;
}

/** One of a user's rows of `subscriptions`, one per subscription, as ENTITLEMENT.md describes it. */
export type Subscription = {
  status: "active" | "trialing" | "past_due" | "paused" | "canceled";
  plan: "monthly" | "yearly";
  current_period_end: string | null;
  cancel_at: string | null;
  paddle_customer_id: string;
  paddle_updated_at: string;
};

/** Whether Fineframe charges yet: `app_config.billing_enabled`, false during the free beta. */
export async function billingEnabled(): Promise<boolean> {
  const { data, error } = await supabase().from("app_config").select("billing_enabled").single();
  if (error) throw error;
  return data.billing_enabled;
}

/** The signed-in user's subscription that speaks for them, as `shown` picks it. */
export async function mySubscription(): Promise<Subscription | null> {
  const { data, error } = await supabase()
    .from("subscriptions")
    .select("status,plan,current_period_end,cancel_at,paddle_customer_id,paddle_updated_at");
  if (error) throw error;
  return shown(data);
}

/**
 * Where to go after signing in: the page's `?next=` when it is a path on this site, else the
 * account page.
 */
export function nextPath(
  locale: Locale,
  { search, origin }: Pick<Location, "search" | "origin"> = window.location,
): string {
  const next = new URLSearchParams(search).get("next");
  if (next?.startsWith("/")) {
    // Parsed as the browser will go there: it reads `/\host` and `/<tab>/host` as another site.
    const url = new URL(next, origin);
    if (url.origin === origin) return url.pathname + url.search + url.hash;
  }
  return href(locale, "/account/");
}

/** The sign-in page, which comes back to `next` after. */
export function signInHref(locale: Locale, next: string): string {
  return `${href(locale, "/signin/")}?next=${encodeURIComponent(next)}`;
}

/** The sign-up page, which comes back to `next` once the email is confirmed. */
export function signUpHref(locale: Locale, next: string): string {
  return `${href(locale, "/signup/")}?next=${encodeURIComponent(next)}`;
}

/** The plan a `?next=` back to the plans names, which the sign-in and sign-up pages mention. */
export function nextPlan({ search }: Pick<Location, "search"> = window.location): Plan | undefined {
  const next = new URLSearchParams(search).get("next");
  const plan = next ? new URLSearchParams(next.split("?")[1] ?? "").get("plan") : null;
  return plan === "monthly" || plan === "yearly" ? plan : undefined;
}

/** Sends a signed-out visitor to sign in, coming back here after. */
export function signInFirst(locale: Locale): void {
  window.location.replace(signInHref(locale, window.location.pathname + window.location.search));
}

export function errorText(t: Content["auth"]["errors"], error: AuthError | Error): string {
  const code = "code" in error ? error.code : undefined;
  if (code === "invalid_credentials") return t.invalid;
  if (code === "email_not_confirmed") return t.unconfirmed;
  if (isAuthWeakPasswordError(error) && error.reasons.includes("pwned")) return t.leaked;
  if (code === "weak_password") return t.weak;
  if (code === "email_address_invalid" || code === "email_address_not_authorized") return t.address;
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit") return t.rate;
  return t.generic;
}
