import type { MetadataRoute } from "next";
import { ORIGIN } from "../lib/site.ts";

export const dynamic = "force-static";

/** Everything may be crawled; the account's pages ask to be left out of results themselves. */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", allow: "/" }, sitemap: `${ORIGIN}/sitemap.xml` };
}
