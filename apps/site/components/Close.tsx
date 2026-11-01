import { content } from "../lib/content.ts";
import { lastTwo } from "../lib/english.ts";
import type { Locale } from "../lib/site.ts";
import { Download } from "./Download.tsx";
import { Rich } from "./Rich.tsx";
import { buttonClass } from "./ui/button.tsx";

/**
 * What runs it: the computers, or the visitor's computer's requirement once it is known; and
 * the price.
 */
export function Facts({ locale }: { locale: Locale }) {
  const t = content(locale);
  const [computers, price] = t.home.hero.facts;
  return (
    <>
      <span data-show="any mobile">{computers}</span>
      {t.download.platforms.map((platform) => (
        <span key={platform.id} data-show={platform.id}>
          {platform.requirement}
        </span>
      ))}
      <span>{price}</span>
    </>
  );
}

/**
 * The closing call, on an amber card, at the end of the home and pricing pages: the plans and
 * the download, and what running the app needs.
 */
export function Close({ locale, plans }: { locale: Locale; plans: string }) {
  const all = content(locale);
  const t = all.home;
  return (
    <div className="grid justify-items-center rounded-card bg-amber px-6 py-[clamp(56px,8vw,112px)] text-center">
      <h2 id="close-title" className="text-display">
        {t.close.title.map((line) => (
          <span key={line} className="ln">
            {locale === "en" ? lastTwo(line) : line}
          </span>
        ))}
      </h2>
      <div id="close-cta" className="mt-9 flex flex-wrap justify-center gap-3">
        <a className={buttonClass({ variant: "dark" })} href={plans}>
          {all.nav.getStarted}
        </a>
        <Download
          locale={locale}
          label={all.nav.download}
          phone={t.hero.phone}
          className={buttonClass({ variant: "outline" })}
        />
      </div>
      <p className="mt-4 flex flex-wrap justify-center gap-x-4.5 text-small text-amber-ink">
        <Facts locale={locale} />
      </p>
      <p className="mt-2 text-fine text-amber-ink [&_a]:decoration-amber-ink">
        <Rich text={all.download.needs} locale={locale} />
      </p>
    </div>
  );
}
