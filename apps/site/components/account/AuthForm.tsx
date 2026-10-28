"use client";

import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { content } from "../../lib/content.ts";
import { lastTwo } from "../../lib/english.ts";
import { href, type Locale } from "../../lib/site.ts";
import { ERROR, HINT, NOTICE } from "../../lib/styles.ts";
import { errorText, nextPath, supabase } from "../../lib/supabase.ts";
import { Button } from "../ui/button.tsx";
import { Input } from "../ui/input.tsx";
import { Label } from "../ui/label.tsx";

/** Signing in or creating an account, with an email and a password or with Google. */
export function AuthForm({
  locale,
  mode,
  agree,
}: {
  locale: Locale;
  mode: "signIn" | "signUp";
  /** Under the sign-up form: what creating an account agrees to, set by the page. */
  agree?: ReactNode;
}) {
  const t = content(locale).auth;
  const page = t[mode];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState("");
  // The other form keeps where to go after signing in.
  const [query, setQuery] = useState("");
  useEffect(() => {
    const next = new URLSearchParams(window.location.search).get("next");
    if (next) setQuery(`?next=${encodeURIComponent(next)}`);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));
    setBusy(true);
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
    setBusy(false);
    if (error) setError(errorText(t.errors, error));
    else if (mode === "signIn") window.location.assign(next);
    else setSentTo(email);
  }

  async function google() {
    setBusy(true);
    setError("");
    const { error } = await supabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + nextPath(locale) },
    });
    if (error) {
      setBusy(false);
      setError(errorText(t.errors, error));
    }
  }

  if (sentTo) {
    return (
      <p className={NOTICE} role="status">
        {lastTwo(t.signUp.sent.replace("{email}", sentTo))}
      </p>
    );
  }

  return (
    <div className="grid gap-5">
      <Button type="button" variant="outline" className="w-full" onClick={google} disabled={busy}>
        {t.google}
      </Button>
      <p className="flex items-center gap-3 text-xs text-ink-3 before:h-px before:flex-1 before:bg-line after:h-px after:flex-1 after:bg-line">
        <span>{t.or}</span>
      </p>
      <form className="grid gap-4" onSubmit={submit}>
        <Label>
          <span>{t.email}</span>
          <Input name="email" type="email" autoComplete="email" required />
        </Label>
        <Label>
          <span>{t.password}</span>
          <Input
            name="password"
            type="password"
            autoComplete={mode === "signIn" ? "current-password" : "new-password"} // betterleaks:allow: autocomplete tokens, not a password
            minLength={mode === "signUp" ? 8 : undefined}
            aria-describedby={mode === "signUp" ? "password-hint" : undefined}
            required
          />
          {mode === "signUp" && (
            <small id="password-hint" className={HINT}>
              {t.signUp.passwordHint}
            </small>
          )}
        </Label>
        {mode === "signIn" && (
          <a className="justify-self-start text-sm text-ink-3" href={href(locale, "/reset/")}>
            {t.signIn.forgot}
          </a>
        )}
        {error && (
          <p className={`${NOTICE} ${ERROR}`} role="alert">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? t.working : page.submit}
        </Button>
        {agree && <p className={HINT}>{agree}</p>}
      </form>
      <p className="text-sm text-ink-3">
        {page.switchPrompt}{" "}
        <a href={href(locale, mode === "signIn" ? "/signup/" : "/signin/") + query}>
          {page.switchLink}
        </a>
      </p>
    </div>
  );
}
