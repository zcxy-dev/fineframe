import { content } from "../lib/content.ts";
import type { Locale } from "../lib/site.ts";
import { Icon } from "./Icon.tsx";
import { Phrases, Rich } from "./Rich.tsx";

/** The questions asked before buying, each opening on its answer. */
export function Faq({ locale }: { locale: Locale }) {
  return (
    <div className="border-t-(length:--stroke) border-ink">
      {content(locale).home.faq.items.map((item) => (
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
          <p className="max-w-[40em] pb-6 text-ink-2">
            <Rich text={item.a} locale={locale} />
          </p>
        </details>
      ))}
    </div>
  );
}
