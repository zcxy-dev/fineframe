import "@fontsource-variable/inter";
import "@fontsource/noto-sans-tc/400.css";
import "@fontsource/noto-sans-tc/500.css";
import "@fontsource/noto-sans-tc/700.css";
import "./globals.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { BACKGROUND, backgroundCss } from "../lib/theme.ts";

export const metadata: Metadata = {
  title: "Fineframe",
  description: "Drop in footage, choose a length and an aspect, and get back a finished video.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: BACKGROUND.dark },
    { media: "(prefers-color-scheme: light)", color: BACKGROUND.light },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <style>{backgroundCss}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
