import type { Metadata } from "next";
import { Frame } from "../../../components/Frame.tsx";
import { Icon } from "../../../components/Icon.tsx";
import { PageHead } from "../../../components/PageHead.tsx";
import { Phrases, Rich } from "../../../components/Rich.tsx";
import { ShareLink } from "../../../components/ShareLink.tsx";
import { buttonClass } from "../../../components/ui/button.tsx";
import { content } from "../../../lib/content.ts";
import { DOWNLOADS, localeOf, type PageProps, pageMetadata } from "../../../lib/site.ts";
import { CARD, HEADING, LIST, NOTICE } from "../../../lib/styles.ts";

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
      <PageHead
        title={t.title}
        locale={locale}
        aside={
          <figure className="m-0">
            <div className="overflow-hidden rounded-frame border bg-paper shadow-raised">
              <img
                className="block h-auto w-full"
                src="/media/app-start.webp"
                srcSet="/media/app-start-sm.webp 1440w, /media/app-start.webp 2880w"
                sizes="(min-width: 1024px) 680px, calc(100vw - 2 * var(--gutter))"
                width={2880}
                height={1800}
                alt={t.screen}
                fetchPriority="high"
              />
            </div>
          </figure>
        }
      >
        <p>
          <Rich text={t.lede} locale={locale} />
        </p>
        <p className="text-small text-ink-3">
          <Rich text={t.needs} locale={locale} />
        </p>
      </PageHead>

      <div className="wrap grid grid-cols-1 gap-4 pb-end">
        {/* On a phone or tablet: the installers are for a computer, so send the page there. */}
        <div data-show="mobile" className={`${NOTICE} grid justify-items-start gap-4 bg-paper!`}>
          <p>
            <Phrases text={t.phone} locale={locale} />
          </p>
          <ShareLink label={t.share} copied={t.copied} />
        </div>
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
                <h2 id={`${platform.id}-title`} className="text-heading">
                  {platform.name}
                </h2>
                <p className="mt-1 text-small text-ink-3">
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
              <p className="text-fine">
                <span className="sr-only">{t.table.installer}: </span>
                <code>{platform.file}</code>
              </p>
              <ol className="space-y-3 border-t pt-5 text-small text-ink-2 [counter-reset:step] computer:lg:col-start-2 computer:lg:row-span-3 computer:lg:row-start-1 computer:lg:border-t-0 computer:lg:pt-0">
                {platform.steps.map((step) => (
                  <li
                    key={step}
                    className="relative pl-8 [counter-increment:step] before:absolute before:top-0.5 before:left-0 before:grid before:size-5.5 before:place-items-center before:rounded-full before:bg-ink before:text-slug before:leading-none before:font-semibold before:text-white before:tabular-nums before:content-[counter(step)]"
                  >
                    <Rich text={step} locale={locale} />
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </section>
        {/* On a computer, which sees only its own card: the other computers' installers. */}
        <p
          data-show="mac windows linux"
          className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-small text-ink-2"
        >
          <span>{t.others}</span>
          {t.platforms.map((platform) => (
            <a
              key={platform.id}
              className="inline-flex min-h-10 items-center gap-1.5 font-semibold text-ink"
              data-show={t.platforms
                .map((p) => p.id)
                .filter((id) => id !== platform.id)
                .join(" ")}
              href={`${DOWNLOADS}/${platform.file}`}
            >
              <Icon name="download" className="size-4" />
              {platform.name}
            </a>
          ))}
        </p>

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
