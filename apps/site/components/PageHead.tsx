import type { ReactNode } from "react";
import type { Lines } from "../lib/content.ts";
import { lastTwo } from "../lib/english.ts";
import type { Locale } from "../lib/site.ts";
import { Phrases } from "./Rich.tsx";

/**
 * An inner page's heading and the sentence under it; `center` sets both on the page's middle,
 * over content that is centred too.
 */
export function PageHead({
  title,
  locale,
  center = false,
  children,
}: {
  /** A heading, or its two lines, each kept whole. */
  title: string | Lines;
  locale: Locale;
  center?: boolean;
  children?: ReactNode;
}) {
  return (
    <header
      className={`wrap pt-[clamp(40px,6vw,88px)] pb-[clamp(32px,4vw,56px)] ${center ? "text-center" : ""}`}
    >
      <h1 className="text-[clamp(40px,5.6vw,76px)] leading-[1.06]">
        {typeof title === "string" ? (
          <Phrases text={title} locale={locale} />
        ) : (
          title.map((line) => (
            <span key={line} className="ln">
              {locale === "en" ? lastTwo(line) : line}
            </span>
          ))
        )}
      </h1>
      {children && (
        <div
          className={`mt-5 max-w-[40em] space-y-3 text-[clamp(17px,1.3vw,19px)] text-ink-2 ${center ? "mx-auto max-w-[34em]" : ""}`}
        >
          {children}
        </div>
      )}
    </header>
  );
}
