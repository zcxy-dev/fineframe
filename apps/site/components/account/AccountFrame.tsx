import type { ReactNode } from "react";
import type { Locale, PagePath } from "../../lib/site.ts";
import { Frame } from "../Frame.tsx";
import { PageHead } from "../PageHead.tsx";
import { Phrases, Rich } from "../Rich.tsx";

/**
 * An account page: its title, and its form or view, which runs in the browser. The forms (sign
 * in, sign up, reset, authorize) stand in one narrow column under the app's icon; the account
 * page takes the page's width.
 */
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
  if (path === "/account/") {
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
  return (
    <Frame locale={locale} path={path}>
      <div className="wrap max-w-[460px] pt-[clamp(40px,6vw,80px)] pb-[clamp(64px,8vw,120px)]">
        <header className="grid justify-items-center text-center">
          <img src="/icon.svg" alt="" width={48} height={48} />
          <h1 className="mt-6 text-[clamp(32px,3.4vw,44px)] leading-[1.1]">
            <Phrases text={title} locale={locale} />
          </h1>
          {lede && (
            <p className="mt-3 text-ink-2">
              <Rich text={lede} locale={locale} />
            </p>
          )}
        </header>
        <div className="mt-8">{children}</div>
      </div>
    </Frame>
  );
}
