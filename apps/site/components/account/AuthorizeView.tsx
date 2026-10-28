"use client";

import { useEffect, useState } from "react";
import { content } from "../../lib/content.ts";
import { lastTwo } from "../../lib/english.ts";
import type { Locale } from "../../lib/site.ts";
import { NOTICE, PROSE } from "../../lib/styles.ts";
import { signInFirst, supabase } from "../../lib/supabase.ts";
import { Button } from "../ui/button.tsx";

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
      <div className="mt-3 flex flex-wrap gap-3">
        <Button type="button" onClick={() => decide(true)} disabled={busy}>
          {t.allow}
        </Button>
        <Button type="button" variant="outline" onClick={() => decide(false)} disabled={busy}>
          {t.deny}
        </Button>
      </div>
      <p className="text-sm text-ink-3">
        <button
          type="button"
          className="cursor-pointer bg-transparent p-0 text-ink-2 underline decoration-line underline-offset-[3px] hover:decoration-ink"
          onClick={switchAccount}
          disabled={busy}
        >
          {t.switch}
        </button>
      </p>
    </div>
  );
}
