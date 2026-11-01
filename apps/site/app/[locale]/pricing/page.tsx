import type { Metadata } from "next";
import { Close } from "../../../components/Close.tsx";
import { Faq } from "../../../components/Faq.tsx";
import { Frame } from "../../../components/Frame.tsx";
import { PageHead } from "../../../components/PageHead.tsx";
import { Included, Plans } from "../../../components/Plans.tsx";
import { Phrases, Rich } from "../../../components/Rich.tsx";
import { content } from "../../../lib/content.ts";
import { localeOf, type PageProps, pageMetadata } from "../../../lib/site.ts";
import { CARD, HEADING, PROSE } from "../../../lib/styles.ts";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeOf(params);
  const t = content(locale).pricing;
  return pageMetadata(locale, "/pricing/", t.title, t.description);
}

/**
 * The plans and how buying works, what both include, what Claude costs beside the steps after
 * subscribing, the questions about paying, and the closing call.
 */
export default async function Pricing({ params }: PageProps) {
  const locale = await localeOf(params);
  const all = content(locale);
  const t = all.pricing;
  return (
    <Frame locale={locale} path="/pricing/">
      <PageHead title={t.heading} locale={locale} center>
        <p>
          <Rich text={t.lede} locale={locale} />
        </p>
      </PageHead>

      <div className="wrap grid max-w-[1000px] gap-4">
        <section id="plans" aria-labelledby="plans-title">
          <h2 id="plans-title" className="sr-only">
            {t.title}
          </h2>
          <Plans locale={locale} />
        </section>
        <div className="mt-4">
          <Included locale={locale} />
        </div>

        <div className="mt-block grid gap-4 md:grid-cols-2">
          <section className={CARD} aria-labelledby="key">
            <h2 id="key" className={HEADING}>
              <Phrases text={t.keyTitle} locale={locale} />
            </h2>
            <p className={PROSE}>
              <Rich text={t.key} locale={locale} />
            </p>
            <dl className="mt-6 border-t">
              {t.keyRows.map(([length, cost]) => (
                <div key={length} className="flex justify-between gap-4 border-b py-3 text-small">
                  <dt className="text-ink-2">{length}</dt>
                  <dd className="text-right font-semibold whitespace-nowrap tabular-nums">
                    {cost}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
          <section className={CARD} aria-labelledby="after">
            <h2 id="after" className={HEADING}>
              <Phrases text={t.afterTitle} locale={locale} />
            </h2>
            <ol className="grid gap-4">
              {t.after.map((line, i) => (
                <li key={line} className="flex gap-4 text-ink-2">
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink text-fine font-semibold text-white tabular-nums">
                    {i + 1}
                  </span>
                  <span className="pt-0.5">
                    <Rich text={line} locale={locale} />
                  </span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <section
          className="mt-block grid gap-x-[clamp(32px,6vw,96px)] gap-y-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
          aria-labelledby="faq-title"
        >
          <h2 id="faq-title" className="text-heading">
            <Phrases text={t.faqTitle} locale={locale} />
          </h2>
          <Faq locale={locale} items={t.faq} />
        </section>
      </div>

      <section className="wrap pt-block pb-end" aria-labelledby="close-title">
        <Close locale={locale} plans="#plans" />
      </section>
    </Frame>
  );
}
