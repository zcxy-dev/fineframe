import type { Metadata } from "next";
import { AccountFrame } from "../../../components/account/AccountFrame.tsx";
import { AuthForm } from "../../../components/account/AuthForm.tsx";
import { Phrases, Rich } from "../../../components/Rich.tsx";
import { content } from "../../../lib/content.ts";
import { localeOf, type PageProps, pageMetadata } from "../../../lib/site.ts";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeOf(params);
  const t = content(locale).auth.signUp;
  return pageMetadata(locale, "/signup/", t.title, t.description);
}

export default async function SignUp({ params }: PageProps) {
  const locale = await localeOf(params);
  const auth = content(locale).auth;
  const t = auth.signUp;
  return (
    <AccountFrame locale={locale} path="/signup/" title={t.title} lede={t.lede}>
      <AuthForm
        locale={locale}
        mode="signUp"
        agree={<Rich text={auth.agree} locale={locale} />}
        sentTitle={<Phrases text={t.sentTitle} locale={locale} />}
      />
    </AccountFrame>
  );
}
