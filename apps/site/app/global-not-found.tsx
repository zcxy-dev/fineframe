import "./fonts.ts";
import type { Metadata } from "next";
import { buttonClass } from "../components/ui/button.tsx";
import { content } from "../lib/content.ts";
import { href, LANG, LOCALES } from "../lib/site.ts";
import { EYEBROW } from "../lib/styles.ts";

export const metadata: Metadata = { title: "404 · Fineframe", robots: { index: false } };

/**
 * Unknown addresses have no language, so the page says it in both, each with its way home, under
 * a bar with the wordmark.
 */
export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body>
        <header className="wrap flex h-15 items-center sm:h-17">
          <a
            className="flex items-center gap-2.5 text-[19px] leading-none font-bold tracking-[-0.02em] no-underline"
            href="/"
          >
            <img src="/icon.svg" alt="" width={28} height={28} />
            <span>Fineframe</span>
          </a>
        </header>
        <main className="wrap grid flex-1 content-center gap-10 py-block">
          <p className={EYEBROW}>404</p>
          <div className="grid gap-10 sm:grid-cols-2 sm:gap-16">
            {LOCALES.map((locale, i) => {
              const t = content(locale).notFound;
              return (
                <section key={locale} lang={LANG[locale]} className="grid content-start gap-3">
                  {i === 0 ? (
                    <h1 className="text-title">{t.title}</h1>
                  ) : (
                    <h2 className="text-title">{t.title}</h2>
                  )}
                  <p className="text-lede text-ink-2">{t.body}</p>
                  <a
                    className={`${buttonClass({ variant: i === 0 ? "default" : "outline" })} mt-5 justify-self-start`}
                    href={href(locale, "/")}
                  >
                    {t.home}
                  </a>
                </section>
              );
            })}
          </div>
        </main>
      </body>
    </html>
  );
}
