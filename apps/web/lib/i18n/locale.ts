// Which language the page speaks: the one its owner chose, kept in a cookie, or else the system's,
// Traditional Chinese for any Chinese and English for anything else. A cookie rather than local
// storage, as the desktop app serves the page on another port each time it starts, and a cookie
// is the host's whatever the port; the server reads it too, so the page arrives in its language.
// Nothing here imports anything: the desktop app reads it before the page's server is up.

export const LOCALES = ["en", "zh-TW"] as const;
export type Locale = (typeof LOCALES)[number];

/** Each language as it names itself, for the switch. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", "zh-TW": "繁體中文" };

export const LOCALE_COOKIE = "fineframe-locale";

/** The page's language for a system that prefers `languages`, most preferred first. */
export function detectLocale(languages: readonly string[]): Locale {
  const first = languages.find((language) => language.trim() !== "");
  return first && /^zh\b/i.test(first.trim()) ? "zh-TW" : "en";
}

/** The languages an Accept-Language header asks for, most preferred first. */
export function acceptedLanguages(header: string | null | undefined): string[] {
  return (header ?? "")
    .split(",")
    .map((part, i) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = params.map((param) => param.trim().match(/^q=([\d.]+)$/)?.[1]).find(Boolean);
      return { tag: tag.trim(), q: q === undefined ? 1 : Number(q), i };
    })
    .filter(({ tag, q }) => tag !== "" && tag !== "*" && q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i)
    .map(({ tag }) => tag);
}

/** The language saved in a Cookie header, or null when none is. */
export function savedLocale(cookie: string | null | undefined): Locale | null {
  for (const part of (cookie ?? "").split(";")) {
    const [name, value] = part.trim().split("=");
    if (name === LOCALE_COOKIE) {
      const locale = decodeURIComponent(value ?? "");
      return (LOCALES as readonly string[]).includes(locale) ? (locale as Locale) : null;
    }
  }
  return null;
}

/** The page's language: the one saved, or else the system's. */
export function resolveLocale(cookie: string | null | undefined, languages: readonly string[]) {
  return savedLocale(cookie) ?? detectLocale(languages);
}

/** What `document.cookie` is set to to keep `locale`: for every page of this host, for a year. */
export function localeCookie(locale: Locale): string {
  return `${LOCALE_COOKIE}=${encodeURIComponent(locale)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
