import type { Metadata } from "next";
import { Legal } from "../../../components/Legal.tsx";
import { content } from "../../../lib/content.ts";
import { localeOf, type PageProps, pageMetadata } from "../../../lib/site.ts";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeOf(params);
  const page = content(locale).legal.terms;
  return pageMetadata(locale, "/terms/", page.title, page.description);
}

export default async function Terms({ params }: PageProps) {
  const locale = await localeOf(params);
  return <Legal locale={locale} path="/terms/" page={content(locale).legal.terms} />;
}
