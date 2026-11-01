import type { ReactNode } from "react";
import { content } from "../../lib/content.ts";
import { href, type Locale, type PagePath } from "../../lib/site.ts";
import { Brand, Frame, LanguageLink } from "../Frame.tsx";
import { PageHead } from "../PageHead.tsx";
import { Phrases, Rich } from "../Rich.tsx";

const FOOTER_LINK = "inline-flex min-h-10 items-center no-underline hover:text-ink";

/**
 * An account page: its title, and its form or view, which runs in the browser. The account
 * page keeps the site's frame and width. Sign-in, sign-up, reset and authorize stand on their
 * own: the wordmark and the language in a quiet bar, the heading and the form in one narrow
 * column, and a line of legal links under it, with nothing else to leave by.
 */
export function AccountFrame({
  locale,
  path,
  title,
  lede,
  children,
}: {
  locale: Locale;
  path: PagePath;
  title: string;
  /** Under the heading: a string, or what a form sets itself (the reset page's). */
  lede?: string | ReactNode;
  children: ReactNode;
}) {
  const sub = typeof lede === "string" ? <Rich text={lede} locale={locale} /> : (lede ?? undefined);
  if (path === "/account/") {
    return (
      <Frame locale={locale} path={path}>
        <PageHead title={title} locale={locale}>
          {sub && <p>{sub}</p>}
        </PageHead>
        <div className="wrap pb-end">{children}</div>
      </Frame>
    );
  }
  const t = content(locale);
  return (
    <>
      <a
        className="absolute -top-12 left-3 z-40 rounded-field bg-ink px-3 py-2 text-white focus:top-3"
        href="#main"
      >
        {t.skip}
      </a>
      <header className="wrap flex h-15 items-center justify-between gap-4 text-small text-ink-2 sm:h-17">
        <Brand locale={locale} />
        <LanguageLink locale={locale} path={path} />
      </header>
      <main id="main" className="wrap max-w-[440px] flex-1 pt-10 pb-block sm:pt-16">
        <header className="text-center">
          <h1 className="text-heading">
            <Phrases text={title} locale={locale} />
          </h1>
          {sub && <p className="mt-2 text-ink-2">{sub}</p>}
        </header>
        <div className="mt-8">{children}</div>
      </main>
      <footer className="wrap flex flex-wrap items-center justify-between gap-x-6 border-t py-3 text-fine text-ink-3">
        <p>{t.footer.rights}</p>
        <nav className="flex gap-5" aria-label={t.footer.legal}>
          <a className={FOOTER_LINK} href={href(locale, "/terms/")}>
            {t.footer.terms}
          </a>
          <a className={FOOTER_LINK} href={href(locale, "/privacy/")}>
            {t.footer.privacy}
          </a>
          <a className={FOOTER_LINK} href={href(locale, "/refund/")}>
            {t.footer.refund}
          </a>
        </nav>
      </footer>
    </>
  );
}
