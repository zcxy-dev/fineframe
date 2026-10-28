import type { Metadata } from "next";
import { Frame } from "../../../components/Frame.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { PageHead } from "../../../components/PageHead.tsx";
import { Phrases, Rich } from "../../../components/Rich.tsx";
import { buttonClass } from "../../../components/ui/button.tsx";
import { content } from "../../../lib/content.ts";
import { DOWNLOADS, localeOf, type PageProps, pageMetadata } from "../../../lib/site.ts";
import { CARD, HEADING, LIST } from "../../../lib/styles.ts";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeOf(params);
  const t = content(locale).download;
  return pageMetadata(locale, "/download/", t.title, t.description);
}

export default async function Download({ params }: PageProps) {
  const locale = await localeOf(params);
  const t = content(locale).download;
  return (
    <Frame locale={locale} path="/download/">
      <PageHead title={t.title} locale={locale}>
        <p>
          <Rich text={t.lede} locale={locale} />
        </p>
      </PageHead>

      <div className="wrap grid grid-cols-1 gap-4 pb-[clamp(64px,8vw,120px)]">
        {/* On a computer, only its card, whole; elsewhere the three side by side. */}
        <section
          className="grid grid-cols-1 gap-4 lg:grid-cols-3 computer:lg:grid-cols-1"
          aria-label={t.table.installer}
        >
          {t.platforms.map((platform) => (
            <section
              key={platform.id}
              data-show={`any mobile ${platform.id}`}
              aria-labelledby={`${platform.id}-title`}
              className={`${CARD} flex flex-col gap-5 computer:lg:grid computer:lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] computer:lg:grid-rows-[auto_auto_1fr] computer:lg:content-start computer:lg:gap-x-[clamp(32px,6vw,96px)]`}
            >
              <div>
                <h2
                  id={`${platform.id}-title`}
                  className="text-[clamp(26px,2.4vw,34px)] leading-tight"
                >
                  {platform.name}
                </h2>
                <p className="mt-1 text-[15px] text-ink-3">
                  <Phrases text={platform.requirement} locale={locale} />
                </p>
              </div>
              <a
                className={`${buttonClass()} self-start justify-self-start`}
                href={`${DOWNLOADS}/${platform.file}`}
              >
                <Icon name="download" />
                {t.table.get}
                <span className="sr-only"> {platform.name}</span>
              </a>
              <p className="text-xs">
                <span className="sr-only">{t.table.installer}: </span>
                <code>{platform.file}</code>
              </p>
              <ol className="space-y-3 border-t pt-5 text-[15px] text-ink-2 [counter-reset:step] computer:lg:col-start-2 computer:lg:row-span-3 computer:lg:row-start-1 computer:lg:border-t-0 computer:lg:pt-0">
                {platform.steps.map((step) => (
                  <li
                    key={step}
                    className="relative pl-8 [counter-increment:step] before:absolute before:top-0.5 before:left-0 before:grid before:size-5.5 before:place-items-center before:rounded-full before:bg-ink before:text-[11px] before:leading-none before:font-semibold before:text-white before:tabular-nums before:content-[counter(step)]"
                  >
                    <Rich text={step} locale={locale} />
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </section>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <section className={CARD} aria-labelledby="first-open">
            <h2 id="first-open" className={HEADING}>
              <Phrases text={t.firstOpenTitle} locale={locale} />
            </h2>
            <ol className={LIST}>
              {t.firstOpen.map((line) => (
                <li key={line}>
                  <Rich text={line} locale={locale} />
                </li>
              ))}
            </ol>
          </section>
          <section className={CARD} aria-labelledby="verify">
            <h2 id="verify" className={HEADING}>
              <Phrases text={t.verifyTitle} locale={locale} />
            </h2>
            <ul className={LIST}>
              <li data-show="any mobile">
                <Rich text={t.update} locale={locale} />
              </li>
              {t.platforms.map((platform) => (
                <li key={platform.id} data-show={platform.id}>
                  <Rich text={platform.update} locale={locale} />
                </li>
              ))}
              {t.verify.map((line) => (
                <li key={line}>
                  <Rich text={line} locale={locale} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </Frame>
  );
}
