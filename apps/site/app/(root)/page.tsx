import type { Metadata } from "next";
import { href, ORIGIN } from "../../lib/site.ts";

export const metadata: Metadata = {
  metadataBase: new URL(ORIGIN),
  title: "Fineframe",
  alternates: { languages: { en: "/en/", "zh-Hant-TW": "/zh-tw/" } },
  icons: { icon: [{ url: "/favicon.ico", sizes: "32x32" }, { url: "/icon.svg" }] },
};

// A static site has no server to read Accept-Language: the browser picks the language,
// Chinese for any Chinese, English otherwise.
const PICK = `location.replace(/(^|,)zh/i.test((navigator.languages||[navigator.language]).join(","))?"/zh-tw/":"/en/")`;

export default function LanguagePicker() {
  return (
    <main className="grid min-h-screen place-content-center justify-items-center gap-5 bg-ground px-4 py-8 text-center">
      <script dangerouslySetInnerHTML={{ __html: PICK }} />
      <img src="/icon.svg" alt="" width={40} height={40} />
      <p className="text-[22px] leading-none font-bold tracking-[-0.02em]">Fineframe</p>
      <nav className="flex gap-3 [&>a]:rounded-full [&>a]:border-(length:--stroke) [&>a]:border-ink [&>a]:px-5 [&>a]:py-2.5 [&>a]:font-semibold [&>a]:no-underline [&>a]:transition-colors [&>a]:hover:bg-paper">
        <a href={href("zh-tw", "/")} lang="zh-Hant-TW" hrefLang="zh-Hant-TW">
          繁體中文
        </a>
        <a href={href("en", "/")} hrefLang="en">
          English
        </a>
      </nav>
    </main>
  );
}
