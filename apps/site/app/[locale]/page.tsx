import "../../components/home/home.css";
import type { Metadata } from "next";
import { Subscribe } from "../../components/account/Subscribe.tsx";
import { Download } from "../../components/Download.tsx";
import { Frame } from "../../components/Frame.tsx";
import { CutDemo } from "../../components/home/CutDemo.tsx";
import { Duck } from "../../components/home/Duck.tsx";
import { Float } from "../../components/home/Float.tsx";
import { Loop } from "../../components/home/Loop.tsx";
import { Reel } from "../../components/home/Reel.tsx";
import { WideEdit } from "../../components/home/WideEdit.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Phrases, Rich } from "../../components/Rich.tsx";
import { buttonClass } from "../../components/ui/button.tsx";
import { content, type Lines } from "../../lib/content.ts";
import { lastTwo } from "../../lib/english.ts";
import type { Plan } from "../../lib/paddle.ts";
import { href, type Locale, localeOf, type PageProps, pageMetadata } from "../../lib/site.ts";
import { SECTION_LEDE } from "../../lib/styles.ts";

const PLANS: Plan[] = ["monthly", "yearly"];

/**
 * While the post, the page's own buttons to the plans or the footer are on screen, the floating
 * one stays away.
 */
const CTAS = ["post", "hero-ctas", "close-cta", "footer"];

/**
 * What runs it, under the buttons: the computers, or the visitor's computer's requirement once
 * it is known; and the price.
 */
function Facts({ locale }: { locale: Locale }) {
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

/** A heading's two lines: kept whole in Chinese, and in English never ending on one word. */
function Two({ lines, locale }: { lines: Lines; locale: Locale }) {
  return lines.map((line) => (
    <span key={line} className="ln">
      {locale === "en" ? lastTwo(line) : line}
    </span>
  ));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeOf(params);
  const t = content(locale).home;
  return pageMetadata(locale, "/", t.title, t.description);
}

export default async function Home({ params }: PageProps) {
  const locale = await localeOf(params);
  const all = content(locale);
  const t = all.home;
  const { features: f, formats: y } = t;
  const plans = href(locale, "/pricing/");
  const text = (s: string) => <Rich text={s} locale={locale} />;
  return (
    <Frame locale={locale} path="/">
      <div className="home">
        <section className="hero wrap" aria-labelledby="hero-title">
          <div className="copy">
            <h1 id="hero-title">
              <Two locale={locale} lines={t.hero.title} />
            </h1>
            <p className="lede">{text(t.hero.lede)}</p>
          </div>
          <div className="act">
            <div className="ctas" id="hero-ctas">
              <a className={buttonClass()} href={plans}>
                {t.hero.plans}
              </a>
              <a className={buttonClass({ variant: "outline" })} href="#formats">
                {t.hero.watch}
              </a>
            </div>
            <p className="facts">
              <Facts locale={locale} />
            </p>
          </div>
          <Reel
            post={t.hero.post}
            steps={t.hero.steps}
            credit={text(t.hero.credit)}
            pause={t.hero.pause}
            play={t.hero.play}
          />
        </section>

        <section className="home-section" id="features" aria-labelledby="features-title">
          <div className="wrap">
            <h2 id="features-title">
              <Two locale={locale} lines={f.title} />
            </h2>
            <p className="sub">{text(f.lede)}</p>
            <div className="cards">
              <article className="card amber cut">
                <h3>
                  <Two locale={locale} lines={f.cut.title} />
                </h3>
                <p>{text(f.cut.body)}</p>
                <CutDemo
                  words={f.cut.words}
                  sample={f.cut.sample}
                  target={f.cut.target}
                  result={f.cut.result}
                />
              </article>
              <article className="card dark cap">
                <div className="txt">
                  <h3>
                    <Two locale={locale} lines={f.captions.title} />
                  </h3>
                  <p>{text(f.captions.body)}</p>
                </div>
                <figure className="clip9">
                  <Loop
                    src="/media/captions.mp4"
                    poster="/media/captions.webp"
                    width={432}
                    height={768}
                    label={f.captions.title.join(" ")}
                  />
                </figure>
                <p className="credit dim">{text(f.captions.credit)}</p>
              </article>
              <article className="card steel mus">
                <h3>
                  <Two locale={locale} lines={f.music.title} />
                </h3>
                <p>{text(f.music.body)}</p>
                <Duck voice={f.music.voice} music={f.music.music} />
              </article>
            </div>
            <p className="more">{text(f.more)}</p>
          </div>
        </section>

        <section className="home-section" id="formats" aria-labelledby="formats-title">
          <div className="wrap">
            <h2 id="formats-title">
              <Two locale={locale} lines={y.title} />
            </h2>
            <p className="sub">{text(y.lede)}</p>
            <WideEdit
              tracks={y.tracks}
              name={y.name}
              nameTitle={y.nameTitle}
              spec={
                <dl className="spec">
                  {y.spec.map(([term, value]) => (
                    <div key={term}>
                      <dt>{term}</dt>
                      <dd>
                        <Phrases text={value} locale={locale} />
                      </dd>
                    </div>
                  ))}
                </dl>
              }
            />
            <p className="credit">{text(y.credit)}</p>
          </div>
        </section>

        <section className="home-section" id="privacy" aria-labelledby="privacy-title">
          <div className="wrap">
            <div className="grid gap-x-[clamp(32px,6vw,96px)] gap-y-10 rounded-card bg-graphite p-[clamp(24px,4.4vw,64px)] text-on-dark lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
              {/* The heading takes the card's width, so each of its two lines stays whole. */}
              <h2 id="privacy-title" className="lg:col-span-2">
                <Two locale={locale} lines={t.privacy.title} />
              </h2>
              <div>
                <p className={`${SECTION_LEDE} mt-0! text-on-dark-2`}>{text(t.privacy.lede)}</p>
                <p className="mt-6 text-[15px] [&_a]:decoration-on-dark-2">
                  {text(t.privacy.more)}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-[18px] bg-white/7 p-6">
                  <p className="text-sm font-semibold text-on-dark-2">
                    <Phrases text={t.privacy.stays.title} locale={locale} />
                  </p>
                  <ul className="mt-4 space-y-3">
                    {t.privacy.stays.items.map((item) => (
                      <li key={item} className="flex items-center gap-3">
                        <Icon name="check" className="size-4.5 shrink-0 text-amber" />
                        <span>
                          <Phrases text={item} locale={locale} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-[18px] bg-amber p-6 text-ink">
                  <p className="text-sm font-semibold text-amber-ink">{t.privacy.sent.title}</p>
                  <ul className="sent mt-4 space-y-3">
                    {t.privacy.sent.items.map((item) => (
                      <li key={item} className="flex items-center gap-3">
                        <span aria-hidden="true" className="h-0.5 w-3.5 shrink-0 bg-ink" />
                        <span>
                          <Phrases text={item} locale={locale} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="home-section" id="pricing" aria-labelledby="pricing-title">
          <div className="wrap">
            <h2 id="pricing-title">
              <Two locale={locale} lines={t.pricing.title} />
            </h2>
            <p className={`${SECTION_LEDE} text-ink-2`}>{text(t.pricing.lede)}</p>
            <div className="mt-[clamp(40px,5vw,64px)] grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {all.pricing.plans.map((plan, i) => (
                <div
                  key={plan.name}
                  className="flex flex-col rounded-card bg-paper p-[clamp(24px,2.6vw,36px)]"
                >
                  <p className="font-semibold">{plan.name}</p>
                  <p className="mt-4 text-[clamp(44px,4.4vw,60px)] leading-none font-bold tracking-[-0.035em] tabular-nums">
                    {plan.price}
                    <span className="ml-1.5 text-base font-medium tracking-normal text-ink-3">
                      {plan.period}
                    </span>
                  </p>
                  <p className="mt-3 text-[15px] text-ink-3">{plan.billing}</p>
                  <div className="mt-auto pt-8">
                    <Subscribe
                      locale={locale}
                      plan={PLANS[i] as Plan}
                      labels={{
                        subscribe: all.checkout.subscribe,
                        failed: all.checkout.failed,
                        soon: all.pricing.checkout,
                      }}
                      subscribed={text(all.checkout.subscribed)}
                    />
                    <p className="mt-4 text-sm text-ink-3">
                      <Phrases text={all.pricing.terms} locale={locale} />
                    </p>
                  </div>
                </div>
              ))}
              <div className="rounded-card bg-graphite p-[clamp(24px,2.6vw,36px)] text-on-dark md:col-span-2 lg:col-span-1">
                <p className="font-semibold">{all.pricing.includedTitle}</p>
                <ul className="mt-5 space-y-3 text-[15px] text-on-dark-2">
                  {all.pricing.included.map((line) => (
                    <li key={line} className="flex gap-3">
                      <Icon name="check" className="mt-1 size-4.5 shrink-0 text-amber" />
                      <span>
                        <Phrases text={line} locale={locale} />
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="mt-6 max-w-[40em] text-[15px] text-ink-2">
              {text(t.pricing.cost)} {text(t.pricing.more)}
            </p>
          </div>
        </section>

        <section className="home-section" id="faq" aria-labelledby="faq-title">
          <div className="wrap grid gap-x-[clamp(32px,6vw,96px)] gap-y-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <h2 id="faq-title">
              <Phrases text={t.faq.title} locale={locale} />
            </h2>
            <div className="border-t-(length:--stroke) border-ink">
              {t.faq.items.map((item) => (
                <details key={item.q} className="group border-b">
                  <summary className="flex list-none items-center justify-between gap-4 py-5 text-[17px] leading-snug font-semibold [&::-webkit-details-marker]:hidden">
                    <span>
                      <Phrases text={item.q} locale={locale} />
                    </span>
                    <Icon
                      name="plus"
                      className="size-4.5 shrink-0 transition-transform duration-300 group-open:rotate-45"
                    />
                  </summary>
                  <p className="max-w-[40em] pb-6 text-ink-2">{text(item.a)}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="home-section" aria-labelledby="close-title">
          <div className="wrap">
            <div className="close grid justify-items-center rounded-card bg-amber px-6 py-[clamp(56px,8vw,112px)] text-center">
              <h2 id="close-title">
                <Two locale={locale} lines={t.close.title} />
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
              <p className="mt-4 flex flex-wrap justify-center gap-x-4.5 text-sm text-amber-ink">
                <Facts locale={locale} />
              </p>
              <p className="mt-2 text-sm text-amber-ink [&_a]:decoration-amber-ink">
                {text(all.download.needs)}
              </p>
            </div>
          </div>
        </section>
      </div>
      <Float ids={CTAS}>
        <a href={plans}>{all.nav.getStarted}</a>
      </Float>
    </Frame>
  );
}
