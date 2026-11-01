import type { Metadata } from "next";
import { AccountFrame } from "../../../components/account/AccountFrame.tsx";
import { ResetForm, ResetLede } from "../../../components/account/ResetForm.tsx";
import { Phrases, Rich } from "../../../components/Rich.tsx";
import { content } from "../../../lib/content.ts";
import { localeOf, type PageProps, pageMetadata } from "../../../lib/site.ts";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeOf(params);
  const t = content(locale).auth.reset;
  return pageMetadata(locale, "/reset/", t.title, t.description);
}

export default async function Reset({ params }: PageProps) {
  const locale = await localeOf(params);
  const t = content(locale).auth.reset;
  return (
    <AccountFrame
      locale={locale}
      path="/reset/"
      title={t.title}
      lede={
        <ResetLede
          lede={<Rich text={t.lede} locale={locale} />}
          newLede={<Rich text={t.newLede} locale={locale} />}
        />
      }
    >
      <ResetForm locale={locale} sentTitle={<Phrases text={t.sentTitle} locale={locale} />} />
    </AccountFrame>
  );
}
