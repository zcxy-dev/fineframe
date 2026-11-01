"use client";

import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { content } from "../../lib/content.ts";
import { href, type Locale } from "../../lib/site.ts";
import { CARD, ERROR, HINT, NOTICE, RAISED } from "../../lib/styles.ts";
import { errorText, supabase } from "../../lib/supabase.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Label } from "../ui/label.tsx";
import { PasswordInput } from "../ui/password.tsx";
import { Sent } from "./Sent.tsx";

/**
 * Where the visitor is, from the address: asking for a link, back from the link to choose the
 * new password, or back from a link that has expired or was used already. Read before the
 * Supabase client takes the address's hash.
 */
type Step = "ask" | "choose" | "expired";

function step(): Step {
  const hash = window.location.hash;
  if (hash.includes("type=recovery")) return "choose";
  if (hash.includes("error_code=")) return "expired";
  return "ask";
}

/**
 * The sentence under the heading, which says what this step asks for. The page sets both, so
 * BudouX stays out of the browser's code.
 */
export function ResetLede({ lede, newLede }: { lede: ReactNode; newLede: ReactNode }) {
  const [choosing, setChoosing] = useState(false);
  useEffect(() => setChoosing(step() === "choose"), []);
  return choosing ? newLede : lede;
}

/**
 * Asking for a link to reset the password, or, opened from that link, choosing the new
 * password.
 */
export function ResetForm({ locale, sentTitle }: { locale: Locale; sentTitle: ReactNode }) {
  const t = content(locale).auth;
  const [current, setCurrent] = useState<Step>("ask");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");

  useEffect(() => {
    // The link's address carries a recovery session, which creating the client signs in with.
    const now = step();
    setCurrent(now);
    if (now === "expired") setError(t.reset.expired);
    supabase();
  }, [t]);

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

  const back = (
    <p className="text-center text-small">
      <a className="font-semibold text-ink" href={href(locale, "/signin/")}>
        {t.reset.back}
      </a>
    </p>
  );

  if (sentTo) {
    return (
      <div className="grid gap-6">
        <section className={`${CARD} ${RAISED}`}>
          <Sent title={sentTitle} text={t.reset.sent.replace("{email}", sentTo)}>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setSentTo("")}
            >
              {t.again}
            </Button>
          </Sent>
        </section>
        {back}
      </div>
    );
  }

  const e = t.errors;
  const badPassword = [e.weak, e.leaked].includes(error);
  const alert = error && (
    <p id="reset-error" className={`${NOTICE} ${ERROR}`} role="alert">
      {error}
    </p>
  );

  return (
    <div className="grid gap-6">
      <section className={`${CARD} ${RAISED}`}>
        {current === "choose" ? (
          <form className="grid gap-4" onSubmit={save}>
            <div className="grid gap-2">
              <Label htmlFor="password">{t.reset.newPassword}</Label>
              <PasswordInput
                id="password"
                name="password"
                show={t.show}
                autoComplete="new-password"
                minLength={8}
                aria-invalid={badPassword || undefined}
                aria-describedby={badPassword ? "password-hint reset-error" : "password-hint"}
                required
              />
              <p id="password-hint" className={HINT}>
                {t.signUp.passwordHint}
              </p>
            </div>
            {alert}
            <Button type="submit" className="mt-1 w-full" disabled={busy}>
              {busy ? t.working : t.reset.save}
            </Button>
          </form>
        ) : (
          <form className="grid gap-4" onSubmit={send}>
            {alert}
            <div className="grid gap-2">
              <Label htmlFor="email">{t.email}</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                aria-invalid={error === e.address || undefined}
                aria-describedby={error === e.address ? "reset-error" : undefined}
                required
              />
            </div>
            <Button type="submit" className="mt-1 w-full" disabled={busy}>
              {busy ? t.working : t.reset.submit}
            </Button>
          </form>
        )}
      </section>
      {back}
    </div>
  );
}
