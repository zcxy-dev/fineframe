import assert from "node:assert/strict";
import { test } from "node:test";
import { DEVICE_SCRIPT, detect } from "./device.ts";

const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const LINUX = "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";

test("a computer is told by its system", () => {
  assert.equal(detect({ userAgent: MAC, maxTouchPoints: 0 }), "mac");
  assert.equal(detect({ userAgent: WINDOWS }), "windows");
  assert.equal(detect({ userAgent: LINUX }), "linux");
});

test("the client hints come first where the browser has them", () => {
  const data = (platform: string, mobile = false) => ({ platform, mobile });
  assert.equal(detect({ userAgent: WINDOWS, userAgentData: data("Windows") }), "windows");
  assert.equal(detect({ userAgent: MAC, userAgentData: data("macOS") }), "mac");
  assert.equal(detect({ userAgent: LINUX, userAgentData: data("Linux") }), "linux");
  assert.equal(detect({ userAgent: LINUX, userAgentData: data("Android") }), "mobile");
  assert.equal(detect({ userAgent: ANDROID, userAgentData: data("Android", true) }), "mobile");
});

test("phones and tablets, an iPad asking as a Mac among them, are mobile", () => {
  assert.equal(detect({ userAgent: IPHONE, maxTouchPoints: 5 }), "mobile");
  assert.equal(detect({ userAgent: ANDROID, maxTouchPoints: 5 }), "mobile");
  assert.equal(detect({ userAgent: MAC, maxTouchPoints: 5 }), "mobile");
});

test("what the installers do not fit, and crawlers, stay unknown", () => {
  for (const userAgent of [
    "",
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux aarch64; rv:144.0) Gecko/20100101 Firefox/144.0",
    "Mozilla/5.0 (X11; FreeBSD amd64; rv:144.0) Gecko/20100101 Firefox/144.0",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Googlebot/2.1; +http://www.google.com/bot.html) Chrome/141.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15 (Applebot/0.1)",
  ]) {
    assert.equal(detect({ userAgent }), undefined, userAgent);
  }
});

test("the head script marks the page only when the device is known", () => {
  const run = (nav: object) => {
    const dataset: Record<string, string> = {};
    new Function("navigator", "document", DEVICE_SCRIPT)(nav, {
      documentElement: { dataset },
    });
    return dataset.device;
  };
  assert.equal(run({ userAgent: WINDOWS }), "windows");
  assert.equal(run({ userAgent: IPHONE, maxTouchPoints: 5 }), "mobile");
  assert.equal(run({ userAgent: "" }), undefined);
});
