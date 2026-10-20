import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { cacheDir } from "./download.ts";
import { ffmpeg, run } from "./ffmpeg.ts";
import { fetchLink, fromYtDlp, isLink, LinkError, readLink, ytDlp, ytDlpAsset } from "./link.ts";
import { scratch } from "./testing.ts";

const FAKE = [process.execPath, fileURLToPath(new URL("edit/fixtures/yt-dlp.ts", import.meta.url))];
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** Whether process `pid` still runs. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Waits up to two seconds for each of `pids` to end, and says whether they all did. */
async function ended(pids: number[]): Promise<boolean> {
  for (let i = 0; i < 40 && pids.some(alive); i++) await new Promise((r) => setTimeout(r, 50));
  return !pids.some(alive);
}

/** The ids the stand-in wrote to `file`: its own and its writer's. */
async function pidsIn(file: string): Promise<number[]> {
  return (await readFile(file, "utf8")).trim().split("\n").map(Number);
}

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
  // As GitHub does: the latest release's files redirect to the tagged ones, which redirect to a
  // storage host whose URLs name no file.
  const server = await serve((path) => {
    if (path === "/latest/download/SHA2-256SUMS") {
      return { to: `/download/${release.tag}/SHA2-256SUMS` };
    }
    if (path === `/download/${release.tag}/SHA2-256SUMS`)
      return { to: `/storage/1?${release.tag}` };
    if (path === `/download/${release.tag}/${asset}`) return { to: `/storage/2?${release.tag}` };
    if (path === `/storage/1?${release.tag}`) {
      return { body: `${release.listed || sha256(release.body)}  ${asset}\n0000  other\n` };
    }
    if (path === `/storage/2?${release.tag}`) return { body: release.body };
  });
  t.after(server.close);
  const options = { release: `${server.base}/latest/download/`, dir };

  // Links pasted together check it once.
  const [first, again] = await Promise.all([ytDlp(options), ytDlp(options)]);
  assert.equal(again, first);
  assert.deepEqual(await readFile(first), release.body);
  // Downloaded earlier than the next, as releases are days apart.
  await utimes(first, new Date(2026, 0, 1), new Date(2026, 0, 1));
  // The same release again: only its sums are read.
  server.asked.length = 0;
  assert.equal(await ytDlp(options), first);
  assert.deepEqual(server.asked, [
    "/latest/download/SHA2-256SUMS",
    "/download/2026.01.01/SHA2-256SUMS",
    "/storage/1?2026.01.01",
  ]);

  // A newer release is used from then on; the one before stays for an import that started with
  // it, and goes at the release after.
  const name = (path: string) => path.slice(dir.length + 1);
  release = { tag: "2026.02.01", body: Buffer.from("yt-dlp two"), listed: "" };
  const second = await ytDlp(options);
  assert.notEqual(second, first);
  assert.deepEqual(await readFile(second), release.body);
  assert.deepEqual((await readdir(dir)).sort(), [name(first), name(second)].sort());
  await utimes(second, new Date(2026, 1, 1), new Date(2026, 1, 1));
  release = { tag: "2026.03.01", body: Buffer.from("yt-dlp three"), listed: "" };
  const third = await ytDlp(options);
  assert.deepEqual((await readdir(dir)).sort(), [name(second), name(third)].sort());

  // One that does not match its listed hash is never kept.
  release = { tag: "2026.04.01", body: Buffer.from("tampered"), listed: sha256("yt-dlp four") };
  await assert.rejects(ytDlp(options), /SHA-256/);
  assert.deepEqual((await readdir(dir)).sort(), [name(second), name(third)].sort());

  // GitHub out of reach: the newest kept is used, whatever order the folder lists them in, and
  // without one it says so.
  server.close();
  await utimes(second, new Date(2026, 0, 1), new Date(2026, 0, 1));
  assert.equal(await ytDlp(options), third);
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

  // A file already there is never written over, even one whose name differs only in case, as
  // macOS and Windows do not tell those apart.
  await writeFile(join(dir, "on AIR.mp4"), "a file of the user's");
  const beside = await fetchLink(url, dir, { program: FAKE, stem: () => "On air" });
  assert.equal(beside.path, join(dir, "On air (2).mp4"));
  assert.equal(await readFile(join(dir, "on AIR.mp4"), "utf8"), "a file of the user's");
  assert.deepEqual(await readFile(join(dir, "On air.mp4")), body);

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

test("a stopped fetch stops yt-dlp and what it runs, and leaves nothing in the folder", async (t) => {
  const server = await serve(() => ({ body: Buffer.alloc(200_000) }));
  t.after(server.close);
  const dir = await scratch(t, "link-");
  const pids = join(await scratch(t, "pids-"), "pids");
  process.env.FAKE_YT_DLP_PIDS = pids;
  t.after(() => delete process.env.FAKE_YT_DLP_PIDS);
  const stop = new AbortController();
  const fetching = fetchLink(`${server.base}/slow`, dir, {
    program: FAKE,
    signal: stop.signal,
    onProgress: () => stop.abort(),
  });
  await assert.rejects(fetching, { name: "AbortError" });
  assert.deepEqual(await readdir(dir), []);
  assert.ok(await ended(await pidsIn(pids)), "yt-dlp and its writer still run");
});

for (const [how, signal] of [
  ["ends", null],
  ["is interrupted (Ctrl+C)", "SIGINT"],
  ["is stopped", "SIGTERM"],
] as const) {
  test(`a program that ${how} while fetching leaves nothing running or behind`, async (t) => {
    const server = await serve(() => ({ body: Buffer.alloc(200_000) }));
    t.after(server.close);
    const dir = await scratch(t, "link-");
    const pids = join(await scratch(t, "pids-"), "pids");
    // Fetches a link and, once it is under way, says so, then exits by itself unless a signal
    // is to end it.
    const script = `
      import { fetchLink } from ${JSON.stringify(new URL("link.ts", import.meta.url).href)};
      let said = false;
      await fetchLink(process.argv[1], process.argv[2], {
        program: JSON.parse(process.argv[3]),
        onProgress: () => {
          if (said) return;
          said = true;
          process.stdout.write("fetching\\n");
          if (process.argv[4] === "exit") process.exit(0);
        },
      });`;
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        script,
        `${server.base}/slow`,
        dir,
        JSON.stringify(FAKE),
        signal ? "wait" : "exit",
      ],
      { env: { ...process.env, FAKE_YT_DLP_PIDS: pids }, stdio: ["ignore", "pipe", "inherit"] },
    );
    const exited = once(child, "exit");
    await once(child.stdout, "data");
    if (signal) child.kill(signal);
    await exited;
    assert.ok(await ended(await pidsIn(pids)), "yt-dlp and its writer still run");
    assert.deepEqual(await readdir(dir), []);
  });
}

// yt-dlp itself, as kept in the cache by an earlier import: CI has none, and tests download
// nothing, so it is skipped there.
const kept = (await readdir(cacheDir()).catch(() => [])).find((name) =>
  /^yt-dlp-[0-9a-f]{12}(\.exe)?$/.test(name),
);
test("streams MP4 cannot hold are kept as Matroska, and MP4 stays MP4", {
  skip: kept ? false : "no yt-dlp kept in the cache: import a link once to run it",
}, async (t) => {
  const dir = await scratch(t, "link-");
  const sources = await scratch(t, "sources-");
  const encode = async (name: string, codecs: string[]) => {
    const lavfi = [
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=320x240:rate=25",
      "-f",
      "lavfi",
      "-i",
      "sine=f=440",
    ];
    await run(await ffmpeg(), ["-v", "error", ...lavfi, "-t", "2", ...codecs, join(sources, name)]);
    return readFile(join(sources, name));
  };
  const files: Record<string, Buffer> = {
    "/vp8.webm": await encode("vp8.webm", ["-c:v", "libvpx", "-c:a", "libvorbis"]),
    "/h264.mp4": await encode("h264.mp4", ["-c:v", "libx264", "-c:a", "aac"]),
  };
  const server = await serve((path) => (files[path] ? { body: files[path] } : undefined));
  t.after(server.close);
  const program = [join(cacheDir(), kept as string)];
  const webm = await fetchLink(`${server.base}/vp8.webm`, dir, { program, stem: () => "vp8" });
  assert.equal(webm.path, join(dir, "vp8.mkv"));
  const mp4 = await fetchLink(`${server.base}/h264.mp4`, dir, { program, stem: () => "h264" });
  assert.equal(mp4.path, join(dir, "h264.mp4"));
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
    // What the link says is not what yt-dlp said.
    ["Unsupported URL: https://example.com/premium-members/live", "unsupported"],
    ["[generic] premium: Unable to download webpage: HTTP Error 404: Not Found", "unavailable"],
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
