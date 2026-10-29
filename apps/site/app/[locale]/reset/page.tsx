import type { Metadata } from "next";
import { AccountFrame } from "../../../components/account/AccountFrame.tsx";
import { ResetForm } from "../../../components/account/ResetForm.tsx";
import { content } from "../../../lib/content.ts";
import { localeOf, type PageProps, pageMetadata } from "../../../lib/site.ts";
import { CARD, RAISED } from "../../../lib/styles.ts";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeOf(params);
  const t = content(locale).auth.reset;
  return pageMetadata(locale, "/reset/", t.title, t.description);
}

export default async function Reset({ params }: PageProps) {
  const locale = await localeOf(params);
  const t = content(locale).auth.reset;
  return (
    <AccountFrame locale={locale} path="/reset/" title={t.title} lede={t.lede}>
      <section className={`${CARD} ${RAISED}`}>
        <ResetForm locale={locale} />
      </section>
    </AccountFrame>
  );
}
