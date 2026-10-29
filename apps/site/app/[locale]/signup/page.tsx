import type { Metadata } from "next";
import { AccountFrame } from "../../../components/account/AccountFrame.tsx";
import { AuthForm } from "../../../components/account/AuthForm.tsx";
import { Rich } from "../../../components/Rich.tsx";
import { content } from "../../../lib/content.ts";
import { localeOf, type PageProps, pageMetadata } from "../../../lib/site.ts";
import { CARD, RAISED } from "../../../lib/styles.ts";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeOf(params);
  const t = content(locale).auth.signUp;
  return pageMetadata(locale, "/signup/", t.title, t.description);
}

export default async function SignUp({ params }: PageProps) {
  const locale = await localeOf(params);
  const t = content(locale).auth.signUp;
  return (
    <AccountFrame locale={locale} path="/signup/" title={t.title}>
      <section className={`${CARD} ${RAISED}`}>
        <AuthForm locale={locale} mode="signUp" agree={<Rich text={t.agree} locale={locale} />} />
      </section>
    </AccountFrame>
  );
}
