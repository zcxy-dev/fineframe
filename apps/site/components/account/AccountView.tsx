"use client";

import { useEffect, useState } from "react";
import { content } from "../../lib/content.ts";
import { lastTwo } from "../../lib/english.ts";
import type { Plan } from "../../lib/paddle.ts";
import { href, LANG, type Locale } from "../../lib/site.ts";
import { CARD, ERROR, HEADING, HINT, NOTICE, PROSE } from "../../lib/styles.ts";
import {
  billingEnabled,
  entitled,
  mySubscription,
  type Subscription,
  signInFirst,
  supabase,
} from "../../lib/supabase.ts";
import { Rich } from "../Rich.tsx";
import { Button, buttonClass } from "../ui/button.tsx";
import { Subscribe } from "./Subscribe.tsx";

/** How often, and how many times, to look again for the row a checkout's webhook writes. */
const CONFIRM_EVERY_MS = 2000;
const CONFIRM_TRIES = 15;

const PLANS: Plan[] = ["monthly", "yearly"];

/**
 * The signed-in user's subscription and its billing; then the download once the account has a
 * plan, or the plans until it has one.
 */
export function AccountView({ locale }: { locale: Locale }) {
  const all = content(locale);
  const t = all.account;
  const [email, setEmail] = useState<string>();
  const [row, setRow] = useState<Subscription | null>();
  const [billing, setBilling] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    // Paddle comes back here with `?checkout=done` before its webhook may have arrived.
    const afterCheckout = new URLSearchParams(window.location.search).has("checkout");
    async function load() {
      const [on, row] = await Promise.all([billingEnabled(), mySubscription()]);
      setBilling(on);
      setRow(row);
      const waiting = afterCheckout && row?.status !== "active" && ++tries < CONFIRM_TRIES;
      setConfirming(waiting);
      if (waiting) timer = setTimeout(load, CONFIRM_EVERY_MS);
    }
    supabase()
      .auth.getSession()
      .then(({ data }) => {
        if (!data.session) return signInFirst(locale);
        setEmail(data.session.user.email);
        return load();
      })
      .catch(() => setError(content(locale).auth.errors.generic));
    return () => clearTimeout(timer);
  }, [locale]);

  async function manage() {
    setBusy(true);
    setError("");
    const { data, error } = await supabase().functions.invoke<{ url: string }>("paddle-portal");
    if (error || !data) {
      setBusy(false);
      setError(content(locale).auth.errors.generic);
    } else {
      window.location.assign(data.url);
    }
  }

  async function signOut() {
    await supabase().auth.signOut();
    window.location.assign(href(locale, "/"));
  }

  if (email === undefined || row === undefined) {
    return (
      <p className={NOTICE} role={error ? "alert" : "status"}>
        {error || content(locale).auth.working}
      </p>
    );
  }

  const date = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat(LANG[locale], { dateStyle: "long" }).format(new Date(iso)) : "";
  const status = billing
    ? statusLine(t.status, row, date)
    : { label: t.status.none, note: t.status.soon };
  const hasPlan = billing && entitled(row);

  return (
    <div className="grid items-start gap-4 md:grid-cols-2">
      <section className={CARD} aria-labelledby="subscription">
        <h2 id="subscription" className={HEADING}>
          {t.subscriptionTitle}
        </h2>
        <dl className="grid max-w-[62ch] gap-4 [&_dt]:text-sm [&_dt]:text-ink-3">
          <div>
            <dt>{t.signedInAs}</dt>
            <dd>{email}</dd>
          </div>
          <div>
            <dt>{t.statusTitle}</dt>
            <dd>
              <strong data-status={billing ? (row?.status ?? "none") : "soon"}>
                {status.label}
              </strong>
              {billing && row && ` · ${t.plans[row.plan]}`}
              {status.note && <span className="mt-1 block text-ink-2">{lastTwo(status.note)}</span>}
            </dd>
          </div>
        </dl>
        {confirming && (
          <p className={`${NOTICE} mt-5`} role="status">
            {lastTwo(t.status.confirming)}
          </p>
        )}
        {error && (
          <p className={`${NOTICE} ${ERROR} mt-5`} role="alert">
            {error}
          </p>
        )}
        {billing && row && (
          <>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button type="button" onClick={manage} disabled={busy}>
                {t.manage}
              </Button>
            </div>
            <p className={`${HINT} mt-5`}>{lastTwo(t.manageNote)}</p>
          </>
        )}
        <p className="mt-8 text-sm">
          <button
            type="button"
            className="cursor-pointer bg-transparent p-0 text-ink-2 underline decoration-line underline-offset-[3px] hover:decoration-ink"
            onClick={signOut}
          >
            {t.signOut}
          </button>
        </p>
      </section>
      {hasPlan ? (
        <section className={CARD} aria-labelledby="download">
          <h2 id="download" className={HEADING}>
            {t.downloadTitle}
          </h2>
          <p className={PROSE}>{lastTwo(t.downloadBody)}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a className={buttonClass()} href={href(locale, "/download/")}>
              {t.download}
            </a>
          </div>
        </section>
      ) : (
        <section className={CARD} aria-labelledby="plans">
          <h2 id="plans" className={HEADING}>
            {t.choose}
          </h2>
          <ul className="divide-y">
            {all.pricing.plans.map((plan, i) => (
              <li
                key={plan.name}
                className="flex flex-wrap items-center justify-between gap-4 py-5 first:pt-0"
              >
                <div>
                  <p className="font-semibold">{plan.name}</p>
                  <p className="text-[28px] leading-tight font-bold tracking-[-0.03em] tabular-nums">
                    {plan.price}
                    <span className="ml-1 text-sm font-medium tracking-normal text-ink-3">
                      {plan.period}
                    </span>
                  </p>
                  <p className="text-sm text-ink-3">{lastTwo(plan.billing)}</p>
                </div>
                <Subscribe
                  locale={locale}
                  plan={PLANS[i] as Plan}
                  labels={{
                    subscribe: all.checkout.subscribe,
                    failed: all.checkout.failed,
                    soon: all.pricing.checkout,
                  }}
                  subscribed={<Rich text={all.checkout.subscribed} locale={locale} />}
                />
              </li>
            ))}
          </ul>
          <p className={`${HINT} mt-2`}>{lastTwo(all.pricing.terms)}</p>
          <p className={`${HINT} mt-3`}>
            <a href={href(locale, "/download/")}>{t.download}</a>
          </p>
        </section>
      )}
    </div>
  );
}

function statusLine(
  t: ReturnType<typeof content>["account"]["status"],
  row: Subscription | null,
  date: (iso: string | null) => string,
): { label: string; note?: string } {
  if (!row) return { label: t.none, note: t.noneNote };
  switch (row.status) {
    case "active":
    case "trialing":
      return row.cancel_at
        ? { label: t.cancelled, note: t.until.replace("{date}", date(row.cancel_at)) }
        : { label: t.active, note: t.renews.replace("{date}", date(row.current_period_end)) };
    case "past_due":
      return { label: t.pastDue, note: t.pastDueNote };
    case "paused":
      return { label: t.paused };
    case "canceled":
      return entitled(row)
        ? { label: t.cancelled, note: t.until.replace("{date}", date(row.current_period_end)) }
        : { label: t.ended };
  }
}
