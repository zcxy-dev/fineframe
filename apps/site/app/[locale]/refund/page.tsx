import type { Metadata } from "next";
import { Legal } from "../../../components/Legal.tsx";
import { content } from "../../../lib/content.ts";
import { localeOf, type PageProps, pageMetadata } from "../../../lib/site.ts";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeOf(params);
  const page = content(locale).legal.refund;
  return pageMetadata(locale, "/refund/", page.title, page.description);
}

export default async function Refund({ params }: PageProps) {
  const locale = await localeOf(params);
  return <Legal locale={locale} path="/refund/" page={content(locale).legal.refund} />;
}
