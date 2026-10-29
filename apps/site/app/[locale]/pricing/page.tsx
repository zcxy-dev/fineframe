import type { Metadata } from "next";
import { Subscribe } from "../../../components/account/Subscribe.tsx";
import { Frame } from "../../../components/Frame.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { PageHead } from "../../../components/PageHead.tsx";
import { Phrases, Rich } from "../../../components/Rich.tsx";
import { content } from "../../../lib/content.ts";
import type { Plan } from "../../../lib/paddle.ts";
import { localeOf, type PageProps, pageMetadata } from "../../../lib/site.ts";
import { CARD, HEADING, LIST, PROSE } from "../../../lib/styles.ts";

/** The plans in the order the content lists them. */
const PLANS: Plan[] = ["monthly", "yearly"];

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
      <PageHead title={t.title} locale={locale}>
        <p>
          <Rich text={t.lede} locale={locale} />
        </p>
      </PageHead>

      <div className="wrap grid gap-4 pb-[clamp(64px,8vw,120px)]">
        <section
          className="grid gap-4 md:grid-cols-2 lg:grid-cols-[repeat(2,minmax(0,1fr))_minmax(0,1.2fr)]"
          aria-label={t.title}
        >
          {t.plans.map((plan, i) => (
            <div key={plan.name} className={`${CARD} flex flex-col`}>
              <h2 className="font-sans text-lg leading-snug font-semibold tracking-normal">
                {plan.name}
              </h2>
              <p className="mt-5 text-[clamp(44px,4.4vw,64px)] leading-none font-bold tracking-[-0.035em] tabular-nums">
                {plan.price}
                <span className="ml-1.5 text-base font-medium tracking-normal text-ink-3">
                  {plan.period}
                </span>
              </p>
              <p className="mt-3 text-[15px] text-ink-3">
                <Phrases text={plan.billing} locale={locale} />
              </p>
              <div className="mt-auto pt-8">
                <Subscribe
                  locale={locale}
                  plan={PLANS[i] as Plan}
                  labels={{
                    subscribe: all.checkout.subscribe,
                    failed: all.checkout.failed,
                    soon: all.pricing.checkout,
                  }}
                  subscribed={<Rich text={all.checkout.subscribed} locale={locale} />}
                />
                <p className="mt-4 text-sm text-ink-3">
                  <Phrases text={t.terms} locale={locale} />
                </p>
              </div>
            </div>
          ))}
          <div
            className={`${CARD} border-(length:--stroke) border-line bg-ground! md:col-span-2 lg:col-span-1`}
          >
            <h2 className="font-sans text-lg leading-snug font-semibold tracking-normal">
              {t.includedTitle}
            </h2>
            <ul className="mt-5 space-y-3 text-[15px] text-ink-2">
              {t.included.map((line) => (
                <li key={line} className="flex gap-3">
                  <Icon name="check" className="mt-1 size-4.5 shrink-0 text-ink" />
                  <span>
                    <Phrases text={line} locale={locale} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <section className={CARD} aria-labelledby="after">
            <h2 id="after" className={HEADING}>
              <Phrases text={t.afterTitle} locale={locale} />
            </h2>
            <ol className={LIST}>
              {t.after.map((line) => (
                <li key={line}>
                  <Rich text={line} locale={locale} />
                </li>
              ))}
            </ol>
          </section>
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
      </div>
    </Frame>
  );
}
