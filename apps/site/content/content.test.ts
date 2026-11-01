import assert from "node:assert/strict";
import { test } from "node:test";
import type { Content } from "../lib/content.ts";
import { phrases } from "../lib/typeset.ts";
import { en } from "./en.ts";
import { zhTw } from "./zh-tw.ts";

const BOTH: [string, Content][] = [
  ["en", en],
  ["zh-tw", zhTw],
];

/** Every heading the pages set, from the content. */
function headings(t: Content): string[] {
  const h = t.home;
  const legal = Object.values(t.legal).flatMap((page) => [
    page.title,
    ...page.sections.map((section) => section.heading),
  ]);
  return [
    ...h.hero.title,
    ...h.features.title,
    ...h.features.cut.title,
    ...h.features.captions.title,
    ...h.features.music.title,
    ...h.formats.title,
    ...h.privacy.title,
    ...h.pricing.title,
    ...h.close.title,
    h.faq.title,
    t.download.title,
    t.download.firstOpenTitle,
    t.download.verifyTitle,
    ...t.download.platforms.map((platform) => platform.name),
    t.pricing.title,
    t.pricing.includedTitle,
    t.pricing.keyTitle,
    t.pricing.refundTitle,
    ...t.pricing.plans.map((plan) => plan.name),
    t.auth.signIn.title,
    t.auth.signUp.title,
    t.auth.reset.title,
    t.auth.signUp.sentTitle,
    t.auth.reset.sentTitle,
    t.account.title,
    t.account.subscriptionTitle,
    t.account.downloadTitle,
    t.authorize.title,
    t.notFound.title,
    t.footer.product,
    t.footer.account,
    t.footer.legal,
    ...legal,
  ];
}

/** Every string in the content, without the addresses of its links. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value.replace(/\]\([^)]*\)/g, "]")];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

for (const [locale, t] of BOTH) {
  test(`${locale}: headings take no punctuation`, () => {
    for (const heading of headings(t)) {
      assert.doesNotMatch(heading, /[，。、；：！？,.;:!?]/, heading);
    }
  });

  test(`${locale}: no exclamation marks`, () => {
    for (const s of strings(t)) assert.doesNotMatch(s, /[!！]/, s);
  });
}

test("zh-tw: 你, not 您, except where Windows is quoted", () => {
  for (const s of strings(zhTw)) {
    assert.doesNotMatch(s.replace("Windows 已保護您的電腦", ""), /您/, s);
  }
});

test("zh-tw: a space between Chinese and Latin text", () => {
  // Names and a title written as their owners write them.
  const kept = /極客灣Geekerwan|〈\[采访vivo & MediaTek研发大佬：蓝厂与天玑合作背后的故事\]〉/g;
  for (const s of strings(zhTw)) {
    const bare = s.replace(kept, "").replace(/\*\*|`/g, "");
    assert.doesNotMatch(bare, /[一-鿿][A-Za-z0-9]|[A-Za-z0-9][一-鿿]/, s);
  }
});

test("Chinese breaks between phrases, never inside a word, a number or a name", () => {
  const cut = (s: string) => phrases(s).join("|");
  // BudouX alone splits 素|材 here.
  assert.doesNotMatch(cut("素材丟進來，剪接、字幕、配樂一次完成，"), /素\|材/);
  for (const [text, whole] of [
    ["每小時素材約 0.03 美元。", "每小時"],
    ["記憶體少於 12 GB 時，", "12 GB"],
    ["剪成的 59 秒 YouTube 影片。", "59 秒"],
    ["匯出到 Final Cut Pro、", "Final Cut Pro"],
    ["9:16、1:1 或 16:9", "9:16"],
  ] as const) {
    assert.ok(
      phrases(text).some((p) => p.includes(whole)),
      `${whole} split in ${cut(text)}`,
    );
  }
  // No line is one character, or one character and a mark.
  assert.ok(!phrases("同一份素材，選好比例就好。").some((p) => p.trim().length < 2));
});
