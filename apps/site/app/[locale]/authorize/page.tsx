import type { Metadata } from "next";
import { AccountFrame } from "../../../components/account/AccountFrame.tsx";
import { AuthorizeView } from "../../../components/account/AuthorizeView.tsx";
import { content } from "../../../lib/content.ts";
import { localeOf, type PageProps, pageMetadata } from "../../../lib/site.ts";
import { CARD, RAISED } from "../../../lib/styles.ts";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeOf(params);
  const t = content(locale).authorize;
  return pageMetadata(locale, "/authorize/", t.title, t.description);
}

export default async function Authorize({ params }: PageProps) {
  const locale = await localeOf(params);
  const t = content(locale).authorize;
  return (
    <AccountFrame locale={locale} path="/authorize/" title={t.title}>
      <section className={`${CARD} ${RAISED}`}>
        <AuthorizeView locale={locale} />
      </section>
    </AccountFrame>
  );
}
