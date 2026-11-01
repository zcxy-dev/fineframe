import type { Metadata } from "next";
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

      <div className="wrap grid max-w-[1000px] gap-4 pb-end">
        <section aria-labelledby="plans">
          <h2 id="plans" className="sr-only">
            {t.title}
          </h2>
          <Plans locale={locale} />
        </section>
        <Included locale={locale} />

        <section className="mt-block" aria-labelledby="after">
          <h2 id="after" className="text-center text-heading">
            <Phrases text={t.afterTitle} locale={locale} />
          </h2>
          <ol className="mt-10 grid gap-8 md:grid-cols-3 md:gap-6">
            {t.after.map((line, i) => (
              <li
                key={line}
                className="grid content-start justify-items-center gap-4 text-center text-ink-2"
              >
                <span className="grid size-11 place-items-center rounded-full bg-ink text-body font-semibold text-white tabular-nums">
                  {i + 1}
                </span>
                <span>
                  <Rich text={line} locale={locale} />
                </span>
              </li>
            ))}
          </ol>
        </section>

        <div className="mt-block grid gap-4 md:grid-cols-2">
          <section className={CARD} aria-labelledby="key">
            <h2 id="key" className={HEADING}>
              <Phrases text={t.keyTitle} locale={locale} />
            </h2>
            {t.key.map((line) => (
              <p key={line} className={PROSE}>
                <Rich text={line} locale={locale} />
              </p>
            ))}
          </section>
          <section className={CARD} aria-labelledby="refund">
            <h2 id="refund" className={HEADING}>
              <Phrases text={t.refundTitle} locale={locale} />
            </h2>
            {t.refund.map((line) => (
              <p key={line} className={PROSE}>
                <Rich text={line} locale={locale} />
              </p>
            ))}
          </section>
        </div>

        <section className="mt-block" aria-labelledby="faq-title">
          <h2 id="faq-title" className="mb-8 text-center text-heading">
            <Phrases text={all.home.faq.title} locale={locale} />
          </h2>
          <Faq locale={locale} />
        </section>
      </div>
    </Frame>
  );
}
