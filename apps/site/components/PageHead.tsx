import type { ReactNode } from "react";
import type { Locale } from "../lib/site.ts";
import { Phrases } from "./Rich.tsx";

/** An inner page's heading and the sentence under it. */
export function PageHead({
  title,
  locale,
  children,
}: {
  title: string;
  locale: Locale;
  children?: ReactNode;
}) {
  return (
    <header className="wrap pt-[clamp(40px,6vw,88px)] pb-[clamp(32px,4vw,56px)]">
      <h1 className="text-[clamp(40px,5.6vw,76px)] leading-[1.06]">
        <Phrases text={title} locale={locale} />
      </h1>
      {children && (
        <div className="mt-5 max-w-[40em] space-y-3 text-[clamp(17px,1.3vw,19px)] text-ink-2">
          {children}
        </div>
      )}
    </header>
  );
}
