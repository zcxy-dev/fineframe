import type { NextConfig } from "next";

const config: NextConfig = {
  // The engine's length rules and media kinds are TypeScript, read by the page as they are.
  transpilePackages: ["@video-editor/engine"],
  poweredByHeader: false,
  devIndicators: false,
  reactStrictMode: true,
};

export default config;
