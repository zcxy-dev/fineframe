"use client";

import { useEffect, useState } from "react";
import { content } from "../../lib/content.ts";
import { lastTwo } from "../../lib/english.ts";
import { href, LANG, type Locale } from "../../lib/site.ts";
import { CARD, ERROR, HEADING, HINT, NOTICE, PROSE } from "../../lib/styles.ts";
import {
  billingEnabled,
  entitled,
  mySubscription,
  paddleBilled,
  type Subscription,
  signInFirst,
  supabase,
} from "../../lib/supabase.ts";
import { Plans } from "../Plans.tsx";
import { Button, buttonClass } from "../ui/button.tsx";

/** How often, and how many times, to look again for the row a checkout's webhook writes. */
const CONFIRM_EVERY_MS = 2000;
const CONFIRM_TRIES = 15;

/**
 * The signed-in user's subscription and its billing beside the download, and the plans under
 * them until the account has one.
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

  // The status's dot: amber while the plan runs, red once it needs attention or has ended.
  const tone =
    !billing || !row
      ? "bg-steel"
      : entitled(row)
        ? row.status === "past_due"
          ? "bg-cut"
          : "bg-amber"
        : row.status === "canceled"
          ? "bg-cut"
          : "bg-steel";

  return (
    <div className="grid gap-block">
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
        <section className={CARD} aria-labelledby="subscription">
          <h2 id="subscription" className={HEADING}>
            {t.subscriptionTitle}
          </h2>
          <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 [&_dt]:text-fine [&_dt]:text-ink-3 [&_dd]:mt-1">
            <div className="min-w-0">
              <dt>{t.signedInAs}</dt>
              <dd className="truncate">{email}</dd>
            </div>
            <div>
              <dt>{t.statusTitle}</dt>
              <dd>
                <strong
                  className="inline-flex items-center gap-2 rounded-full bg-ground px-3 py-1 text-small"
                  data-status={billing ? (row?.status ?? "none") : "soon"}
                >
                  <span className={`size-2 rounded-full ${tone}`} aria-hidden="true" />
                  {status.label}
                  {billing && row && ` · ${t.plans[row.plan]}`}
                </strong>
              </dd>
            </div>
          </dl>
          {status.note && <p className="mt-5 text-ink-2">{lastTwo(status.note)}</p>}
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
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4 border-t pt-6">
            {billing && row && paddleBilled(row) && (
              <Button type="button" variant="outline" size="sm" onClick={manage} disabled={busy}>
                {t.manage}
              </Button>
            )}
            <button
              type="button"
              className="cursor-pointer bg-transparent p-0 text-small text-ink-2 underline decoration-line underline-offset-[3px] hover:decoration-ink"
              onClick={signOut}
            >
              {t.signOut}
            </button>
          </div>
          {billing && row && paddleBilled(row) && (
            <p className={`${HINT} mt-4`}>{lastTwo(t.manageNote)}</p>
          )}
        </section>
        <section className={CARD} aria-labelledby="download">
          <h2 id="download" className={HEADING}>
            {t.downloadTitle}
          </h2>
          <p className={PROSE}>{lastTwo(t.downloadBody)}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              className={buttonClass({ variant: hasPlan ? "default" : "outline", size: "sm" })}
              href={href(locale, "/download/")}
            >
              {t.download}
            </a>
          </div>
        </section>
      </div>
      {!hasPlan && (
        <section aria-labelledby="plans">
          <h2 id="plans" className="mb-8 text-center text-heading">
            {t.choose}
          </h2>
          <div className="mx-auto max-w-[1000px]">
            <Plans locale={locale} />
          </div>
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
        : {
            label: t.active,
            note: row.current_period_end
              ? t.renews.replace("{date}", date(row.current_period_end))
              : undefined,
          };
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
