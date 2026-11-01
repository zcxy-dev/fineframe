"use client";

import { type FormEvent, useEffect, useState } from "react";
import { content } from "../../lib/content.ts";
import { lastTwo } from "../../lib/english.ts";
import type { Plan } from "../../lib/paddle.ts";
import { href, type Locale } from "../../lib/site.ts";
import { CARD, ERROR, HINT, NOTICE, RAISED } from "../../lib/styles.ts";
import { errorText, nextPath, nextPlan, supabase } from "../../lib/supabase.ts";
import { Rich } from "../Rich.tsx";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Label } from "../ui/label.tsx";
import { PasswordInput } from "../ui/password.tsx";
import { Sent } from "./Sent.tsx";

/** Google's "G", in its own colours, as its branding guidelines ask of a sign-in button. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58A8.65 8.65 0 0 0 9 0 9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/** Signing in or creating an account, with an email and a password or with Google. */
export function AuthForm({ locale, mode }: { locale: Locale; mode: "signIn" | "signUp" }) {
  const all = content(locale);
  const t = all.auth;
  const page = t[mode];
  // Which button is at work, so only it says so.
  const [pending, setPending] = useState<"google" | "email">();
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");
  // The other form keeps where to go after signing in.
  const [query, setQuery] = useState("");
  // The plan whose checkout opens after, when the plans sent the visitor here.
  const [plan, setPlan] = useState<Plan>();
  useEffect(() => {
    const next = new URLSearchParams(window.location.search).get("next");
    if (next) setQuery(`?next=${encodeURIComponent(next)}`);
    setPlan(nextPlan());
    // Back from Google's page, the browser may restore this one as it was left: at work.
    const restored = (event: PageTransitionEvent) => event.persisted && setPending(undefined);
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);
  const withPlan = (text: string) =>
    plan ? text.replace("{plan}", all.account.plans[plan]) : text;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setPending("email");
    setError("");
    const next = nextPath(locale);
    const auth = supabase().auth;
    const { error } =
      mode === "signIn"
        ? await auth.signInWithPassword({ email, password })
        : await auth.signUp({
            email,
            password,
            options: { emailRedirectTo: window.location.origin + next },
          });
    setPending(undefined);
    if (error) setError(errorText(t.errors, error));
    else if (mode === "signIn") window.location.assign(next);
    else setSentTo(email);
  }

  async function google() {
    setPending("google");
    setError("");
    const { error } = await supabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + nextPath(locale) },
    });
    if (error) {
      setPending(undefined);
      setError(errorText(t.errors, error));
    }
  }

  if (sentTo) {
    return (
      <section className={`${CARD} ${RAISED}`}>
        <Sent
          locale={locale}
          title={t.signUp.sentTitle}
          text={withPlan(plan ? t.signUp.sentPlan : t.signUp.sent).replace("{email}", sentTo)}
        >
          <Button type="button" variant="outline" className="w-full" onClick={() => setSentTo("")}>
            {t.again}
          </Button>
          <a className="justify-self-center text-small text-ink-2" href={href(locale, "/")}>
            {t.home}
          </a>
        </Sent>
      </section>
    );
  }

  // What the error is about, for the fields it concerns.
  const e = t.errors;
  const badEmail = [e.invalid, e.address].includes(error);
  const badPassword = [e.invalid, e.weak, e.leaked].includes(error);
  const busy = pending !== undefined;
  // A Chinese prompt ends in a full-width mark, which already leaves room before the link.
  const space = /[？：]$/.test(page.switchPrompt) ? "" : " ";

  return (
    <div className="grid gap-6">
      <section className={`${CARD} ${RAISED} grid gap-5`}>
        {plan && (
          <p className={NOTICE} role="status">
            {lastTwo(withPlan(page.forPlan))}
          </p>
        )}
        <Button type="button" variant="outline" className="w-full" onClick={google} disabled={busy}>
          {pending === "google" ? (
            t.working
          ) : (
            <>
              <GoogleMark />
              {t.google}
            </>
          )}
        </Button>
        <p className="flex items-center gap-3 text-fine text-ink-3 before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
          <span>{t.or}</span>
        </p>
        <form className="grid gap-4" onSubmit={submit}>
          <div className="grid gap-2">
            <Label htmlFor="email">{t.email}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              aria-invalid={badEmail || undefined}
              aria-describedby={badEmail ? "auth-error" : undefined}
              required
            />
          </div>
          <div className="grid gap-2">
            <div className="flex items-baseline justify-between gap-4">
              <Label htmlFor="password">{t.password}</Label>
              {mode === "signIn" && (
                <a className="text-small text-ink-2" href={href(locale, "/reset/")}>
                  {t.signIn.forgot}
                </a>
              )}
            </div>
            <PasswordInput
              id="password"
              name="password"
              show={t.show}
              autoComplete={mode === "signIn" ? "current-password" : "new-password"} // betterleaks:allow: autocomplete tokens, not a password
              minLength={mode === "signUp" ? 8 : undefined}
              aria-invalid={badPassword || undefined}
              aria-describedby={
                [mode === "signUp" && "password-hint", badPassword && "auth-error"]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              required
            />
            {mode === "signUp" && (
              <p id="password-hint" className={HINT}>
                {t.signUp.passwordHint}
              </p>
            )}
          </div>
          {error && (
            <p id="auth-error" className={`${NOTICE} ${ERROR}`} role="alert">
              {error}
            </p>
          )}
          <Button type="submit" className="mt-1 w-full" disabled={busy}>
            {pending === "email" ? t.working : page.submit}
          </Button>
        </form>
        <p className={`${HINT} text-center`}>
          <Rich text={t.agree} locale={locale} />
        </p>
      </section>
      <p className="text-center text-small text-ink-2">
        {page.switchPrompt}
        {space}
        <a
          className="font-semibold text-ink"
          href={href(locale, mode === "signIn" ? "/signup/" : "/signin/") + query}
        >
          {page.switchLink}
        </a>
      </p>
    </div>
  );
}
