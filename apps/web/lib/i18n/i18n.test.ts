import assert from "node:assert/strict";
import { test } from "node:test";
import { explain } from "../fixes.ts";
import { errorResponse } from "../http.ts";
import { JobError } from "../jobs.ts";
import { formatLength } from "../settings.ts";
import { DESKTOP } from "./desktop.ts";
import {
  acceptedLanguages,
  detectLocale,
  LOCALE_COOKIE,
  LOCALES,
  localeCookie,
  resolveLocale,
  savedLocale,
} from "./locale.ts";
import { en, localeOf, MESSAGES } from "./messages.ts";

/** Every key under `value`, by its path, with what it holds: text, or a function and how many
 * values it takes. */
function shape(value: unknown, path = ""): Map<string, string> {
  const found = new Map<string, string>();
  if (typeof value === "function") found.set(path, `function/${value.length}`);
  else if (Array.isArray(value)) found.set(path, `list/${value.length}`);
  else if (typeof value === "object" && value !== null) {
    for (const [key, each] of Object.entries(value)) {
      for (const [at, kind] of shape(each, `${path}.${key}`)) found.set(at, kind);
    }
  } else found.set(path, typeof value);
  return found;
}

function assertSameKeys(languages: Record<string, unknown>) {
  const [first, ...rest] = Object.entries(languages);
  const [name, words] = first as [string, unknown];
  const expected = shape(words);
  for (const [other, theirs] of rest) {
    const actual = shape(theirs);
    const missing = [...expected.keys()].filter((key) => !actual.has(key));
    const extra = [...actual.keys()].filter((key) => !expected.has(key));
    assert.deepEqual(missing, [], `${other} lacks what ${name} has`);
    assert.deepEqual(extra, [], `${other} has what ${name} lacks`);
    for (const [key, kind] of expected) assert.equal(actual.get(key), kind, `${other}${key}`);
  }
  // No empty text, which would show as nothing.
  for (const [language, each] of Object.entries(languages)) {
    for (const [key, kind] of shape(each)) {
      if (kind !== "string") continue;
      const text = key
        .split(".")
        .slice(1)
        .reduce<unknown>((at, part) => (at as Record<string, unknown>)[part], each);
      if (key !== ".settings.sampleGap") assert.notEqual(text, "", `${language}${key}`);
    }
  }
}

test("every language has every key the page's English has, of the same kind", () => {
  assert.deepEqual(Object.keys(MESSAGES), [...LOCALES]);
  assertSameKeys(MESSAGES);
});

test("the desktop app's words have the same keys in every language", () => {
  assert.deepEqual(Object.keys(DESKTOP), [...LOCALES]);
  assertSameKeys(DESKTOP);
});

test("any Chinese system gets Traditional Chinese, and every other one English", () => {
  for (const chinese of ["zh", "zh-TW", "zh-HK", "zh-CN", "zh-Hant-TW", "zh-Hans", "ZH-tw"]) {
    assert.equal(detectLocale([chinese, "en-US"]), "zh-TW", chinese);
  }
  for (const other of ["en-US", "en", "ja-JP", "fr", "zhuang", ""]) {
    assert.equal(detectLocale([other, "zh-TW"].filter(Boolean)), other ? "en" : "zh-TW", other);
  }
  assert.equal(detectLocale([]), "en");
  // A browser's header, most preferred first by weight.
  assert.deepEqual(acceptedLanguages("en;q=0.8, zh-TW,zh;q=0.9, *;q=0.1"), ["zh-TW", "zh", "en"]);
  assert.deepEqual(acceptedLanguages(null), []);
  assert.equal(detectLocale(acceptedLanguages("zh-CN,zh;q=0.9,en;q=0.8")), "zh-TW");
  assert.equal(detectLocale(acceptedLanguages("en-GB,en;q=0.9,zh-TW;q=0.5")), "en");
});

test("the language chosen is kept, and wins over the system's on every port", () => {
  // What the switch sets, as the browser keeps it: for every path, for a year.
  const set = localeCookie("en");
  assert.match(set, new RegExp(`^${LOCALE_COOKIE}=en; Path=/; Max-Age=31536000; SameSite=Lax$`));
  const kept = set.split(";")[0] as string;
  const cookie = `other=1; ${kept}`;
  assert.equal(savedLocale(cookie), "en");
  assert.equal(resolveLocale(cookie, ["zh-TW"]), "en");
  assert.equal(resolveLocale(localeCookie("zh-TW").split(";")[0], ["en-US"]), "zh-TW");
  // Nothing chosen, or something the page does not speak: the system's.
  assert.equal(resolveLocale("other=1", ["zh-HK"]), "zh-TW");
  assert.equal(resolveLocale(`${LOCALE_COOKIE}=fr`, ["en-US"]), "en");

  // The server reads it from the request the page sends next, whatever the port.
  for (const port of [3000, 51234]) {
    const request = new Request(`http://127.0.0.1:${port}/`, {
      headers: { cookie, "accept-language": "zh-TW,zh;q=0.9" },
    });
    assert.equal(localeOf(request), "en");
  }
  const chinese = new Request("http://127.0.0.1/", { headers: { "accept-language": "zh-TW" } });
  assert.equal(localeOf(chinese), "zh-TW");
});

test("the server refuses in the language the page asks for", async () => {
  const error = new JobError((t) => t.server.notArrived("a.mp4"), 409);
  assert.equal(error.message, "a.mp4 has not arrived yet");
  const chinese = new Request("http://127.0.0.1/", { headers: { "accept-language": "zh-TW" } });
  assert.deepEqual(await errorResponse(error, chinese).json(), { error: "a.mp4 尚未傳送完成" });
  assert.deepEqual(await errorResponse(error).json(), { error: "a.mp4 has not arrived yet" });
});

test("in Chinese, units, dates and errors read as Taiwan writes them", () => {
  const t = MESSAGES["zh-TW"];
  assert.equal(formatLength(90, t), "1 分鐘 30 秒");
  assert.equal(formatLength(15, t), "15 秒");
  assert.equal(formatLength(3600, t), "1 小時");
  assert.equal(t.date(new Date(2026, 9, 19, 13, 47).getTime()), "2026/10/19 下午 1:47");

  // A fix is in Chinese; the program's own message stays as it wrote it behind details.
  const key = explain("401 authentication_error", "x", t);
  assert.equal(key.summary, "Anthropic 不接受這組 API 金鑰。");
  assert.equal(key.details, "401 authentication_error");
  // A message the program left in English is said by the fallback, with it behind details.
  const english = explain("footage/影片.mp4: the analysis failed", "剪輯在完成前停止了。", t);
  assert.equal(english.summary, "剪輯在完成前停止了。");
  assert.equal(english.details, "footage/影片.mp4: the analysis failed");
  // One the server said in Chinese is shown as it is; in English, an English one is too.
  assert.equal(explain("找不到這個版本", "x", t).summary, "找不到這個版本");
  assert.equal(explain("No such version", "x", en).summary, "No such version");
});
