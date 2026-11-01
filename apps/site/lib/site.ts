import type { Metadata } from "next";

export const LOCALES = ["en", "zh-tw"] as const;
export type Locale = (typeof LOCALES)[number];

/** Each locale's `<html lang>` and hreflang. */
export const LANG: Record<Locale, string> = { en: "en", "zh-tw": "zh-Hant-TW" };

export const ORIGIN = "https://fineframe.app";

/** Where the app's installers are, each under a name that always holds the latest version. */
export const DOWNLOADS = "https://downloads.fineframe.app";

/** The site's pages, as paths after the locale. */
export const PAGES = [
  "/",
  "/download/",
  "/pricing/",
  "/terms/",
  "/privacy/",
  "/refund/",
  "/credits/",
  "/signin/",
  "/signup/",
  "/reset/",
  "/account/",
  "/authorize/",
] as const;
export type PagePath = (typeof PAGES)[number];

/** Pages that only serve an account: search engines leave them out, and so does the sitemap. */
export const UNLISTED: readonly PagePath[] = [
  "/signin/",
  "/signup/",
  "/reset/",
  "/account/",
  "/authorize/",
];

/** Each locale's Open Graph locale. */
const OG_LOCALE: Record<Locale, string> = { en: "en_US", "zh-tw": "zh_TW" };

/** What each locale's share card (`app/[locale]/og.png`) shows. */
const OG_ALT: Record<Locale, string> = {
  en: "Fineframe: Shoot it, post it. Beside it, a frame of a finished vertical edit.",
  "zh-tw": "Fineframe：你只管拍，剪好的直接發。旁邊是一段剪好的直式影片畫面。",
};

export function href(locale: Locale, path: PagePath): string {
  return `/${locale}${path}`;
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/** The site's icons: the favicon, the SVG, and the square a phone puts on its home screen. */
export const ICONS: Metadata["icons"] = {
  icon: [{ url: "/favicon.ico", sizes: "32x32" }, { url: "/icon.svg" }],
  apple: "/apple-touch-icon.png",
};

/**
 * A page's title, description, its address in each language and its share card. A title that
 * does not name Fineframe is followed by the name. The account's pages are kept out of search.
 */
export function pageMetadata(
  locale: Locale,
  path: PagePath,
  title: string,
  description: string,
): Metadata {
  const full = title.includes("Fineframe")
    ? title
    : `${title}${locale === "zh-tw" ? "｜" : " | "}Fineframe`;
  const image = { url: `/${locale}/og.png`, width: 1200, height: 630, alt: OG_ALT[locale] };
  return {
    metadataBase: new URL(ORIGIN),
    title: full,
    description,
    alternates: {
      canonical: href(locale, path),
      languages: {
        ...Object.fromEntries(LOCALES.map((l) => [LANG[l], href(l, path)])),
        // The home page's has a language picker; another page's default is English.
        "x-default": path === "/" ? "/" : href("en", path),
      },
    },
    openGraph: {
      type: "website",
      siteName: "Fineframe",
      title: full,
      description,
      url: href(locale, path),
      locale: OG_LOCALE[locale],
      alternateLocale: LOCALES.filter((l) => l !== locale).map((l) => OG_LOCALE[l]),
      images: [image],
    },
    twitter: { card: "summary_large_image", title: full, description, images: [image] },
    icons: ICONS,
    robots: UNLISTED.includes(path) ? { index: false } : undefined,
  };
}

/** A page's locale, from params that `generateStaticParams` limits to the locales. */
export async function localeOf(params: Promise<{ locale: string }>): Promise<Locale> {
  return (await params).locale as Locale;
}

export type PageProps = { params: Promise<{ locale: string }> };
