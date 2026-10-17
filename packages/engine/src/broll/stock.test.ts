import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { scratch } from "../testing.ts";
import { creditText } from "./credits.ts";
import { findStock, pickFile, SEARCH_TTL_MS } from "./stock.ts";

// Made-up replies in each API's shape.
const PEXELS = {
  videos: [
    {
      id: 101,
      url: "https://www.pexels.com/video/portrait-101/",
      duration: 9,
      user: { name: "Ada Example", url: "https://www.pexels.com/@ada" },
      video_files: [
        { file_type: "video/mp4", width: 1080, height: 1920, link: "https://videos.example/101" },
      ],
    },
    {
      id: 102,
      url: "https://www.pexels.com/video/short-102/",
      duration: 2,
      user: { name: "Ada Example", url: "https://www.pexels.com/@ada" },
      video_files: [
        { file_type: "video/mp4", width: 1920, height: 1080, link: "https://videos.example/102" },
      ],
    },
    {
      id: 103,
      url: "https://www.pexels.com/video/city-103/",
      duration: 12,
      user: { name: "Ben Sample", url: "https://www.pexels.com/@ben" },
      video_files: [
        {
          file_type: "video/mp4",
          width: 3840,
          height: 2160,
          link: "https://videos.example/103-4k",
        },
        {
          file_type: "video/mp4",
          width: 1920,
          height: 1080,
          link: "https://videos.example/103-hd",
        },
        { file_type: "video/mp4", width: 1280, height: 720, link: "https://videos.example/103-sd" },
        { file_type: "application/x-mpegURL", width: null, height: null, link: "https://x/m3u8" },
      ],
    },
  ],
};

const PIXABAY = {
  hits: [
    {
      id: 201,
      pageURL: "https://pixabay.com/videos/city-201/",
      duration: 15,
      user: "cara",
      user_id: 7,
      videos: {
        large: { url: "https://cdn.example/201-large.mp4", width: 1920, height: 1080 },
        medium: { url: "https://cdn.example/201-medium.mp4", width: 1280, height: 720 },
        small: { url: "", width: 0, height: 0 },
      },
    },
  ],
};

/** A fetch that answers searches with `replies` and downloads with the URL's own bytes. */
function fake(replies: Record<string, { status: number; body?: unknown }>) {
  const asked: string[] = [];
  const get = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    asked.push(url);
    const host = new URL(url).host;
    const reply = replies[host];
    if (reply) {
      // The key never travels in a Pexels URL, and only Pixabay's own API sees it.
      if (host === "api.pexels.com") {
        assert.equal(new Headers(init?.headers).get("authorization"), "pexels-key");
      }
      return new Response(JSON.stringify(reply.body ?? {}), { status: reply.status });
    }
    return new Response(`clip from ${url}`, { status: 200 });
  }) as typeof fetch;
  return { get, asked };
}

test("picks the first Pexels clip that fits the orientation and length, at 1080p", async (t) => {
  const dir = await scratch(t, "stock-");
  const { get } = fake({ "api.pexels.com": { status: 200, body: PEXELS } });
  const clip = await findStock({
    query: "city at night",
    orientation: "landscape",
    minSeconds: 4,
    keys: { pexels: "pexels-key" },
    dir,
    fetch: get,
  });
  assert.ok(clip);
  assert.equal(clip.provider, "pexels");
  assert.equal(clip.id, "103");
  assert.equal(`${clip.width}x${clip.height}`, "1920x1080");
  assert.equal(await readFile(clip.path, "utf8"), "clip from https://videos.example/103-hd");
  assert.deepEqual(clip.credit, {
    what: "Video by Ben Sample on Pexels",
    source: "https://www.pexels.com/video/city-103/",
    license: { name: "Pexels License", url: "https://www.pexels.com/license/" },
    by: { name: "Ben Sample", url: "https://www.pexels.com/@ben" },
  });
});

test("a search is kept for 24 hours and asked again after", async (t) => {
  const dir = await scratch(t, "stock-");
  const { get, asked } = fake({ "pixabay.com": { status: 200, body: PIXABAY } });
  let now = 1_000;
  const find = () =>
    findStock({
      query: "city",
      orientation: "landscape",
      keys: { pixabay: "pixabay-key" },
      dir,
      fetch: get,
      now: () => now,
    });
  await find();
  now += SEARCH_TTL_MS - 1;
  await find();
  const searches = () => asked.filter((url) => url.startsWith("https://pixabay.com/api/")).length;
  assert.equal(searches(), 1);
  // The clip is downloaded once and kept, never linked to.
  assert.equal(asked.filter((url) => url.includes("cdn.example")).length, 1);
  now += 1;
  await find();
  assert.equal(searches(), 2);
  // The cache holds what was found, never the key.
  for (const file of await readdir(join(dir, "searches"))) {
    assert.doesNotMatch(await readFile(join(dir, "searches", file), "utf8"), /pixabay-key/);
  }
});

test("falls back to Pixabay when Pexels refuses, and says why", async (t) => {
  const dir = await scratch(t, "stock-");
  const { get } = fake({
    "api.pexels.com": { status: 429 },
    "pixabay.com": { status: 200, body: PIXABAY },
  });
  const problems: string[] = [];
  const clip = await findStock({
    query: "city",
    orientation: "landscape",
    keys: { pexels: "pexels-key", pixabay: "pixabay-key" },
    dir,
    fetch: get,
    onProblem: (message) => problems.push(message),
  });
  assert.equal(clip?.provider, "pixabay");
  assert.equal(clip?.credit.what, "Video by cara on Pixabay");
  assert.equal(clip?.credit.by?.url, "https://pixabay.com/users/cara-7/");
  assert.deepEqual(problems, ["Pexels's rate limit is reached; try again later"]);
});

test("without a key nothing is asked and nothing is found", async (t) => {
  const dir = await scratch(t, "stock-");
  const { get, asked } = fake({});
  const clip = await findStock({
    query: "city",
    orientation: "portrait",
    keys: {},
    dir,
    fetch: get,
  });
  assert.equal(clip, null);
  assert.deepEqual(asked, []);
});

test("skips clips the video already shows", async (t) => {
  const dir = await scratch(t, "stock-");
  const { get } = fake({ "api.pexels.com": { status: 200, body: PEXELS } });
  const clip = await findStock({
    query: "phone",
    orientation: "portrait",
    exclude: ["pexels:101"],
    keys: { pexels: "pexels-key" },
    dir,
    fetch: get,
  });
  assert.equal(clip, null);
});

test("takes the smallest file that reaches the size, else the largest", () => {
  const files = [
    { width: 3840, height: 2160 },
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
    { width: 1080, height: 1920 },
  ];
  assert.deepEqual(pickFile(files, "landscape", 1080), { width: 1920, height: 1080 });
  assert.deepEqual(pickFile(files, "landscape", 4000), { width: 3840, height: 2160 });
  assert.deepEqual(pickFile(files, "portrait", 720), { width: 1080, height: 1920 });
  assert.equal(pickFile([], "portrait", 720), null);
});

test("credits list each source once, with its licence and author", () => {
  const credit = {
    what: "Video by Ben Sample on Pexels",
    source: "https://www.pexels.com/video/city-103/",
    license: { name: "Pexels License", url: "https://www.pexels.com/license/" },
    by: { name: "Ben Sample", url: "https://www.pexels.com/@ben" },
  };
  const page = {
    what: "Screenshot of example.com",
    source: "https://example.com/",
    license: null,
    by: null,
  };
  assert.equal(
    creditText("edit.mp4", [credit, page, credit]),
    [
      "B-roll in edit.mp4, with where each piece came from.",
      "",
      "Video by Ben Sample on Pexels",
      "  Source: https://www.pexels.com/video/city-103/",
      "  By: Ben Sample (https://www.pexels.com/@ben)",
      "  Licence: Pexels License (https://www.pexels.com/license/)",
      "",
      "Screenshot of example.com",
      "  Source: https://example.com/",
      "",
    ].join("\n"),
  );
});
