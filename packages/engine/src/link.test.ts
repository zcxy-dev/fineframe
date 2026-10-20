import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { fetchLink, fromYtDlp, isLink, LinkError, readLink, ytDlp, ytDlpAsset } from "./link.ts";
import { scratch } from "./testing.ts";

const FAKE = [process.execPath, fileURLToPath(new URL("edit/fixtures/yt-dlp.ts", import.meta.url))];
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** A local server answering each path with what `routes` gives, and 404 otherwise. */
async function serve(
  routes: (path: string) => { status?: number; body?: string | Buffer; to?: string } | undefined,
) {
  const asked: string[] = [];
  const server: Server = createServer((request, response) => {
    const path = request.url ?? "/";
    asked.push(path);
    const route = routes(path);
    if (route?.to) response.writeHead(302, { Location: route.to }).end();
    else if (route) response.writeHead(route.status ?? 200).end(route.body);
    else response.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, asked, close: () => server.close() };
}

test("tells links from files and folders", () => {
  assert.ok(isLink("https://www.youtube.com/watch?v=abc"));
  assert.ok(isLink("HTTP://vimeo.com/1"));
  for (const input of [
    "footage/",
    "talk.mp4",
    "C:\\clips\\a.mp4",
    "ftp://host/a.mp4",
    "https://",
  ]) {
    assert.equal(isLink(input), false, input);
  }
});

test("yt-dlp is downloaded from the latest release once its hash matches, and kept current", async (t) => {
  const asset = ytDlpAsset();
  if (!asset) return t.skip("no yt-dlp for this computer");
  const dir = await scratch(t, "yt-dlp-");
  let release = { tag: "2026.01.01", body: Buffer.from("yt-dlp one"), listed: "" };
  const server = await serve((path) => {
    if (path === "/latest/download/SHA2-256SUMS")
      return { to: `/download/${release.tag}/SHA2-256SUMS` };
    if (path === `/download/${release.tag}/SHA2-256SUMS`) {
      return { body: `${release.listed || sha256(release.body)}  ${asset}\n0000  other\n` };
    }
    if (path === `/download/${release.tag}/${asset}`) return { body: release.body };
  });
  t.after(server.close);
  const options = { release: `${server.base}/latest/download/`, dir };

  const first = await ytDlp(options);
  assert.deepEqual(await readFile(first), release.body);
  // The same release again: only its sums are read.
  server.asked.length = 0;
  assert.equal(await ytDlp(options), first);
  assert.deepEqual(server.asked, [
    "/latest/download/SHA2-256SUMS",
    "/download/2026.01.01/SHA2-256SUMS",
  ]);

  // A newer release replaces it.
  release = { tag: "2026.02.01", body: Buffer.from("yt-dlp two"), listed: "" };
  const second = await ytDlp(options);
  assert.notEqual(second, first);
  assert.deepEqual(await readFile(second), release.body);
  assert.deepEqual(await readdir(dir), [second.slice(dir.length + 1)]);

  // One that does not match its listed hash is never kept.
  release = { tag: "2026.03.01", body: Buffer.from("tampered"), listed: sha256("yt-dlp three") };
  await assert.rejects(ytDlp(options), /SHA-256/);
  assert.deepEqual(await readdir(dir), [second.slice(dir.length + 1)]);

  // GitHub out of reach: the one kept is used, and without one it says so.
  server.close();
  assert.equal(await ytDlp(options), second);
  await assert.rejects(ytDlp({ ...options, dir: await scratch(t, "yt-dlp-") }), (error) => {
    assert.ok(error instanceof LinkError);
    assert.equal(error.problem, "offline");
    return true;
  });
});

test("a link's video is read, then fetched into the folder with its progress", async (t) => {
  const body = Buffer.alloc(20_000, 3);
  const server = await serve((path) => (path.startsWith("/video") ? { body } : undefined));
  t.after(server.close);
  const dir = await scratch(t, "link-");
  const log = join(await scratch(t, "yt-dlp-log-"), "args.log");
  process.env.FAKE_YT_DLP_LOG = log;
  t.after(() => delete process.env.FAKE_YT_DLP_LOG);
  const url = `${server.base}/video?title=On%20air`;

  assert.deepEqual(await readLink(url, { program: FAKE }), {
    url,
    id: "v1",
    title: "On air",
    seconds: 37,
    site: "Generic",
  });
  const heard: [number, number][] = [];
  const fetched = await fetchLink(url, dir, {
    program: FAKE,
    stem: () => "On air",
    onProgress: (bytes, total) => heard.push([bytes, total]),
  });
  assert.equal(fetched.path, join(dir, "On air.mp4"));
  assert.deepEqual(await readFile(fetched.path), body);
  // The two streams add up, and the bar never goes back.
  assert.ok(heard.every(([bytes], i) => i === 0 || bytes >= (heard[i - 1] as [number, number])[0]));
  assert.deepEqual(heard.at(-1), [body.length, body.length]);
  assert.deepEqual(await readdir(dir), ["On air.mp4"]);

  // Without a stem, the file is named by its title and id, as the command line keeps it.
  const named = await fetchLink(url, dir, { program: FAKE });
  assert.equal(named.path, join(dir, "On air [v1].mp4"));

  // Never a configuration file or cookies, and the link only after "--".
  const runs = (await readFile(log, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as string[]);
  for (const args of runs) {
    for (const flag of [
      "--ignore-config",
      "--no-cookies",
      "--no-cookies-from-browser",
      "--no-playlist",
    ]) {
      assert.ok(args.includes(flag), flag);
    }
    assert.ok(!args.some((arg) => arg === "--cookies" || arg === "--cookies-from-browser"));
    assert.equal(args.at(-2), "--");
    assert.equal(args.at(-1), url);
  }
});

test("a playlist, a private video and a live stream are refused with what to do", async (t) => {
  const server = await serve(() => ({ body: "" }));
  t.after(server.close);
  for (const [path, problem, words] of [
    ["/playlist?list=PL1", "playlist", /one video/],
    ["/private", "private", /only public videos/],
    ["/live", "live", /live/],
  ] as const) {
    await assert.rejects(readLink(`${server.base}${path}`, { program: FAKE }), (error) => {
      assert.ok(error instanceof LinkError);
      assert.equal(error.problem, problem);
      assert.match(error.message, words);
      return true;
    });
  }
});

test("a stopped fetch leaves nothing in the folder", async (t) => {
  const server = await serve(() => ({ body: Buffer.alloc(200_000) }));
  t.after(server.close);
  const dir = await scratch(t, "link-");
  const stop = new AbortController();
  const fetching = fetchLink(`${server.base}/slow`, dir, {
    program: FAKE,
    signal: stop.signal,
    onProgress: () => stop.abort(),
  });
  await assert.rejects(fetching, { name: "AbortError" });
  assert.deepEqual(await readdir(dir), []);
});

test("yt-dlp's errors become the problem a person can act on", () => {
  for (const [error, problem] of [
    [
      "[youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.",
      "age",
    ],
    [
      "[youtube] abc: Join this channel to get access to members-only content like this video",
      "members",
    ],
    ["[youtube] abc: This live event will begin in 3 hours.", "live"],
    ["[youtube] abc: Sign in to confirm you’re not a bot.", "blocked"],
    [
      "[youtube] abc: Video unavailable. This video has been removed by the uploader",
      "unavailable",
    ],
    ["Unsupported URL: https://example.com/", "unsupported"],
    [
      "[generic] x: Unable to download webpage: <urlopen error [Errno -2] Name or service not known>",
      "offline",
    ],
  ] as const) {
    assert.equal(fromYtDlp(error).problem, problem, error);
  }
});

test("a read that is stopped stops yt-dlp", { timeout: 5000 }, async (t) => {
  const dir = await scratch(t, "link-");
  const hang = join(dir, "hang.ts");
  await writeFile(hang, "setInterval(() => {}, 1000);\n");
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 200);
  await assert.rejects(
    readLink("https://example.com/v", { program: [process.execPath, hang], signal: stop.signal }),
    {
      name: "AbortError",
    },
  );
});
