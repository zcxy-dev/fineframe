"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Plan } from "../../lib/paddle.ts";
import { href, type Locale } from "../../lib/site.ts";
import { ERROR, NOTICE } from "../../lib/styles.ts";
import { Button } from "../ui/button.tsx";

// Supabase and Paddle load only once the plan comes near the screen, so the pages that show
// plans paint, and the home page loads, without their code.
const accounts = () => import("../../lib/supabase.ts");
const payments = () => import("../../lib/paddle.ts");

/**
 * A plan's checkout button, once billing is on; until then, "Opening soon". A signed-out
 * visitor creates an account (or signs in) first and comes back with `?plan=`, which opens that
 * plan's checkout; a subscriber is sent to their account instead.
 */
export function Subscribe({
  locale,
  plan,
  labels: t,
  subscribed: subscribedText,
}: {
  locale: Locale;
  plan: Plan;
  /** The button, what a failed checkout says, and what shows until billing is on. */
  labels: { subscribe: string; failed: string; soon: string };
  /** What a subscriber sees instead of the button, set by the page. */
  subscribed: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [selling, setSelling] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const check = () =>
      accounts()
        .then(async ({ billingEnabled, entitled, mySubscription, supabase }) => {
          if (!(await billingEnabled())) return;
          setSelling(true);
          const { data } = await supabase().auth.getSession();
          if (!data.session) return;
          if (entitled(await mySubscription())) return setSubscribed(true);
          if (new URLSearchParams(window.location.search).get("plan") === plan) checkout();
        })
        .catch(() => setSelling(false));
    // The plan is asked about only once it comes near, so a page that shows plans far down
    // loads Supabase only when they are about to be seen.
    const el = root.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        check();
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [plan]);

  async function checkout() {
    setBusy(true);
    setError("");
    const { signUpHref, supabase } = await accounts();
    const { data } = await supabase().auth.getSession();
    if (!data.session) {
      return window.location.assign(
        signUpHref(locale, `${href(locale, "/pricing/")}?plan=${plan}`),
      );
    }
    const { loadPaddle, PRICE } = await payments();
    const paddle = await loadPaddle().catch(() => undefined);
    setBusy(false);
    // Without Paddle.js, or a build without Paddle's values, there is no checkout to open.
    if (!paddle || !PRICE[plan]) return setError(t.failed);
    paddle.Checkout.open({
      items: [{ priceId: PRICE[plan], quantity: 1 }],
      customer: { email: data.session.user.email as string },
      // The webhook files the subscription under this user.
      customData: { user_id: data.session.user.id },
      settings: {
        displayMode: "overlay",
        theme: "light",
        locale: locale === "zh-tw" ? "zh-Hant" : "en",
        successUrl: `${window.location.origin}${href(locale, "/account/")}?checkout=done`,
      },
    });
  }

  const chip = "text-[15px] font-semibold text-ink-2";
  return (
    <div ref={root} className="grid justify-items-start gap-4">
      {!selling ? (
        <p className={chip}>{t.soon}</p>
      ) : subscribed ? (
        <p className={chip}>{subscribedText}</p>
      ) : (
        <Button type="button" onClick={checkout} disabled={busy}>
          {t.subscribe}
        </Button>
      )}
      {error && (
        <p className={`${NOTICE} ${ERROR}`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
