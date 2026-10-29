import { cn } from "cn";
import { content } from "../lib/content.ts";
import type { Plan } from "../lib/paddle.ts";
import type { Locale } from "../lib/site.ts";
import { CARD, RAISED } from "../lib/styles.ts";
import { Subscribe } from "./account/Subscribe.tsx";
import { Icon } from "./Icon.tsx";
import { Phrases, Rich } from "./Rich.tsx";

/** The plans in the order the content lists them. */
const PLANS: Plan[] = ["monthly", "yearly"];

/** What both plans include, each with its icon, in the content's order. */
const INCLUDED = ["laptop", "timer", "layers", "lock"] as const;

/**
 * The two plans side by side, each with its price, its button and the terms under it. The plan
 * that costs less is ringed in amber, with its saving on a tag and the amber button.
 */
export function Plans({ locale }: { locale: Locale }) {
  const all = content(locale);
  const t = all.pricing;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {t.plans.map((plan, i) => (
        <div
          key={plan.name}
          className={cn(CARD, RAISED, "flex flex-col", plan.save && "ring-2 ring-amber")}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-sans text-lg leading-snug font-semibold tracking-normal">
              {plan.name}
            </h3>
            {plan.save && (
              <p className="rounded-full bg-amber px-3 py-1 text-sm leading-tight font-semibold text-amber-ink">
                {plan.save}
              </p>
            )}
          </div>
          <p className="mt-6 text-[clamp(48px,5vw,68px)] leading-none font-bold tracking-[-0.035em] tabular-nums">
            {plan.price}
            <span className="ml-1.5 text-base font-medium tracking-normal whitespace-nowrap text-ink-3">
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
              primary={Boolean(plan.save)}
              labels={{
                subscribe: all.checkout.subscribe,
                failed: all.checkout.failed,
                soon: t.checkout,
              }}
              subscribed={<Rich text={all.checkout.subscribed} locale={locale} />}
            />
            <p className="mt-4 text-center text-sm text-ink-3">
              <Icon name="shield" className="mr-1.5 inline-block size-4 align-[-3px] text-ink-2" />
              <Phrases text={t.terms} locale={locale} />
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

/** What both plans include, as a paper card of four, each on its icon. */
export function Included({ locale }: { locale: Locale }) {
  const t = content(locale).pricing;
  return (
    <section className={`${CARD} ring-1 ring-line`} aria-labelledby="included">
      <h3 id="included" className="font-sans text-lg leading-snug font-semibold tracking-normal">
        {t.includedTitle}
      </h3>
      <ul className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {t.included.map((line, i) => (
          <li key={line} className="flex items-start gap-4 text-[15px] text-ink-2">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ground text-ink">
              <Icon name={INCLUDED[i] ?? "check"} className="size-5" />
            </span>
            <span className="pt-2">
              <Phrases text={line} locale={locale} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
