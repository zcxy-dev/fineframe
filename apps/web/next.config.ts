import type { NextConfig } from "next";

const config: NextConfig = {
  // The engine's length rules, media kinds and caption presets are TypeScript, read by the page
  // as they are; the presets take their colours from the effects' layout.
  transpilePackages: ["@video-editor/engine", "@video-editor/effects"],
  poweredByHeader: false,
  devIndicators: false,
  reactStrictMode: true,
};

export default config;
