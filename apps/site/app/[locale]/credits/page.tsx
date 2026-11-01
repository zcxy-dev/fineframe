import type { Metadata } from "next";
import { Legal } from "../../../components/Legal.tsx";
import { content } from "../../../lib/content.ts";
import { localeOf, type PageProps, pageMetadata } from "../../../lib/site.ts";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const locale = await localeOf(params);
  const page = content(locale).legal.credits;
  return pageMetadata(locale, "/credits/", page.title, page.description);
}

export default async function Credits({ params }: PageProps) {
  const locale = await localeOf(params);
  // Each source beside its credit, in the content's order: the Reel, the YouTube edit and the
  // captions clip, by their first frames.
  return (
    <Legal
      locale={locale}
      path="/credits/"
      page={content(locale).legal.credits}
      images={[
        { src: "/media/hero-edit.webp", width: 1080, height: 1920 },
        { src: "/media/wide.webp", width: 1920, height: 1080 },
        { src: "/media/captions.webp", width: 432, height: 768 },
      ]}
    />
  );
}
