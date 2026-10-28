import type { Metadata } from "next";

export const LOCALES = ["en", "zh-tw"] as const;
export type Locale = (typeof LOCALES)[number];

/** Each locale's `<html lang>` and hreflang. */
export const LANG: Record<Locale, string> = { en: "en", "zh-tw": "zh-Hant-TW" };

export const ORIGIN = "https://fineframe.app";

/** Where the app's installers are, each under a name that always holds the latest version. */
export const DOWNLOADS = "https://downloads.fineframe.app";

/** The site's pages, as paths after the locale. */
export type PagePath =
  | "/"
  | "/download/"
  | "/pricing/"
  | "/terms/"
  | "/privacy/"
  | "/refund/"
  | "/credits/"
  | "/signin/"
  | "/signup/"
  | "/reset/"
  | "/account/"
  | "/authorize/";

export function href(locale: Locale, path: PagePath): string {
  return `/${locale}${path}`;
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * A page's title, description and its address in each language. The home page's title is
 * whole; another page's is followed by the name.
 */
export function pageMetadata(
  locale: Locale,
  path: PagePath,
  title: string,
  description: string,
): Metadata {
  return {
    metadataBase: new URL(ORIGIN),
    title: path === "/" ? title : `${title}${locale === "zh-tw" ? "｜" : " | "}Fineframe`,
    description,
    alternates: {
      canonical: href(locale, path),
      languages: Object.fromEntries(LOCALES.map((l) => [LANG[l], href(l, path)])),
    },
    icons: { icon: [{ url: "/favicon.ico", sizes: "32x32" }, { url: "/icon.svg" }] },
  };
}

/** A page's locale, from params that `generateStaticParams` limits to the locales. */
export async function localeOf(params: Promise<{ locale: string }>): Promise<Locale> {
  return (await params).locale as Locale;
}

export type PageProps = { params: Promise<{ locale: string }> };
