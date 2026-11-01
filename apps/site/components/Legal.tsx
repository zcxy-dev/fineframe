import { content, type LegalPage } from "../lib/content.ts";
import type { Locale, PagePath } from "../lib/site.ts";
import { LIST, SLUG } from "../lib/styles.ts";
import { Frame } from "./Frame.tsx";
import { Icon } from "./Icon.tsx";
import { PageHead } from "./PageHead.tsx";
import { Phrases, Rich } from "./Rich.tsx";

/** A section's address on the page, which the contents and a shared link point at. */
const anchor = (i: number) => `section-${i + 1}`;

/**
 * A legal page, or the credits: its title, introduction and numbered clauses on one paper card,
 * each with an address of its own. A page of more than three clauses gets its contents: beside
 * the card from 1024 px, kept in view; above it, folded, on smaller screens. `images` sets a
 * picture beside each clause (the credits' footage).
 */
export function Legal({
  locale,
  path,
  page,
  images,
}: {
  locale: Locale;
  path: PagePath;
  page: LegalPage;
  images?: { src: string; width: number; height: number }[];
}) {
  const t = content(locale);
  const toc = page.sections.length > 3;
  const list = (
    <ol className="grid gap-0.5 text-small">
      {page.sections.map((section, i) => (
        <li key={section.heading}>
          <a
            className="flex min-h-10 items-baseline gap-3 rounded-field py-2 text-ink-2 no-underline hover:text-ink lg:min-h-0 lg:py-1.5"
            href={`#${anchor(i)}`}
          >
            <span className="w-5 shrink-0 text-ink-3 tabular-nums">{i + 1}</span>
            <span>
              <Phrases text={section.heading} locale={locale} />
            </span>
          </a>
        </li>
      ))}
    </ol>
  );
  return (
    <Frame locale={locale} path={path}>
      <article>
        <PageHead title={page.title} locale={locale}>
          {page.intro.map((line) => (
            <p key={line}>
              <Rich text={line} locale={locale} />
            </p>
          ))}
          {page.updated && <p className="text-small text-ink-3">{page.updated}</p>}
        </PageHead>
        <div
          className={`wrap grid gap-6 pb-end ${toc ? "lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)] lg:gap-12" : ""}`}
        >
          {toc && (
            <>
              <nav className="hidden lg:block" aria-labelledby="contents">
                <div className="sticky top-24">
                  <h2 id="contents" className={`mb-3 font-sans text-ink-3 ${SLUG}`}>
                    {t.contents}
                  </h2>
                  {list}
                </div>
              </nav>
              <details className="group rounded-frame border bg-paper px-5 lg:hidden">
                <summary className="flex min-h-12 list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
                  {t.contents}
                  <Icon
                    name="plus"
                    className="size-4.5 shrink-0 transition-transform duration-300 group-open:rotate-45"
                  />
                </summary>
                <nav className="pb-3" aria-label={t.contents}>
                  {list}
                </nav>
              </details>
            </>
          )}
          <div className="rounded-card border bg-paper px-[clamp(20px,3vw,48px)] shadow-card max-sm:-mx-(--gutter) max-sm:rounded-none max-sm:border-x-0 max-sm:px-(--gutter)">
            {page.sections.map((section, i) => {
              const image = images?.[i];
              return (
                <section
                  key={section.heading}
                  id={anchor(i)}
                  aria-labelledby={`${anchor(i)}-title`}
                  className="scroll-mt-24 border-b py-7 last:border-b-0 md:py-9"
                >
                  <h2 id={`${anchor(i)}-title`} className="flex items-baseline gap-3 text-subhead">
                    <span className="text-ink-3 tabular-nums">{i + 1}</span>
                    <span>
                      <Phrases text={section.heading} locale={locale} />
                    </span>
                  </h2>
                  <div
                    className={`mt-4 ${image ? "grid items-start gap-6 sm:grid-cols-[minmax(0,1fr)_auto]" : ""}`}
                  >
                    <div className="space-y-3 text-ink-2 [&>p]:max-w-[40em]">
                      {section.body.map((line) => (
                        <p key={line}>
                          <Rich text={line} locale={locale} />
                        </p>
                      ))}
                      {section.list && (
                        <ul className={LIST}>
                          {section.list.map((line) => (
                            <li key={line}>
                              <Rich text={line} locale={locale} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {image && (
                      <img
                        className="h-36 w-auto rounded-frame border sm:h-40"
                        src={image.src}
                        width={image.width}
                        height={image.height}
                        alt=""
                        loading="lazy"
                      />
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      </article>
    </Frame>
  );
}
