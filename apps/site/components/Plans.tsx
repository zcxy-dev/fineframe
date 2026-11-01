import { cn } from "../lib/cn.ts";
import { content } from "../lib/content.ts";
import type { Plan } from "../lib/paddle.ts";
import type { Locale } from "../lib/site.ts";
import { CARD, RAISED, SLUG } from "../lib/styles.ts";
import { Subscribe } from "./account/Subscribe.tsx";
import { Icon } from "./Icon.tsx";
import { Phrases, Rich } from "./Rich.tsx";

/** The plans in the order the content lists them. */
const PLANS: Plan[] = ["monthly", "yearly"];

/** What both plans include, each with its icon, in the content's order. */
const INCLUDED = ["laptop", "timer", "layers", "lock"] as const;

/** How buying works, under the plans, each with its icon, in the content's order. */
const TRUST = ["lock", "check", "shield", "receipt"] as const;

/**
 * The two plans side by side, each with its name, its price a month, how it is billed and its
 * button; under them, how buying works. The plan that costs less is ringed in amber, with its
 * saving on a tag and the amber button, and comes first on phones. The cards keep the content's
 * order, which the checkout pairs with Paddle's prices (`PLANS`).
 */
export function Plans({ locale }: { locale: Locale }) {
  const all = content(locale);
  const t = all.pricing;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {t.plans.map((plan, i) => (
        <div
          key={plan.name}
          className={cn(
            CARD,
            RAISED,
            "flex flex-col",
            plan.save && "border-amber ring-1 ring-amber max-md:order-first",
          )}
        >
          <div className="flex min-h-7 flex-wrap items-center justify-between gap-3">
            <h3 className={`font-sans text-ink-2 ${SLUG}`}>{plan.name}</h3>
            {plan.save && (
              <p className="rounded-full bg-amber px-3 py-1 text-fine leading-tight font-semibold text-amber-ink">
                {plan.save}
              </p>
            )}
          </div>
          <p className="mt-5 flex flex-wrap items-baseline gap-x-2">
            <span className="text-title leading-none font-bold tracking-[-0.035em] tabular-nums">
              {plan.price}
            </span>
            <span className="text-small whitespace-nowrap text-ink-3">{plan.period}</span>
          </p>
          <p className="mt-3 text-small text-ink-2">
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
          </div>
        </div>
      ))}
      <ul className="mt-2 flex flex-wrap justify-center gap-x-7 gap-y-2 text-small text-ink-2 md:col-span-2">
        {t.trust.map((line, i) => (
          <li key={line} className="flex items-center gap-2">
            <Icon name={TRUST[i] ?? "check"} className="size-4 shrink-0 text-ink-3" />
            <span>
              <Phrases text={line} locale={locale} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What both plans include, as a paper card of four, each on its icon. */
export function Included({ locale }: { locale: Locale }) {
  const t = content(locale).pricing;
  return (
    <section className={CARD} aria-labelledby="included">
      <h3 id="included" className={`font-sans text-ink-2 ${SLUG}`}>
        {t.includedTitle}
      </h3>
      <ul className="mt-6 grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {t.included.map((line, i) => (
          <li key={line} className="flex items-start gap-4 text-small text-ink-2">
            <span className="grid size-10 shrink-0 place-items-center rounded-field bg-ground text-ink">
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
