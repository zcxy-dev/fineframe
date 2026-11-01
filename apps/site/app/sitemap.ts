import type { MetadataRoute } from "next";
import { href, LANG, LOCALES, ORIGIN, PAGES, UNLISTED } from "../lib/site.ts";

export const dynamic = "force-static";

/** Every listed page in each language, each with its address in the other. */
export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.filter((path) => !UNLISTED.includes(path)).flatMap((path) =>
    LOCALES.map((locale) => ({
      url: ORIGIN + href(locale, path),
      alternates: {
        languages: Object.fromEntries(LOCALES.map((l) => [LANG[l], ORIGIN + href(l, path)])),
      },
    })),
  );
}
