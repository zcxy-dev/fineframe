"use client";

import { useEffect, useState } from "react";
import { content } from "../../lib/content.ts";
import { lastTwo } from "../../lib/english.ts";
import type { Locale } from "../../lib/site.ts";
import { HINT, NOTICE, PROSE } from "../../lib/styles.ts";
import {
  billingEnabled,
  entitled,
  mySubscription,
  signInFirst,
  supabase,
} from "../../lib/supabase.ts";
import { Phrases, Rich } from "../Rich.tsx";
import { Button } from "../ui/button.tsx";

const TEXT_BUTTON =
  "cursor-pointer bg-transparent p-0 text-ink-2 underline decoration-line underline-offset-[3px] hover:decoration-ink";

/**
 * The consent step of the app's sign-in (ENTITLEMENT.md): Supabase sends the browser here with
 * `?authorization_id=`, and approving sends it on to the app's loopback address with a code.
 */
export function AuthorizeView({ locale }: { locale: Locale }) {
  const t = content(locale).authorize;
  const [id, setId] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  // Once purchases open, an account with no plan learns it here rather than in the app.
  const [noPlan, setNoPlan] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("authorization_id");
    if (!id) return setMessage(t.invalid);
    const auth = supabase().auth;
    auth.getSession().then(async ({ data }) => {
      if (!data.session) return signInFirst(locale);
      const details = await auth.oauth.getAuthorizationDetails(id);
      if (details.error) return setMessage(t.invalid);
      // Approved before: Supabase answers with where to send the browser.
      if ("redirect_url" in details.data) {
        setMessage(t.done);
        return window.location.assign(details.data.redirect_url);
      }
      setId(id);
      setEmail(details.data.user.email);
      const noPlan = await Promise.all([billingEnabled(), mySubscription()])
        .then(([on, row]) => on && !entitled(row))
        .catch(() => false);
      setNoPlan(noPlan);
    });
  }, [locale, t]);

  async function decide(allow: boolean) {
    setBusy(true);
    const auth = supabase().auth.oauth;
    const { data, error } = allow
      ? await auth.approveAuthorization(id, { skipBrowserRedirect: true })
      : await auth.denyAuthorization(id, { skipBrowserRedirect: true });
    if (error) {
      setBusy(false);
      setMessage(t.invalid);
    } else {
      setMessage(t.done);
      window.location.assign(data.redirect_url);
    }
  }

  async function switchAccount() {
    await supabase().auth.signOut();
    signInFirst(locale);
  }

  if (message || !email) {
    return (
      <p className={NOTICE} role="status">
        {lastTwo(message || content(locale).auth.working)}
      </p>
    );
  }

  return (
    <div className="grid gap-5">
      <p className={PROSE}>{lastTwo(t.lede.replace("{email}", email))}</p>
      <p className={HINT}>
        <Phrases text={t.shares} locale={locale} />
      </p>
      {noPlan && (
        <p className={NOTICE} role="status">
          <Rich text={t.noPlan} locale={locale} />
        </p>
      )}
      <div className="mt-3">
        <Button type="button" onClick={() => decide(true)} disabled={busy}>
          {t.allow}
        </Button>
      </div>
      <p className="flex flex-wrap gap-x-5 gap-y-2 text-small">
        <button type="button" className={TEXT_BUTTON} onClick={() => decide(false)} disabled={busy}>
          {t.deny}
        </button>
        <button type="button" className={TEXT_BUTTON} onClick={switchAccount} disabled={busy}>
          {t.switch}
        </button>
      </p>
    </div>
  );
}
