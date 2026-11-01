import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import subsetFont from "subset-font";
import { content } from "../../../lib/content.ts";
import { LOCALES, type Locale } from "../../../lib/site.ts";

export const dynamic = "force-static";

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

const ROOT = process.cwd();
const GEIST = "node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2";
const NOTO = (weight: string) =>
  `node_modules/@expo-google-fonts/noto-sans-tc/${weight}/NotoSansTC_${weight}.ttf`;

/** Geist at one weight, or a Noto Sans TC weight, cut to `text` as TrueType for the renderer. */
async function face(file: string, text: string, weight?: number) {
  return subsetFont(await readFile(join(ROOT, file)), text, {
    targetFormat: "sfnt",
    ...(weight && { variationAxes: { wght: weight } }),
  });
}

const dataUrl = async (file: string | URL, type: string) =>
  `data:${type};base64,${(await readFile(typeof file === "string" ? join(ROOT, file) : file)).toString("base64")}`;

/**
 * The card a shared link shows, 1200 × 630, in the page's language: the wordmark, the hero's
 * headline and lede, and the post with a frame of the finished vertical edit (`reel.jpg`, the
 * hero's poster) over its credit.
 */
export async function GET(_: Request, { params }: { params: Promise<{ locale: string }> }) {
  const locale = (await params).locale as Locale;
  const hero = content(locale).home.hero;
  const zh = locale === "zh-tw";
  // Chinese breaks only after its commas, so each clause is a piece of its own; English
  // breaks between words.
  const lede = zh ? hero.lede.split(/(?<=，)/) : hero.lede.split(/(?<= )/);
  const text = `Fineframe FINEFRAME.APP ${hero.title.join("")}${hero.lede}${hero.credit}`;
  const fonts = [
    { name: "Geist", data: await face(GEIST, text, 400), weight: 400 as const },
    { name: "Geist", data: await face(GEIST, text, 600), weight: 600 as const },
    { name: "Geist", data: await face(GEIST, text, 700), weight: 700 as const },
    ...(zh
      ? [
          { name: "Noto", data: await face(NOTO("400Regular"), text), weight: 400 as const },
          { name: "Noto", data: await face(NOTO("900Black"), text), weight: 900 as const },
        ]
      : []),
  ];
  return new ImageResponse(
    <div
      style={{
        display: "flex",
        width: "100%",
        height: "100%",
        padding: "64px 80px",
        background: "#f3f4f6",
        color: "#0c0d10",
        fontFamily: "Geist, Noto",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: 620,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <img
            src={await dataUrl("public/icon.svg", "image/svg+xml")}
            width={52}
            height={52}
            alt=""
          />
          <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: "-0.02em" }}>Fineframe</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {hero.title.map((line) => (
            <div
              key={line}
              style={{
                fontFamily: zh ? "Noto, Geist" : "Geist",
                fontSize: zh ? 92 : 100,
                fontWeight: zh ? 900 : 700,
                lineHeight: 1.06,
                letterSpacing: zh ? "0.01em" : "-0.035em",
              }}
            >
              {line}
            </div>
          ))}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              marginTop: 28,
              fontSize: 27,
              lineHeight: 1.5,
              color: "#3d424b",
            }}
          >
            {lede.map((piece) => (
              <span key={piece} style={{ whiteSpace: "pre" }}>
                {piece}
              </span>
            ))}
          </div>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 18,
            fontWeight: 600,
            letterSpacing: "0.1em",
            color: "#5d636d",
          }}
        >
          <div style={{ width: 9, height: 9, borderRadius: 9, background: "#ffb547" }} />
          FINEFRAME.APP
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: 30,
          right: 96,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          fontSize: 15,
          color: "#5d636d",
        }}
      >
        <div
          style={{
            display: "flex",
            padding: 12,
            background: "#ffffff",
            border: "1px solid #dfe2e7",
            borderRadius: 28,
            boxShadow: "0 24px 48px -20px rgba(12, 13, 16, 0.28)",
          }}
        >
          <div
            style={{
              display: "flex",
              width: 288,
              height: 512,
              borderRadius: 18,
              overflow: "hidden",
            }}
          >
            {/* The poster's top rows are dark: start under them. */}
            <img
              src={await dataUrl(new URL("./reel.jpg", import.meta.url), "image/jpeg")}
              width={288}
              height={512}
              style={{ objectFit: "cover", objectPosition: "50% 100%", transform: "scale(1.03)" }}
              alt=""
            />
          </div>
        </div>
        {hero.credit}
      </div>
    </div>,
    { width: 1200, height: 630, fonts },
  );
}
