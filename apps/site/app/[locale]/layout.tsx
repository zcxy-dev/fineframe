import "../fonts.ts";
import type { Viewport } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { preload } from "react-dom";
import { DEVICE_SCRIPT } from "../../lib/device.ts";
import { isLocale, LANG, LOCALES } from "../../lib/site.ts";

export const dynamicParams = false;

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export const viewport: Viewport = { themeColor: "#f3f4f6", colorScheme: "light" };

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  // The first paint's text, so its fonts are on the way before the CSS asks for them: the
  // body's and, in Chinese, the headings' Black.
  preload("/fonts/geist-latin.woff2", { as: "font", type: "font/woff2", crossOrigin: "" });
  if (locale === "zh-tw") {
    for (const weight of [400, 900]) {
      preload(`/fonts/noto-sans-tc-${weight}.woff2`, {
        as: "font",
        type: "font/woff2",
        crossOrigin: "",
      });
    }
  }
  return (
    // The head script marks <html> with the visitor's device before React hydrates it.
    <html lang={LANG[locale]} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: DEVICE_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
