import type { LegalPage } from "../lib/content.ts";
import type { Locale, PagePath } from "../lib/site.ts";
import { LIST } from "../lib/styles.ts";
import { Frame } from "./Frame.tsx";
import { PageHead } from "./PageHead.tsx";
import { Phrases, Rich } from "./Rich.tsx";

/** A legal page, or the credits: its title, introduction and clauses on one paper card. */
export function Legal({ locale, path, page }: { locale: Locale; path: PagePath; page: LegalPage }) {
  return (
    <Frame locale={locale} path={path}>
      <article>
        <PageHead title={page.title} locale={locale}>
          {page.intro.map((line) => (
            <p key={line}>
              <Rich text={line} locale={locale} />
            </p>
          ))}
        </PageHead>
        <div className="wrap pb-[clamp(64px,8vw,120px)]">
          <div className="rounded-card bg-paper px-[clamp(20px,3vw,48px)]">
            {page.sections.map((section) => (
              <section
                key={section.heading}
                className="grid gap-3 border-b py-7 last:border-b-0 md:grid-cols-[minmax(180px,280px)_minmax(0,1fr)] md:gap-10 md:py-9"
              >
                <h2 className="text-[19px] leading-snug tracking-[-0.01em]">
                  <Phrases text={section.heading} locale={locale} />
                </h2>
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
              </section>
            ))}
          </div>
        </div>
      </article>
    </Frame>
  );
}
