import type { Metadata } from "next";
import { AccountFrame } from "../../../components/account/AccountFrame.tsx";
import { AccountView } from "../../../components/account/AccountView.tsx";
import { content } from "../../../lib/content.ts";
import { localeOf, type PageProps, pageMetadata } from "../../../lib/site.ts";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeOf(params);
  const t = content(locale).account;
  return pageMetadata(locale, "/account/", t.title, t.description);
}

export default async function Account({ params }: PageProps) {
  const locale = await localeOf(params);
  const t = content(locale).account;
  return (
    <AccountFrame locale={locale} path="/account/" title={t.title}>
      <AccountView locale={locale} />
    </AccountFrame>
  );
}
