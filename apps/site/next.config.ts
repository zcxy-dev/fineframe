import type { NextConfig } from "next";

// Public values the browser code is built with (DEPLOY.md). A build without one fails here
// rather than shipping pages that cannot sign in. Paddle's come in before billing is turned on.
const PUBLIC_ENV = ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"];
const missing = PUBLIC_ENV.filter((name) => !process.env[name]);
if (missing.length > 0) throw new Error(`Set ${missing.join(", ")}: see DEPLOY.md.`);

const config: NextConfig = {
  // A static site: `next build` writes every page as HTML to `out/` for Cloudflare Pages.
  output: "export",
  // `/en/download/` is served as `out/en/download/index.html`.
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  devIndicators: false,
  reactStrictMode: true,
  // Each language has its own root layout, so the 404 page has one of its own.
  experimental: { globalNotFound: true },
  // The share cards cut their fonts with subset-font, which loads its WebAssembly from its own
  // folder: left out of the bundle, it finds it.
  serverExternalPackages: ["subset-font"],
};

export default config;
