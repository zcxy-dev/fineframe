import type { Metadata } from "next";
import { Legal } from "../../../components/Legal.tsx";
import { content } from "../../../lib/content.ts";
import { localeOf, type PageProps, pageMetadata } from "../../../lib/site.ts";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeOf(params);
  const page = content(locale).legal.privacy;
  return pageMetadata(locale, "/privacy/", page.title, page.description);
}

export default async function Privacy({ params }: PageProps) {
  const locale = await localeOf(params);
  return <Legal locale={locale} path="/privacy/" page={content(locale).legal.privacy} />;
}
