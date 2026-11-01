import type { ReactNode } from "react";
import { content } from "../lib/content.ts";
import { href, LANG, LOCALES, type Locale, type PagePath } from "../lib/site.ts";
import { SLUG } from "../lib/styles.ts";
import { AccountLink } from "./AccountLink.tsx";
import { Icon } from "./Icon.tsx";
import { Menu } from "./Menu.tsx";
import { Phrases } from "./Rich.tsx";
import { buttonClass } from "./ui/button.tsx";

const ACCOUNT_PAGES: PagePath[] = ["/signin/", "/signup/", "/reset/", "/account/", "/authorize/"];

const NAV_LINK =
  "no-underline transition-colors duration-150 hover:text-ink aria-[current=page]:text-ink";
const FOOTER_LINK =
  "text-small text-ink-2 no-underline transition-colors duration-150 hover:text-ink aria-[current=page]:text-ink aria-[current=page]:font-semibold";
/** The wordmark: a logo, at its own sizes rather than the text scale's. */
const BRAND =
  "flex items-center gap-2.5 text-[17px] leading-none font-bold tracking-[-0.02em] no-underline sm:text-[19px]";

/** A link in the menu below 1081 px: a full-width row, easy to tap. */
const MENU_LINK =
  "flex min-h-12 items-center border-b text-body font-semibold text-ink no-underline last:border-b-0 aria-[current=page]:text-ink-2";

/** The wordmark, leading home. */
export function Brand({ locale }: { locale: Locale }) {
  return (
    <a className={BRAND} href={href(locale, "/")} aria-label={content(locale).nav.home}>
      <img src="/icon.svg" alt="" width={28} height={28} />
      <span>Fineframe</span>
    </a>
  );
}

/**
 * The same page in the other language, with a globe; on small phones the globe alone, unless
 * `named` (the menu's).
 */
export function LanguageLink({
  locale,
  path,
  named = false,
}: {
  locale: Locale;
  path: PagePath;
  named?: boolean;
}) {
  const other = LOCALES.find((l) => l !== locale) as Locale;
  return (
    <a
      className={`${NAV_LINK} flex items-center gap-1.5`}
      href={href(other, path)}
      hrefLang={LANG[other]}
      lang={LANG[other]}
      aria-label={`${content(locale).nav.language}: ${content(other).languageName}`}
    >
      <Icon name="globe" />
      <span className={`whitespace-nowrap ${named ? "" : "max-[480px]:hidden"}`}>
        {content(other).languageName}
      </span>
    </a>
  );
}

/** Pages where the bar leaves out its button to the plans: they have their own next step. */
const NO_PLANS_BUTTON: PagePath[] = [...ACCOUNT_PAGES, "/pricing/"];

/**
 * The bar, the page and the footer that every page shares. The bar holds the home page's
 * sections, the other language, Sign in (or Account) and the button to the plans; the footer,
 * every page.
 */
export function Frame({
  locale,
  path,
  children,
}: {
  locale: Locale;
  path: PagePath;
  children: ReactNode;
}) {
  const t = content(locale);
  const other = LOCALES.find((l) => l !== locale) as Locale;
  const current = (p: PagePath) => (p === path ? "page" : undefined);
  const home = href(locale, "/");
  const section = (id: string) => (path === "/" ? `#${id}` : `${home}#${id}`);
  // The bar's links: the home page's sections, then the pages a visitor comes for.
  const links: [string, string, PagePath?][] = [
    [t.nav.examples, section("formats")],
    [t.nav.features, section("features")],
    [t.nav.pricing, href(locale, "/pricing/"), "/pricing/"],
    [t.nav.download, href(locale, "/download/"), "/download/"],
  ];
  const footer: { title: string; links: [string, string, PagePath?][] }[] = [
    {
      title: t.footer.product,
      links: [
        [t.nav.download, href(locale, "/download/"), "/download/"],
        [t.nav.pricing, href(locale, "/pricing/"), "/pricing/"],
        [t.nav.features, section("features")],
        [t.nav.faq, section("faq")],
      ],
    },
    {
      title: t.footer.account,
      links: [
        // Sign in, or Account once signed in (`AccountLink`).
        [t.nav.signIn, href(locale, "/signin/"), "/signin/"],
        [t.footer.signUp, href(locale, "/signup/"), "/signup/"],
      ],
    },
    {
      title: t.footer.legal,
      links: [
        [t.footer.terms, href(locale, "/terms/"), "/terms/"],
        [t.footer.privacy, href(locale, "/privacy/"), "/privacy/"],
        [t.footer.refund, href(locale, "/refund/"), "/refund/"],
        [t.footer.credits, href(locale, "/credits/"), "/credits/"],
      ],
    },
  ];
  return (
    <>
      <a
        className="absolute -top-12 left-3 z-40 rounded-field bg-ink px-3 py-2 text-white focus:top-3"
        href="#main"
      >
        {t.skip}
      </a>
      <header className="sticky top-0 z-20 border-b bg-ground/92 backdrop-blur-md backdrop-saturate-140">
        <div className="wrap flex h-15 items-center gap-4 sm:h-17 sm:gap-8">
          <Brand locale={locale} />
          <nav className="hidden gap-7 text-small font-medium text-ink-2 min-[1081px]:flex">
            {links.map(([label, link, page]) => (
              <a
                key={link}
                className={NAV_LINK}
                href={link}
                aria-current={page ? current(page) : undefined}
              >
                {label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-small text-ink-2 sm:gap-5">
            <div className="hidden items-center gap-5 min-[1081px]:flex">
              <LanguageLink locale={locale} path={path} />
              <AccountLink
                locale={locale}
                labels={{ signIn: t.nav.signIn, account: t.nav.account }}
                current={path === "/signin/" || path === "/account/"}
                className={buttonClass({ variant: "outline", size: "sm" })}
              />
            </div>
            {!NO_PLANS_BUTTON.includes(path) && (
              <a className={buttonClass({ size: "sm" })} href={href(locale, "/pricing/")}>
                {t.nav.getStarted}
              </a>
            )}
            <Menu open={t.nav.menu} close={t.nav.close}>
              <nav className="wrap grid py-2" aria-label={t.nav.menu}>
                {links.map(([label, link, page]) => (
                  <a
                    key={link}
                    className={MENU_LINK}
                    href={link}
                    aria-current={page ? current(page) : undefined}
                  >
                    {label}
                  </a>
                ))}
                <AccountLink
                  locale={locale}
                  labels={{ signIn: t.nav.signIn, account: t.nav.account }}
                  current={path === "/signin/" || path === "/account/"}
                  className={MENU_LINK}
                />
                <div className="flex min-h-12 items-center text-body text-ink-2">
                  <LanguageLink locale={locale} path={path} named />
                </div>
              </nav>
            </Menu>
          </div>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer id="footer" className="border-t">
        <div className="wrap grid grid-cols-2 gap-x-6 gap-y-10 py-14 md:grid-cols-[1.6fr_repeat(3,1fr)]">
          <div className="col-span-full md:col-span-1">
            <Brand locale={locale} />
            <p className="mt-4 max-w-[30ch] text-small text-ink-2">
              <Phrases text={t.footer.tagline} locale={locale} />
            </p>
            <a
              className="mt-3 inline-block text-small text-ink-2"
              href="mailto:support@fineframe.app"
            >
              support@fineframe.app
            </a>
          </div>
          {footer.map((group, i) => (
            <nav key={group.title} aria-labelledby={`footer-${i}`}>
              <h2 id={`footer-${i}`} className={`mb-4 font-sans text-ink-3 ${SLUG}`}>
                {group.title}
              </h2>
              <ul className="space-y-2.5">
                {group.links.map(([label, link, page]) => (
                  <li key={link}>
                    {page === "/signin/" ? (
                      <AccountLink
                        locale={locale}
                        labels={{ signIn: t.nav.signIn, account: t.nav.account }}
                        current={path === "/signin/" || path === "/account/"}
                        className={FOOTER_LINK}
                      />
                    ) : (
                      <a
                        className={FOOTER_LINK}
                        href={link}
                        aria-current={page ? current(page) : undefined}
                      >
                        {label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="wrap flex flex-wrap justify-between gap-x-6 gap-y-3 border-t py-6 text-fine text-ink-3">
          <p>{t.footer.rights}</p>
          <a
            className="no-underline hover:text-ink"
            href={href(other, path)}
            hrefLang={LANG[other]}
            lang={LANG[other]}
          >
            {content(other).languageName}
          </a>
        </div>
      </footer>
    </>
  );
}
