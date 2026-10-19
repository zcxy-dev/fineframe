import "@fontsource-variable/archivo/wdth.css";
import "@fontsource-variable/inter";
import "@fontsource/noto-sans-tc/400.css";
import "@fontsource/noto-sans-tc/500.css";
import "@fontsource/noto-sans-tc/700.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { I18n } from "../components/I18n.tsx";
import { acceptedLanguages, resolveLocale } from "../lib/i18n/locale.ts";
import { MESSAGES } from "../lib/i18n/messages.ts";
import { BACKGROUND, backgroundCss } from "../lib/theme.ts";

/** The page's language: the one its owner chose, or else the browser's. */
async function pageLocale() {
  const request = await headers();
  return resolveLocale(request.get("cookie"), acceptedLanguages(request.get("accept-language")));
}

export async function generateMetadata(): Promise<Metadata> {
  return { title: "Fineframe", description: MESSAGES[await pageLocale()].meta.description };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: BACKGROUND.dark },
    { media: "(prefers-color-scheme: light)", color: BACKGROUND.light },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await pageLocale();
  return (
    <html lang={locale}>
      <head>
        <style>{backgroundCss}</style>
      </head>
      <body>
        <I18n locale={locale}>{children}</I18n>
      </body>
    </html>
  );
}
