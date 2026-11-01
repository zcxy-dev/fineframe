// Writes the site's fonts to `public/fonts/`, at paths the pages can preload: Geist cut to
// the printable ASCII and the other Latin marks the site's source uses, and Noto Sans TC in the three weights the site sets (400 for
// text, 600 for labels and buttons, 900 for headings), each cut down to the Chinese characters
// the site's source uses, instead of the whole 7 MB face. Each weight comes in two files: the
// characters the home page and the frame around every page show in that weight, and the rest,
// which only the other pages need; `app/fonts.generated.css` declares every file with the
// characters it covers, so a browser downloads a file only for text that uses it, and sets any
// other character in the next font of the stack. Noto Sans SC, cut to the simplified Chinese the
// English pages quote, sets that and what Noto Sans TC lacks. `pnpm dev` and `pnpm build` run it
// first; its output is not committed.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import subsetFont from "subset-font";
import { en } from "../content/en.ts";
import { zhTw } from "../content/zh-tw.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const SOURCES = ["app", "components", "content", "lib"];
const FACE = join(ROOT, "node_modules/@expo-google-fonts/noto-sans-tc");
const WEIGHTS = { 400: "400Regular", 600: "600SemiBold", 900: "900Black" } as const;
// Han, CJK punctuation and full-width forms: what Noto Sans TC sets on the site.
const CJK = /[　-〿㐀-䶿一-鿿＀-￯]/gu;
// Latin-1, general punctuation, arrows and symbols: what Geist sets besides ASCII.
const LATIN = /[\u00a0-\u00ff\u2000-\u206f\u2190-\u2193\u20ac\u2122\u2212]/gu;
const ASCII = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join("");

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return files(path);
      return /\.(ts|tsx|css)$/.test(entry.name) ? [path] : [];
    }),
  );
  return nested.flat();
}

/** A sorted string of the CJK characters in `text`. */
const cjk = (text: string) => [...new Set(text.match(CJK) ?? [])].sort().join("");

/** `unicode-range` for these characters, runs of consecutive code points joined. */
function range(chars: string): string {
  const points = [...chars].map((c) => c.codePointAt(0) as number);
  const runs: string[] = [];
  for (let i = 0; i < points.length; ) {
    let j = i;
    while (points[j + 1] === (points[j] as number) + 1) j++;
    const hex = (p: number) => p.toString(16).toUpperCase();
    runs.push(
      i === j
        ? `U+${hex(points[i] as number)}`
        : `U+${hex(points[i] as number)}-${hex(points[j] as number)}`,
    );
    i = j + 1;
  }
  return runs.join(", ");
}

const paths = (await Promise.all(SOURCES.map((dir) => files(join(ROOT, dir))))).flat();
const source = (await Promise.all(paths.map((path) => readFile(path, "utf8")))).join("");
const all = cjk(source);
// What the home page and the frame around every page show, in each weight.
const shown = (t: typeof en) => {
  const h = t.home;
  const headings = [
    h.hero.title,
    h.features.title,
    h.features.cut.title,
    h.features.captions.title,
    h.features.music.title,
    h.formats.title,
    h.editor.title,
    h.privacy.title,
    h.pricing.title,
  ];
  return {
    400: [t.home, t.nav, t.footer, t.skip, t.languageName, t.pricing, t.download.needs],
    600: [
      [t.footer.product, t.footer.account, t.footer.legal, t.nav.getStarted],
      [t.nav.signIn, t.nav.account],
      [h.hero.plans, h.hero.watch, t.nav.download, h.features.music.voice, h.features.music.music],
      t.download.platforms.map((platform) => platform.button),
      h.formats.spec.map(([, value]) => value),
      [h.privacy.stays.title, h.privacy.sent.title, t.pricing.includedTitle],
      // The sections' eyebrows, and the names of what else the app does.
      [t.nav.examples, t.nav.features, t.nav.pricing, t.nav.faq],
      [h.features.alsoTitle, ...h.features.also.map((item) => item.title)],
      t.pricing.plans.map((plan) => [plan.name, plan.save]),
      t.pricing.checkout,
      h.faq.items.map((item) => item.q),
    ],
    900: [headings, h.faq.title, h.close.title],
  };
};
const home = (weight: keyof typeof WEIGHTS) =>
  cjk(JSON.stringify([shown(en)[weight], shown(zhTw)[weight]]));

const out = join(ROOT, "public/fonts");
await mkdir(out, { recursive: true });
// The pages add no-break spaces and hyphens where they keep words together (lib/english.ts).
const latin = [...new Set(`${ASCII}\u00a0\u2011${(source.match(LATIN) ?? []).join("")}`)]
  .sort()
  .join("");
const geist = join(
  ROOT,
  "node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
);
await writeFile(
  join(out, "geist-latin.woff2"),
  await subsetFont(await readFile(geist), latin, { targetFormat: "woff2" }),
);
const rules: string[] = [
  `@font-face {
  font-family: "Geist Variable";
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url(/fonts/geist-latin.woff2) format("woff2-variations");
  unicode-range: ${range(latin)};
}`,
];
for (const [weight, name] of Object.entries(WEIGHTS)) {
  const face = await readFile(join(FACE, name, `NotoSansTC_${name}.ttf`));
  const first = home(Number(weight) as keyof typeof WEIGHTS);
  const rest = [...all].filter((c) => !first.includes(c)).join("");
  for (const [file, chars] of [
    [`noto-sans-tc-${weight}`, first],
    [`noto-sans-tc-${weight}-more`, rest],
  ] as const) {
    if (!chars) continue;
    await writeFile(
      join(out, `${file}.woff2`),
      await subsetFont(face, chars, { targetFormat: "woff2" }),
    );
    rules.push(`@font-face {
  font-family: "Noto Sans TC";
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url(/fonts/${file}.woff2) format("woff2");
  unicode-range: ${range(chars)};
}`);
  }
}
// Noto Sans SC, for the Chinese the English pages quote: sources' names and titles, in
// simplified characters (`lang="zh-Hans"`, set by `Phrases`). Noto Sans TC lacks some of them,
// which on the Chinese pages fall through to it too. Cut to the Chinese in the English content,
// at the weights its text and headings take.
const SC = join(ROOT, "node_modules/@expo-google-fonts/noto-sans-sc");
const simplified = cjk(JSON.stringify(en));
for (const [weight, name] of [
  [400, "400Regular"],
  [700, "700Bold"],
] as const) {
  const face = await readFile(join(SC, name, `NotoSansSC_${name}.ttf`));
  await writeFile(
    join(out, `noto-sans-sc-${weight}.woff2`),
    await subsetFont(face, simplified, { targetFormat: "woff2" }),
  );
  rules.push(`@font-face {
  font-family: "Noto Sans SC";
  font-style: normal;
  font-weight: ${weight};
  font-display: swap;
  src: url(/fonts/noto-sans-sc-${weight}.woff2) format("woff2");
  unicode-range: ${range(simplified)};
}`);
}
await writeFile(
  join(ROOT, "app/fonts.generated.css"),
  `/* Written by scripts/fonts.ts. */\n${rules.join("\n\n")}\n`,
);
console.log(
  `fonts: Geist cut to ${latin.length} characters, Noto Sans TC 400, 600 and 900 to ${all.length}, and Noto Sans SC 400 and 700 to ${simplified.length}`,
);
