"use client";

import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { type Locale, localeCookie } from "../lib/i18n/locale.ts";
import { en, MESSAGES, type Messages } from "../lib/i18n/messages.ts";
import { phrased } from "../lib/phrases.ts";

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
  useEffect(breakBetweenWords, []);
  return <Context.Provider value={{ locale, choose }}>{children}</Context.Provider>;
}

/** What is not set as running text: fields, code and the captions' own previews. */
const LEFT_ALONE = "script, style, textarea, option, pre, .caption-frame, [role=img]";

/** Marks where Chinese may wrap in every text on the page, as it renders and changes, so a line
 * never breaks inside a word (lib/phrases.ts). The text nodes stay React's: only their words are
 * spaced. */
function breakBetweenWords() {
  const space = (node: Node) => {
    if (!(node instanceof Text) || node.parentElement?.closest(LEFT_ALONE)) return;
    const text = phrased(node.data);
    if (text !== node.data) node.data = text;
  };
  const spaceAll = (root: Node) => {
    if (root instanceof Text) return space(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) space(node);
  };
  spaceAll(document.body);
  const observer = new MutationObserver((changes) => {
    for (const change of changes) {
      if (change.type === "characterData") space(change.target);
      else for (const node of change.addedNodes) spaceAll(node);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true });
  return () => observer.disconnect();
}

/** The page's language, and choosing another, which is remembered. */
export function useLocale(): { locale: Locale; choose: (locale: Locale) => void } {
  return useContext(Context);
}

/** The words in the page's language. */
export function useT(): Messages {
  return MESSAGES[useContext(Context).locale] ?? en;
}
