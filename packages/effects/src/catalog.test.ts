import assert from "node:assert/strict";
import { test } from "node:test";
import { SchemaError } from "@video-editor/schema";
import { catalog, templateIds } from "./catalog.ts";
import { ems, fit, layoutFor, TYPE } from "./layout.ts";
import { type OverlayJob, overlayKey } from "./render.ts";
import { overlayProblems, validateOverlays } from "./validate.ts";

const SECOND = 120_000;
const overlay = (template: string, params: object, seconds = 2) => ({
  template,
  params: params as Record<string, unknown>,
  start: 0,
  duration: seconds * SECOND,
});

test("every template in the catalog describes itself and accepts its own example", () => {
  assert.deepEqual(templateIds, ["title", "lower-third", "keyword", "chapter", "callout", "wipe"]);
  for (const id of templateIds) {
    const template = catalog[id];
    for (const field of [template.purpose, template.whenToUse, template.avoid, template.timing]) {
      assert.ok(field.length > 20, `${id}: ${field}`);
    }
    const { min, typical, max } = template.seconds;
    assert.ok(min > 0 && min <= typical && typical <= max, id);
    assert.deepEqual(overlayProblems([overlay(id, template.example, typical)]), [], id);
  }
});

test("params are checked against their template, with the JSON path of each problem", () => {
  const problems = overlayProblems([
    overlay("sparkles", {}),
    overlay("lower-third", { name: "", role: "x", colour: "#fff" }),
    overlay("keyword", { text: "一二三四五六七八九十一二三", position: "middle" }),
    overlay("chapter", { title: "結語", index: 6, total: 5, accent: "amber" }, 3),
    overlay("callout", { rect: { x: 0.7, y: 0.2, w: 0.4, h: 0.2 } }),
  ]);
  assert.deepEqual(problems, [
    "/overlays/0/template: no template sparkles; one of title, lower-third, keyword, chapter, callout, wipe",
    "/overlays/1/params: must NOT have additional properties (colour)\n" +
      "/overlays/1/params/name: must NOT have fewer than 1 characters\n" +
      '/overlays/1/params/name: must match pattern "\\S"',
    "/overlays/2/params/text: must NOT have more than 12 characters\n" +
      "/overlays/2/params/position: must be equal to one of the allowed values",
    '/overlays/3/params/accent: must match pattern "^#[0-9a-fA-F]{6}$"',
    "/overlays/4/params/rect: x + w and y + h may not exceed 1",
  ]);
  assert.deepEqual(
    overlayProblems([overlay("chapter", { title: "結語", index: 6, total: 5 }, 3)]),
    ["/overlays/0/params/index: 6 is past total 5"],
  );
});

test("an overlay runs no shorter than its motion needs and no longer than it holds attention", () => {
  assert.deepEqual(
    overlayProblems([overlay("wipe", {}, 0.3), overlay("keyword", { text: "三倍" }, 3.5)]),
    [
      "/overlays/0/duration: 0.3 s, outside wipe's 0.4 to 1 s",
      "/overlays/1/duration: 3.5 s, outside keyword's 0.8 to 3 s",
    ],
  );
  assert.throws(() => validateOverlays([overlay("wipe", {}, 0.3)]), SchemaError);
  assert.doesNotThrow(() => validateOverlays([]));
});

test("an overlay's cache key ignores key order and changes with anything that shapes it", () => {
  const job: OverlayJob = {
    template: "callout",
    params: { label: "設定", rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.1 } },
    aspect: "9:16",
    width: 1080,
    height: 1920,
    fps: { num: 30, den: 1 },
    frames: 90,
  };
  const key = overlayKey(job, "code");
  const reordered = { ...job, params: { rect: { h: 0.1, w: 0.3, y: 0.2, x: 0.1 }, label: "設定" } };
  assert.equal(overlayKey(reordered, "code"), key);
  for (const changed of [
    { ...job, params: { ...job.params, label: "設定頁" } },
    { ...job, frames: 91 },
    { ...job, fps: { num: 30000, den: 1001 } },
    { ...job, width: 720, height: 1280 },
  ]) {
    assert.notEqual(overlayKey(changed, "code"), key);
  }
  assert.notEqual(overlayKey(job, "other code"), key);
});

test("type fits its line: CJK is one em a character, Latin about half", () => {
  assert.equal(ems("效能"), 2);
  // Two capitals at 0.64, eight lower-case letters at 0.54, a space at 0.26 and two characters.
  assert.ok(Math.abs(ems("TypeScript 型別") - 7.86) < 1e-9);
  assert.equal(fit("效能", 100, 300), 100);
  assert.equal(fit("一二三四五六七八九十", 100, 800), 80);
});

test("the safe area keeps 9:16 overlays clear of short-form apps and every aspect clear of captions", () => {
  const portrait = layoutFor("9:16", 1080, 1920);
  assert.equal(portrait.u, 10.8);
  const rounded = Object.values(portrait.safe).map((value) => Math.round(value * 10) / 10);
  assert.deepEqual(rounded, [75.6, 162, 211.2, 768]);
  assert.ok(Math.abs(portrait.type("keyword") - 7.8125 * 10.8 * 1.15) < 1e-9);
  const landscape = layoutFor("16:9", 1920, 1080);
  assert.equal(landscape.u, 10.8);
  assert.equal(landscape.safeWidth, 1920 * 0.88);
  assert.ok(Math.abs(landscape.type("keyword") - 7.8125 * 10.8) < 1e-9);
});

test("type sizes sit on one scale, each level 1.25 times the one below", () => {
  const { type } = layoutFor("16:9", 1920, 1080);
  const levels = [...new Set(Object.keys(TYPE).map((role) => type(role as keyof typeof TYPE)))];
  levels.sort((a, b) => a - b);
  for (const [i, size] of levels.entries()) {
    const below = levels[i - 1];
    if (below === undefined) continue;
    const steps = Math.log(size / below) / Math.log(1.25);
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-9 && steps >= 1, `${below} to ${size}`);
  }
  // Roles of one level share a size.
  assert.equal(type("name"), type("chapter"));
  assert.equal(type("role"), type("label"));
  assert.equal(type("count"), type("label"));
});
