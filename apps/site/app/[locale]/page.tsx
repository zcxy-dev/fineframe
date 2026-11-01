import "../../components/home/home.css";
import type { Metadata } from "next";
import { Close, Facts } from "../../components/Close.tsx";
import { Faq } from "../../components/Faq.tsx";
import { Frame } from "../../components/Frame.tsx";
import { CutDemo } from "../../components/home/CutDemo.tsx";
import { Duck } from "../../components/home/Duck.tsx";
import { Loop } from "../../components/home/Loop.tsx";
import { Reel } from "../../components/home/Reel.tsx";
import { Reveal } from "../../components/home/Reveal.tsx";
import { WideEdit } from "../../components/home/WideEdit.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Included, Plans } from "../../components/Plans.tsx";
import { Phrases, Rich } from "../../components/Rich.tsx";
import { buttonClass } from "../../components/ui/button.tsx";
import { content, type Lines } from "../../lib/content.ts";
import { lastTwo } from "../../lib/english.ts";
import { href, type Locale, localeOf, type PageProps, pageMetadata } from "../../lib/site.ts";
import { EYEBROW, SECTION_LEDE, SLUG } from "../../lib/styles.ts";

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
            legend={t.hero.legend}
            credit={text(t.hero.credit)}
            pause={t.hero.pause}
            play={t.hero.play}
          />
        </section>

        <section className="home-section" id="features" aria-labelledby="features-title">
          <div className="wrap">
            <header className="head">
              <div>
                <p className={`${EYEBROW} mb-4`}>{all.nav.features}</p>
                <h2 id="features-title">
                  <Two locale={locale} lines={f.title} />
                </h2>
              </div>
              <p className="sub">{text(f.lede)}</p>
            </header>
            <div className="cards">
              <article className="card amber cut" data-reveal>
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
              <article className="card dark cap on-dark" data-reveal>
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
              <article className="card steel mus" data-reveal>
                <h3>
                  <Two locale={locale} lines={f.music.title} />
                </h3>
                <p>{text(f.music.body)}</p>
                <Duck voice={f.music.voice} music={f.music.music} />
              </article>
            </div>
            <section className="also" aria-labelledby="also-title" data-reveal>
              <h3 id="also-title" className={`font-sans text-ink-3 ${SLUG}`}>
                {f.alsoTitle}
              </h3>
              <ul>
                {f.also.map((item) => (
                  <li key={item.title}>
                    <h4>
                      <Phrases text={item.title} locale={locale} />
                    </h4>
                    <p>
                      <Phrases text={item.body} locale={locale} />
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </section>

        <section className="home-section" id="formats" aria-labelledby="formats-title">
          <div className="wrap">
            <header className="head">
              <div>
                <p className={`${EYEBROW} mb-4`}>{all.nav.examples}</p>
                <h2 id="formats-title">
                  <Two locale={locale} lines={y.title} />
                </h2>
              </div>
              <p className="sub">{text(y.lede)}</p>
            </header>
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

        <section className="home-section" id="editor" aria-labelledby="editor-title">
          <div className="wrap">
            <header className="head">
              <h2 id="editor-title">
                <Two locale={locale} lines={t.editor.title} />
              </h2>
              <p className="sub">{text(t.editor.lede)}</p>
            </header>
            <figure className="window" data-reveal>
              <img
                src="/media/app-editor.webp"
                srcSet="/media/app-editor-sm.webp 1440w, /media/app-editor.webp 2880w"
                sizes="(min-width: 1800px) 1360px, (min-width: 1300px) 1240px, calc(100vw - 2 * var(--gutter))"
                width={2880}
                height={1800}
                alt={t.editor.alt}
                loading="lazy"
                decoding="async"
              />
            </figure>
            <p className="credit">{text(t.hero.credit)}</p>
          </div>
        </section>

        <section className="home-section" id="privacy" aria-labelledby="privacy-title">
          <div className="wrap">
            <div className="grid gap-x-[clamp(32px,6vw,96px)] gap-y-10 on-dark rounded-card bg-graphite p-[clamp(24px,4.4vw,64px)] text-on-dark lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
              {/* The heading takes the card's width, so each of its two lines stays whole. */}
              <h2 id="privacy-title" className="lg:col-span-2">
                <Two locale={locale} lines={t.privacy.title} />
              </h2>
              <div>
                <p className={`${SECTION_LEDE} mt-0! text-on-dark-2`}>{text(t.privacy.lede)}</p>
                <p className="mt-6 text-small [&_a]:decoration-on-dark-2">{text(t.privacy.more)}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-frame bg-white/7 p-6">
                  <p className={`${SLUG} text-on-dark-2`}>
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
                <div className="rounded-frame bg-amber p-6 text-ink">
                  <p className={`${SLUG} text-amber-ink`}>{t.privacy.sent.title}</p>
                  <ul className="sent mt-4 space-y-3" data-reveal>
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
            <header className="head">
              <div>
                <p className={`${EYEBROW} mb-4`}>{all.nav.pricing}</p>
                <h2 id="pricing-title">
                  <Two locale={locale} lines={t.pricing.title} />
                </h2>
              </div>
              <p className="sub">{text(t.pricing.lede)}</p>
            </header>
            <div className="mt-[clamp(40px,5vw,64px)] grid gap-4">
              <Plans locale={locale} />
              <Included locale={locale} />
            </div>
            <p className="mt-6 max-w-[40em] text-small text-ink-2">
              {text(t.pricing.cost)} {text(t.pricing.more)}
            </p>
          </div>
        </section>

        <section className="home-section" id="faq" aria-labelledby="faq-title">
          <div className="wrap grid gap-x-[clamp(32px,6vw,96px)] gap-y-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div>
              <p className={`${EYEBROW} mb-4`}>{all.nav.faq}</p>
              <h2 id="faq-title">
                <Phrases text={t.faq.title} locale={locale} />
              </h2>
            </div>
            <Faq locale={locale} items={t.faq.items} />
          </div>
        </section>

        <section className="home-section" aria-labelledby="close-title">
          <div className="wrap">
            <Close locale={locale} plans={plans} />
          </div>
        </section>
      </div>
      <Reveal />
    </Frame>
  );
}
