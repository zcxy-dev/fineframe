import type { Locale } from "../lib/site.ts";
import { Icon } from "./Icon.tsx";
import { Phrases, Rich } from "./Rich.tsx";

/** Questions, each opening on its answer: the home page's before buying, the pricing page's about paying. */
export function Faq({ locale, items }: { locale: Locale; items: { q: string; a: string }[] }) {
  return (
    <div className="border-t-(length:--stroke) border-ink">
      {items.map((item) => (
        <details key={item.q} className="group border-b">
          <summary className="flex list-none items-center justify-between gap-4 py-5 text-body leading-snug font-semibold [&::-webkit-details-marker]:hidden">
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
