// The page's server routes against a stand-in for `pnpm edit` (../../../lib/fixtures/edit.ts),
// so they run without the models, FFmpeg or a real key.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Job } from "../../../lib/jobs.ts";

const root = await mkdtemp(join(tmpdir(), "web-jobs-"));
const hold = join(root, "hold");
process.env.VIDEO_EDITOR_JOBS = root;
process.env.VIDEO_EDITOR_EDIT_CLI = fileURLToPath(
  new URL("../../../lib/fixtures/edit.ts", import.meta.url),
);
process.env.FAKE_EDIT_HOLD = hold;
// The key the page saved, which the edit gets over the server's own.
const env = join(root, ".env");
await writeFile(env, "ANTHROPIC_API_KEY=sk-ant-saved\n");
process.env.VIDEO_EDITOR_ENV_FILE = env;
process.env.ANTHROPIC_API_KEY = "sk-ant-server";
process.env.FAKE_EDIT_KEY = "sk-ant-saved";

// After the environment is set: the job store reads it once.
const jobsRoute = await import("./route.ts");
const jobRoute = await import("./[id]/route.ts");
const fileRoute = await import("./[id]/files/[index]/route.ts");
const startRoute = await import("./[id]/start/route.ts");
const eventsRoute = await import("./[id]/events/route.ts");
const videoRoute = await import("./[id]/video/route.ts");
const captionsRoute = await import("./[id]/captions/route.ts");

test.after(() => rm(root, { recursive: true, force: true }));

const url = "http://127.0.0.1/api/jobs";
const ctx = <T extends object>(params: T) => ({ params: Promise.resolve(params) });
const settings = {
  length: 60,
  aspect: "9:16",
  style: "warm",
  names: ["王小明", "GPU"],
  // A leading "-" must not read as one of the command's own options.
  musicLicense: "-CC0 1.0",
};

async function create(files: { path: string; size: number }[], body: object = { settings }) {
  const response = await jobsRoute.POST(
    new Request(url, { method: "POST", body: JSON.stringify({ ...body, files }) }),
  );
  return { response, body: (await response.json()) as Job & { error?: string } };
}

const put = (id: string, index: number, bytes: Uint8Array<ArrayBuffer>) =>
  fileRoute.PUT(new Request(`${url}/${id}/files/${index}`, { method: "PUT", body: bytes }), {
    params: Promise.resolve({ id, index: String(index) }),
  });

const start = (id: string) =>
  startRoute.POST(new Request(`${url}/${id}/start`, { method: "POST" }), ctx({ id }));

test("without a key, an edit is refused before its footage is sent, for the page to ask", async () => {
  await rm(env);
  delete process.env.ANTHROPIC_API_KEY;
  const { response, body } = await create([{ path: "a.mp4", size: 10 }]);
  assert.equal(response.status, 400);
  assert.match(body.error ?? "", /Anthropic API key/);
  assert.equal((body as { code?: string }).code, "key");
  await writeFile(env, "ANTHROPIC_API_KEY=sk-ant-saved\n");
  process.env.ANTHROPIC_API_KEY = "sk-ant-server";
});

test("bad input is refused, saying why", async () => {
  const video = [{ path: "a.mp4", size: 10 }];
  const cases: [object, { path: string; size: number }[], RegExp][] = [
    [{ settings: { ...settings, length: 5 } }, video, /shortest edit/],
    [{ settings: { ...settings, aspect: "4:3" } }, video, /aspect/],
    [{ settings: { ...settings, style: "neon" } }, video, /style/],
    [{ settings }, [{ path: "../a.mp4", size: 10 }], /\.\.\/a\.mp4/],
    [{ settings }, [{ path: "notes.txt", size: 10 }], /not a video/],
    [{ settings }, [{ path: "a.mp4", size: 0 }], /empty/],
    [{ settings }, [{ path: "photo.png", size: 10 }], /at least one video/],
    [{ settings }, [{ path: "song.mp3", size: 10 }], /at least one video/],
    [
      { settings: { ...settings, musicLicense: "" } },
      [...video, { path: "song.mp3", size: 10 }],
      /licence/,
    ],
    [{ settings: { ...settings, musicLicense: "CC0\nMIT" } }, video, /licence/],
    [{ settings }, [], /Drop some footage/],
  ];
  for (const [body, files, pattern] of cases) {
    const { response, body: reply } = await create(files, body);
    assert.equal(response.status, 400, JSON.stringify(files));
    assert.match(reply.error ?? "", pattern);
  }
});

test("an edit: files streamed in, one edit at a time, live progress, then the downloads", async () => {
  const { response, body: job } = await create([
    { path: "day 1/a.mp4", size: 4 },
    { path: "logo.png", size: 3 },
    { path: "music/song.mp3", size: 2 },
  ]);
  assert.equal(response.status, 201);
  assert.equal(job.status, "uploading");

  // A file must arrive whole, and every file before the edit starts.
  assert.equal((await put(job.id, 0, new Uint8Array(5))).status, 400, "larger than said");
  assert.equal((await put(job.id, 0, new Uint8Array(4))).status, 200);
  assert.equal((await start(job.id)).status, 409, "logo.png has not arrived");
  assert.equal((await put(job.id, 1, new Uint8Array(3))).status, 200);
  assert.equal((await put(job.id, 2, new Uint8Array(2))).status, 200);
  const dir = join(root, job.id);
  assert.ok(existsSync(join(dir, "footage", "day 1", "a.mp4")));

  await writeFile(hold, "");
  const started = await start(job.id);
  assert.equal(started.status, 200);
  assert.equal(((await started.json()) as Job).status, "running");

  // A second edit is refused before any of its footage is sent.
  const refused = await create([{ path: "b.mp4", size: 2 }]);
  assert.equal(refused.response.status, 409);
  assert.match(refused.body.error ?? "", /Another edit is running/);
  // Another site cannot start or create an edit through the user's browser.
  const foreign = { origin: "https://elsewhere.example" };
  const crossSite = await jobsRoute.POST(
    new Request(url, { method: "POST", headers: foreign, body: "{}" }),
  );
  assert.equal(crossSite.status, 403);
  const crossStart = await startRoute.POST(
    new Request(`${url}/${job.id}/start`, { method: "POST", headers: foreign }),
    ctx({ id: job.id }),
  );
  assert.equal(crossStart.status, 403);

  // The stream sends the job now and after every change, until it is done.
  const abort = new AbortController();
  const events = await eventsRoute.GET(
    new Request(`${url}/${job.id}/events`, { signal: abort.signal }),
    ctx({ id: job.id }),
  );
  assert.equal(events.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const seen: Job[] = [];
  const reader = (events.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (seen.at(-1)?.status !== "done") {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    for (;;) {
      const end = text.indexOf("\n\n");
      if (end < 0) break;
      const event = text.slice(0, end);
      text = text.slice(end + 2);
      if (event.startsWith("data: ")) seen.push(JSON.parse(event.slice(6)) as Job);
      if (seen.at(-1)?.progress?.stage === "analyze") await rm(hold, { force: true });
    }
  }
  abort.abort();
  assert.equal(seen.at(-1)?.status, "done");
  const fractions = seen.flatMap((each) => (each.progress ? [each.progress.fraction] : []));
  assert.deepEqual(fractions.at(-1), 0.6, "the render's 0.55 does not move the bar back");
  for (let i = 1; i < fractions.length; i++) {
    assert.ok((fractions[i] as number) >= (fractions[i - 1] as number), "the bar never goes back");
  }
  assert.ok(seen.some((each) => each.progress?.file === "footage/a.mp4"));
  // A model's download shows while it lasts; what Claude cost by stage shows once done.
  const download = seen.find((each) => each.download)?.download;
  assert.deepEqual(download && { ...download, secondsLeft: undefined }, {
    name: "Qwen/Qwen3-ASR-0.6B-hf",
    bytes: 0,
    total: 4000,
    secondsLeft: undefined,
  });
  assert.equal(seen.at(-1)?.download, undefined);
  assert.deepEqual(seen.at(-1)?.claude, {
    plan: { dollars: 0.07, requests: 1 },
    check: { dollars: 0.012, requests: 9 },
  });

  // The command got the footage, the music with its licence, and the settings.
  const args = JSON.parse(await readFile(join(dir, "args.json"), "utf8")) as string[];
  assert.deepEqual(args, [
    ...[join("footage", "day 1", "a.mp4"), join("footage", "logo.png")],
    ...["--length", "60", "--aspect", "9:16", "--look", "warm", "-o", join("out", "edit.mp4")],
    ...["--music", join("footage", "music", "song.mp3"), "--music-license=-CC0 1.0"],
    ...["--names", "names.txt"],
  ]);
  // The page says which track the video plays, from the project the edit wrote.
  assert.deepEqual(seen.at(-1)?.result?.music, ["music/song.mp3"]);
  assert.equal(await readFile(join(dir, "names.txt"), "utf8"), "王小明\nGPU\n");

  // A reload finds it done, and the video plays in byte ranges or downloads whole.
  const reloaded = await jobRoute.GET(new Request(`${url}/${job.id}`), ctx({ id: job.id }));
  assert.equal(((await reloaded.json()) as Job).status, "done");
  const range = await videoRoute.GET(
    new Request(`${url}/${job.id}/video`, { headers: { range: "bytes=10-19" } }),
    ctx({ id: job.id }),
  );
  assert.equal(range.status, 206);
  assert.equal(range.headers.get("content-range"), "bytes 10-19/1000");
  assert.equal((await range.arrayBuffer()).byteLength, 10);
  const video = await videoRoute.GET(
    new Request(`${url}/${job.id}/video?download`),
    ctx({ id: job.id }),
  );
  assert.equal(video.status, 200);
  assert.match(video.headers.get("content-disposition") ?? "", /edit-60s-9x16\.mp4/);
  assert.equal((await video.arrayBuffer()).byteLength, 1000);
  const captions = await captionsRoute.GET(
    new Request(`${url}/${job.id}/captions`),
    ctx({ id: job.id }),
  );
  assert.match(captions.headers.get("content-disposition") ?? "", /edit-60s-9x16\.srt/);
  assert.match(await captions.text(), /大家好/);

  // With the first done, a second is taken in; captions with no lines offer no download.
  const second = (await create([{ path: "b.mp4", size: 2 }])).body;
  assert.equal((await put(second.id, 0, new Uint8Array(2))).status, 200);
  process.env.FAKE_EDIT_NO_CAPTIONS = "1";
  assert.equal((await start(second.id)).status, 200);
  const latest = async () =>
    (await (await jobRoute.GET(new Request(url), ctx({ id: second.id }))).json()) as Job;
  while ((await latest()).status === "running") await new Promise((done) => setTimeout(done, 20));
  assert.equal((await latest()).result?.captions, false);
  const missing = await videoRoute.GET(new Request(`${url}/nope/video`), ctx({ id: "nope" }));
  assert.equal(missing.status, 404);
});
