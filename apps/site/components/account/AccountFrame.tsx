import type { ReactNode } from "react";
import type { Locale, PagePath } from "../../lib/site.ts";
import { Frame } from "../Frame.tsx";
import { PageHead } from "../PageHead.tsx";
import { Rich } from "../Rich.tsx";

/** An account page: its title, and its form or view, which runs in the browser. */
export function AccountFrame({
  locale,
  path,
  title,
  lede,
  children,
}: {
  locale: Locale;
  path: PagePath;
  title: string;
  lede?: string;
  children: ReactNode;
}) {
  return (
    <Frame locale={locale} path={path}>
      <PageHead title={title} locale={locale}>
        {lede && (
          <p>
            <Rich text={lede} locale={locale} />
          </p>
        )}
      </PageHead>
      <div className="wrap pb-[clamp(64px,8vw,120px)]">{children}</div>
    </Frame>
  );
}
