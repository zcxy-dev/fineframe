"use client";

import { createContext, type ReactNode, useContext, useState } from "react";
import { type Locale, localeCookie } from "../lib/i18n/locale.ts";
import { en, MESSAGES, type Messages } from "../lib/i18n/messages.ts";

const Context = createContext<{ locale: Locale; choose: (locale: Locale) => void }>({
  locale: "en",
  choose: () => {},
});

/** The page's language, as the server found it, until its owner chooses another. */
export function I18n({ locale: initial, children }: { locale: Locale; children: ReactNode }) {
  const [locale, setLocale] = useState(initial);
  const choose = (next: Locale) => {
    // biome-ignore lint/suspicious/noDocumentCookie: the server reads it too, on every port.
    document.cookie = localeCookie(next);
    document.documentElement.lang = next;
    setLocale(next);
  };
  return <Context.Provider value={{ locale, choose }}>{children}</Context.Provider>;
}

/** The page's language, and choosing another, which is remembered. */
export function useLocale(): { locale: Locale; choose: (locale: Locale) => void } {
  return useContext(Context);
}

/** The words in the page's language. */
export function useT(): Messages {
  return MESSAGES[useContext(Context).locale] ?? en;
}
