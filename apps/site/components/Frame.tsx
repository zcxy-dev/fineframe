import type { ReactNode } from "react";
import { content } from "../lib/content.ts";
import { href, LANG, LOCALES, type Locale, type PagePath } from "../lib/site.ts";
import { AccountLink } from "./AccountLink.tsx";
import { Icon } from "./Icon.tsx";
import { Phrases } from "./Rich.tsx";
import { buttonClass } from "./ui/button.tsx";

const ACCOUNT_PAGES: PagePath[] = ["/signin/", "/signup/", "/reset/", "/account/", "/authorize/"];

const NAV_LINK =
  "no-underline transition-colors duration-150 hover:text-ink aria-[current=page]:text-ink";
const FOOTER_LINK =
  "text-[15px] text-ink-2 no-underline transition-colors duration-150 hover:text-ink aria-[current=page]:text-ink aria-[current=page]:font-semibold";
const BRAND =
  "flex items-center gap-2.5 text-[17px] leading-none font-bold tracking-[-0.02em] no-underline sm:text-[19px]";

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
        [t.nav.signIn, href(locale, "/signin/"), "/signin/"],
        [t.footer.signUp, href(locale, "/signup/"), "/signup/"],
        [t.nav.account, href(locale, "/account/"), "/account/"],
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
        className="absolute -top-12 left-3 z-40 rounded-md bg-ink px-3 py-2 text-white focus:top-3"
        href="#main"
      >
        {t.skip}
      </a>
      <header className="sticky top-0 z-20 border-b bg-ground/92 backdrop-blur-md backdrop-saturate-140">
        <div className="wrap flex h-15 items-center gap-4 sm:h-17 sm:gap-8">
          <a className={BRAND} href={home} aria-label={t.nav.home}>
            <img src="/icon.svg" alt="" width={28} height={28} />
            <span>Fineframe</span>
          </a>
          <nav className="hidden gap-7 text-[15px] font-medium text-ink-2 min-[1081px]:flex">
            <a className={NAV_LINK} href={section("formats")}>
              {t.nav.examples}
            </a>
            <a className={NAV_LINK} href={section("features")}>
              {t.nav.features}
            </a>
            <a
              className={NAV_LINK}
              href={href(locale, "/pricing/")}
              aria-current={current("/pricing/")}
            >
              {t.nav.pricing}
            </a>
          </nav>
          <div className="ml-auto flex items-center gap-3.5 text-[15px] text-ink-2 sm:gap-5">
            <a
              className={`${NAV_LINK} flex items-center gap-1.5`}
              href={href(other, path)}
              hrefLang={LANG[other]}
              lang={LANG[other]}
              aria-label={`${t.nav.language}: ${content(other).languageName}`}
            >
              <Icon name="globe" />
              {/* On phones the globe alone: the bar also holds Sign in and the plans. */}
              <span className="whitespace-nowrap max-sm:text-sm max-[480px]:hidden">
                {content(other).languageName}
              </span>
            </a>
            <AccountLink
              locale={locale}
              labels={{ signIn: t.nav.signIn, account: t.nav.account }}
              current={path === "/signin/" || path === "/account/"}
              className={`${NAV_LINK} whitespace-nowrap`}
            />
            {!NO_PLANS_BUTTON.includes(path) && (
              <a className={buttonClass({ size: "sm" })} href={href(locale, "/pricing/")}>
                {t.nav.getStarted}
              </a>
            )}
          </div>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer id="footer" className="border-t">
        <div className="wrap grid grid-cols-2 gap-x-6 gap-y-10 py-14 md:grid-cols-[1.6fr_repeat(3,1fr)]">
          <div className="col-span-full md:col-span-1">
            <a className={BRAND} href={home} aria-label={t.nav.home}>
              <img src="/icon.svg" alt="" width={28} height={28} />
              <span>Fineframe</span>
            </a>
            <p className="mt-4 max-w-[30ch] text-[15px] text-ink-2">
              <Phrases text={t.footer.tagline} locale={locale} />
            </p>
            <a
              className="mt-3 inline-block text-[15px] text-ink-2"
              href="mailto:support@fineframe.app"
            >
              support@fineframe.app
            </a>
          </div>
          {footer.map((group, i) => (
            <nav key={group.title} aria-labelledby={`footer-${i}`}>
              <h2
                id={`footer-${i}`}
                className="mb-3.5 font-sans text-sm font-semibold tracking-normal"
              >
                {group.title}
              </h2>
              <ul className="space-y-2.5">
                {group.links.map(([label, link, page]) => (
                  <li key={link}>
                    <a
                      className={FOOTER_LINK}
                      href={link}
                      aria-current={page ? current(page) : undefined}
                    >
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
        <div className="wrap flex flex-wrap justify-between gap-x-6 gap-y-3 border-t py-6 text-sm text-ink-3">
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
