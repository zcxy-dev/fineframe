import type { ReactNode } from "react";
import type { Lines } from "../lib/content.ts";
import { lastTwo } from "../lib/english.ts";
import type { Locale } from "../lib/site.ts";
import { Phrases } from "./Rich.tsx";

/**
 * An inner page's heading and the sentence under it; `center` sets both on the page's middle,
 * over content that is centred too. `aside` stands beside them from 1024 px, under them before.
 */
export function PageHead({
  title,
  locale,
  center = false,
  aside,
  children,
}: {
  /** A heading, or its two lines, each kept whole. */
  title: string | Lines;
  locale: Locale;
  center?: boolean;
  aside?: ReactNode;
  children?: ReactNode;
}) {
  const head = (
    <>
      <h1 className="text-title">
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
          className={`mt-5 max-w-[40em] space-y-3 text-lede text-ink-2 ${center ? "mx-auto max-w-[34em]" : ""}`}
        >
          {children}
        </div>
      )}
    </>
  );
  return (
    <header
      className={`wrap pt-head pb-[clamp(32px,4vw,56px)] ${center ? "text-center" : ""} ${aside ? "grid items-center gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]" : ""}`}
    >
      {aside ? <div>{head}</div> : head}
      {aside}
    </header>
  );
}
