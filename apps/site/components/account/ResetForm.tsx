"use client";

import { type FormEvent, useEffect, useState } from "react";
import { content } from "../../lib/content.ts";
import { lastTwo } from "../../lib/english.ts";
import { href, type Locale } from "../../lib/site.ts";
import { ERROR, HINT, NOTICE } from "../../lib/styles.ts";
import { errorText, supabase } from "../../lib/supabase.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Label } from "../ui/label.tsx";

/**
 * Asking for a link to reset the password, or, opened from that link, choosing the new
 * password.
 */
export function ResetForm({ locale }: { locale: Locale }) {
  const t = content(locale).auth;
  const [recovering, setRecovering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");

  useEffect(() => {
    // The link's address carries a recovery session, which creating the client signs in with.
    if (window.location.hash.includes("type=recovery")) setRecovering(true);
    supabase();
  }, []);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email"));
    setBusy(true);
    setError("");
    const { error } = await supabase().auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + href(locale, "/reset/"),
    });
    setBusy(false);
    if (error) setError(errorText(t.errors, error));
    else setSentTo(email);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get("password"));
    setBusy(true);
    setError("");
    const { error } = await supabase().auth.updateUser({ password });
    setBusy(false);
    if (error) setError(errorText(t.errors, error));
    else window.location.assign(href(locale, "/account/"));
  }

  if (sentTo) {
    return (
      <p className={NOTICE} role="status">
        {lastTwo(t.reset.sent.replace("{email}", sentTo))}
      </p>
    );
  }

  return (
    <div className="grid gap-5">
      {recovering ? (
        <form className="grid gap-4" onSubmit={save}>
          <h2 className="text-subhead">{t.reset.newTitle}</h2>
          <Label>
            <span>{t.reset.newPassword}</span>
            <Input
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              aria-describedby="password-hint"
              required
            />
            <small id="password-hint" className={HINT}>
              {t.signUp.passwordHint}
            </small>
          </Label>
          {error && (
            <p className={`${NOTICE} ${ERROR}`} role="alert">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t.working : t.reset.save}
          </Button>
        </form>
      ) : (
        <form className="grid gap-4" onSubmit={send}>
          <Label>
            <span>{t.email}</span>
            <Input name="email" type="email" autoComplete="email" required />
          </Label>
          {error && (
            <p className={`${NOTICE} ${ERROR}`} role="alert">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? t.working : t.reset.submit}
          </Button>
        </form>
      )}
      <p className="text-small text-ink-3">
        <a href={href(locale, "/signin/")}>{t.reset.back}</a>
      </p>
    </div>
  );
}
