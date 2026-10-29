"use client";

import { useEffect, useState } from "react";
import { href, type Locale } from "../lib/site.ts";

/**
 * The bar's link to the account: Sign in, or Account once this browser holds a session. It reads
 * the session's key in local storage (`lib/supabase.ts` keeps it there) instead of loading
 * Supabase on every page.
 */
export function AccountLink({
  locale,
  labels,
  current,
  className,
}: {
  locale: Locale;
  labels: { signIn: string; account: string };
  /** Whether this page is the sign-in or the account page. */
  current: boolean;
  className: string;
}) {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    try {
      setSignedIn(
        Object.keys(localStorage).some((k) => k.startsWith("sb-") && k.endsWith("-auth-token")),
      );
    } catch {
      // Storage blocked: the link stays Sign in, which leads to the account once signed in.
    }
  }, []);
  return (
    <a
      className={className}
      href={href(locale, signedIn ? "/account/" : "/signin/")}
      aria-current={current ? "page" : undefined}
    >
      {signedIn ? labels.account : labels.signIn}
    </a>
  );
}
