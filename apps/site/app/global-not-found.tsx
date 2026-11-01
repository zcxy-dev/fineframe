import "./fonts.ts";
import type { Metadata } from "next";
import { content } from "../lib/content.ts";
import { href, LANG, LOCALES } from "../lib/site.ts";

export const metadata: Metadata = { title: "404 · Fineframe" };

/** Unknown addresses have no language, so the page says it in both. */
export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body>
        <main className="grid min-h-screen place-content-center justify-items-center gap-5 bg-ground px-4 py-8 text-center">
          <img src="/icon.svg" alt="" width={40} height={40} />
          {LOCALES.map((locale) => {
            const t = content(locale).notFound;
            return (
              <section
                key={locale}
                lang={LANG[locale]}
                className="grid gap-2 [&>h1]:text-heading [&>p]:text-ink-2"
              >
                <h1>{t.title}</h1>
                <p>{t.body}</p>
                <a href={href(locale, "/")}>{t.home}</a>
              </section>
            );
          })}
        </main>
      </body>
    </html>
  );
}
