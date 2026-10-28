import { type AuthError, createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Content } from "./content.ts";
import { href, type Locale } from "./site.ts";

let client: SupabaseClient | undefined;

/** The browser's Supabase client. Its session lives in the browser's local storage. */
export function supabase(): SupabaseClient {
  client ??= createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY as string,
  );
  return client;
}

/** A user's row of `subscriptions`, as ENTITLEMENT.md describes it. */
export type Subscription = {
  status: "active" | "trialing" | "past_due" | "paused" | "canceled";
  plan: "monthly" | "yearly";
  current_period_end: string | null;
  cancel_at: string | null;
};

/** Whether Fineframe charges yet: `app_config.billing_enabled`, false during the free beta. */
export async function billingEnabled(): Promise<boolean> {
  const { data, error } = await supabase().from("app_config").select("billing_enabled").single();
  if (error) throw error;
  return data.billing_enabled;
}

export async function mySubscription(): Promise<Subscription | null> {
  const { data, error } = await supabase()
    .from("subscriptions")
    .select("status,plan,current_period_end,cancel_at")
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** The rule in ENTITLEMENT.md: whether the subscription lets its user use the app. */
export function entitled(row: Subscription | null, now = new Date()): boolean {
  if (!row) return false;
  if (row.status === "active" || row.status === "trialing" || row.status === "past_due") {
    return true;
  }
  return (
    row.status === "canceled" &&
    row.current_period_end !== null &&
    new Date(row.current_period_end) > now
  );
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

/** Sends a signed-out visitor to sign in, coming back here after. */
export function signInFirst(locale: Locale): void {
  window.location.replace(signInHref(locale, window.location.pathname + window.location.search));
}

export function errorText(t: Content["auth"]["errors"], error: AuthError | Error): string {
  const code = "code" in error ? error.code : undefined;
  if (code === "invalid_credentials") return t.invalid;
  if (code === "email_not_confirmed") return t.unconfirmed;
  if (code === "weak_password") return t.weak;
  if (code === "email_address_invalid" || code === "email_address_not_authorized") return t.address;
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit") return t.rate;
  return t.generic;
}
