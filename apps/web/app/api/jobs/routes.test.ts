// The page's server routes against a stand-in for `pnpm edit` (../../../lib/fixtures/edit.ts),
// so they run without the models, FFmpeg or a real key.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { EditView, Job, ProjectSummary } from "../../../lib/jobs.ts";

const root = await mkdtemp(join(tmpdir(), "web-jobs-"));
const hold = join(root, "hold");
process.env.VIDEO_EDITOR_JOBS = root;
process.env.VIDEO_EDITOR_EDIT_CLI = fileURLToPath(
  new URL("../../../lib/fixtures/edit.ts", import.meta.url),
);
process.env.FAKE_EDIT_HOLD = hold;
process.env.VIDEO_EDITOR_RENDER_CLI = fileURLToPath(
  new URL("../../../lib/fixtures/render.ts", import.meta.url),
);
process.env.VIDEO_EDITOR_YT_DLP = fileURLToPath(
  new URL("../../../../../packages/engine/src/edit/fixtures/yt-dlp.ts", import.meta.url),
);
// The key the page saved, which the edit gets over the server's own.
const env = join(root, ".env");
await writeFile(env, "ANTHROPIC_API_KEY=sk-ant-saved\n");
process.env.VIDEO_EDITOR_ENV_FILE = env;
process.env.ANTHROPIC_API_KEY = "sk-ant-server";
process.env.FAKE_EDIT_KEY = "sk-ant-saved";
delete process.env.OPENROUTER_API_KEY;
delete process.env.PEXELS_API_KEY;
delete process.env.PIXABAY_API_KEY;

// After the environment is set: the job store reads it once.
const jobsRoute = await import("./route.ts");
const jobRoute = await import("./[id]/route.ts");
const fileRoute = await import("./[id]/files/[index]/route.ts");
const startRoute = await import("./[id]/start/route.ts");
const eventsRoute = await import("./[id]/events/route.ts");
const videoRoute = await import("./[id]/video/route.ts");
const captionsRoute = await import("./[id]/captions/route.ts");
const brollRoute = await import("./[id]/broll/route.ts");
const rememberedRoute = await import("../remembered/route.ts");
const removeRoute = await import("./[id]/remove/route.ts");
const editRoute = await import("./[id]/edit/route.ts");
const previewRoute = await import("./[id]/preview/route.ts");
const versionsRoute = await import("./[id]/versions/route.ts");
const versionRoute = await import("./[id]/versions/[n]/route.ts");
const replanRoute = await import("./[id]/replan/route.ts");
const shortsRoute = await import("./[id]/shorts/route.ts");
const linksRoute = await import("../links/route.ts");

test.after(() => rm(root, { recursive: true, force: true }));

const url = "http://127.0.0.1/api/jobs";
const ctx = <T extends object>(params: T) => ({ params: Promise.resolve(params) });
const settings = {
  length: 60,
  aspect: "9:16",
  style: "warm",
  names: ["王小明"],
  terms: ["GPU"],
  // A leading "-" must not read as one of the command's own options.
  musicLicense: "-CC0 1.0",
  // Whatever this computer's memory would choose.
  asr: "local",
};

async function create(files: { path: string; size: number }[], body: object = { settings }) {
  const response = await jobsRoute.POST(
    new Request(url, { method: "POST", body: JSON.stringify({ ...body, files }) }),
  );
  return { response, body: (await response.json()) as Job & { error?: string } };
}

const put = (id: string, index: number, bytes: Uint8Array<ArrayBuffer>) =>
  fileRoute.PUT(
    // The route checks the name the request is addressed to, as the proxy does for the others.
    new Request(`${url}/${id}/files/${index}`, {
      method: "PUT",
      headers: { host: "127.0.0.1" },
      body: bytes,
    }),
    {
      params: Promise.resolve({ id, index: String(index) }),
    },
  );

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
    [{ settings: { ...settings, asr: "elsewhere" } }, video, /Speech is heard/],
    [{ settings: { ...settings, visuals: "loud" } }, video, /Visuals are rich or minimal/],
    [{ settings: { ...settings, quality: "cheap" } }, video, /Quality is best or economy/],
    [{ settings: { ...settings, correct: "yes" } }, video, /correction is on or off/],
    [
      { settings: { ...settings, captions: "comic" } },
      video,
      /caption style is bold, creator, minimal, pop, none/,
    ],
    [{ settings: { ...settings, terms: "GPU" } }, video, /Terms are a list/],
    [{ settings: { ...settings, terms: ["GPU\nTPU"] } }, video, /A term is one line/],
    [{ settings: { ...settings, instructions: 5 } }, video, /What you tell Claude is text/],
    [
      { settings: { ...settings, instructions: "x".repeat(2001) } },
      video,
      /Tell Claude what you want in at most 2000 characters, not 2001/,
    ],
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
  // Its names and terms are offered again for the next edit, once it has started.
  const remembered = await (await rememberedRoute.GET()).json();
  assert.deepEqual(remembered, { names: ["王小明"], terms: ["GPU"] });

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
  // The analysis's step shows while it is on it.
  assert.ok(seen.some((each) => each.progress?.step === "transcribe"));
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
    ...["--length", "60", "--aspect", "9:16", "--look", "warm", "--visuals=rich"],
    // The advanced settings as they start: the best quality, no correction, bold captions.
    ...["--quality", "best", "--captions", "bold"],
    ...["-o", join("out", "edit.mp4")],
    ...["--music", join("footage", "music", "song.mp3"), "--music-license=-CC0 1.0"],
    ...["--names", "names.txt", "--terms", "terms.txt"],
  ]);
  // The page says which track the video plays, from the project the edit wrote.
  assert.deepEqual(seen.at(-1)?.result?.music, ["music/song.mp3"]);
  assert.equal(await readFile(join(dir, "names.txt"), "utf8"), "王小明\n");
  assert.equal(await readFile(join(dir, "terms.txt"), "utf8"), "GPU\n");

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
  // Rich visuals, the default, credit the B-roll the video shows.
  assert.equal(seen.at(-1)?.settings.visuals, "rich");
  assert.equal(seen.at(-1)?.result?.broll, true);
  const credits = await brollRoute.GET(
    new Request(`${url}/${job.id}/broll?download`),
    ctx({ id: job.id }),
  );
  assert.equal(credits.status, 200);
  assert.match(credits.headers.get("content-disposition") ?? "", /edit-60s-9x16\.broll\.txt/);
  assert.match(await credits.text(), /Pexels License/);
  // No stock footage keys saved, none passed.
  assert.equal(await readFile(join(dir, "stock.txt"), "utf8"), " ");

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

test("speech heard on OpenRouter needs its key, which the edit gets with --asr cloud", async () => {
  const cloud = {
    settings: { ...settings, musicLicense: undefined, asr: "cloud", visuals: "minimal" },
  };
  const refused = await create([{ path: "c.mp4", size: 2 }], cloud);
  assert.equal(refused.response.status, 400);
  assert.match(refused.body.error ?? "", /OpenRouter API key/);
  assert.equal((refused.body as { code?: string }).code, "openrouter");

  await writeFile(env, "ANTHROPIC_API_KEY=sk-ant-saved\nOPENROUTER_API_KEY=sk-or-saved\n");
  const { body: job } = await create([{ path: "c.mp4", size: 2 }], cloud);
  assert.equal(job.settings.asr, "cloud");
  assert.equal((await put(job.id, 0, new Uint8Array(2))).status, 200);
  assert.equal((await start(job.id)).status, 200);
  const latest = async () =>
    (await (await jobRoute.GET(new Request(url), ctx({ id: job.id }))).json()) as Job;
  while ((await latest()).status === "running") await new Promise((done) => setTimeout(done, 20));
  const dir = join(root, job.id);
  const args = JSON.parse(await readFile(join(dir, "args.json"), "utf8")) as string[];
  assert.deepEqual(args.slice(args.indexOf("--asr"), args.indexOf("--asr") + 2), [
    "--asr",
    "cloud",
  ]);
  assert.equal(await readFile(join(dir, "openrouter.txt"), "utf8"), "sk-or-saved");
  // Minimal visuals: no B-roll, so no credits to download.
  assert.ok(args.includes("--visuals=minimal"));
  assert.equal((await latest()).result?.broll, false);
  const credits = await brollRoute.GET(new Request(`${url}/${job.id}/broll`), ctx({ id: job.id }));
  assert.equal(credits.status, 404);
});

test("the advanced settings reach the edit, and names or terms left empty are not passed", async () => {
  const advanced = {
    settings: {
      ...settings,
      musicLicense: undefined,
      names: [],
      quality: "economy",
      correct: true,
      captions: "pop",
    },
  };
  const { body: job } = await create([{ path: "e.mp4", size: 2 }], advanced);
  assert.equal((await put(job.id, 0, new Uint8Array(2))).status, 200);
  assert.equal((await start(job.id)).status, 200);
  const latest = async () =>
    (await (await jobRoute.GET(new Request(url), ctx({ id: job.id }))).json()) as Job;
  while ((await latest()).status === "running") await new Promise((done) => setTimeout(done, 20));
  const args = JSON.parse(await readFile(join(root, job.id, "args.json"), "utf8")) as string[];
  const after = (option: string) => args[args.indexOf(option) + 1];
  assert.equal(after("--quality"), "economy");
  assert.ok(args.includes("--correct"));
  assert.equal(after("--captions"), "pop");
  assert.ok(!args.includes("--names"));
  assert.equal(after("--terms"), "terms.txt");
});

test("what the user tells Claude goes to the first edit's plan only, and is not remembered", async () => {
  delete process.env.FAKE_RENDER_FAIL;
  const one = (instructions: string) =>
    create([{ path: "g.mp4", size: 2 }], {
      settings: { ...settings, musicLicense: undefined, instructions },
    });
  // Trimmed, up to 2000 characters; only spaces is nothing asked.
  const longest = await one(` ${"x".repeat(2000)} `);
  assert.equal(longest.response.status, 201);
  assert.equal(longest.body.settings.instructions, "x".repeat(2000));
  assert.ok(!("instructions" in (await one("  \n ")).body.settings));

  // A leading "-" must not read as one of the command's own options.
  const { body: created } = await one(" -Open with the goal.\nLeave out the small talk. ");
  const id = created.id;
  assert.equal((await put(id, 0, new Uint8Array(2))).status, 200);
  assert.equal((await start(id)).status, 200);
  const read = async () =>
    (await (await jobRoute.GET(new Request(url), ctx({ id }))).json()) as Job;
  const until = async (done: (job: Job) => boolean) => {
    for (;;) {
      const job = await read();
      if (done(job)) return job;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  await until((job) => job.status === "done");
  const argsOf = async () =>
    JSON.parse(await readFile(join(root, id, "args.json"), "utf8")) as string[];
  const first = await argsOf();
  assert.deepEqual(
    first.filter((arg) => arg.startsWith("--instructions")),
    ["--instructions=-Open with the goal.\nLeave out the small talk."],
  );
  // The next edit's box starts empty: only the names and terms are kept for it.
  assert.deepEqual(await (await rememberedRoute.GET()).json(), {
    names: ["王小明"],
    terms: ["GPU"],
  });

  // A re-plan asks only what its own box says, and version 1 says it had instructions.
  const replanned = await replanRoute.POST(
    new Request(`${url}/${id}/replan`, {
      method: "POST",
      body: JSON.stringify({ length: 30, aspect: "1:1", music: "auto" }),
    }),
    ctx({ id }),
  );
  assert.equal(replanned.status, 200);
  const job = await until((each) => each.render === undefined);
  assert.equal(job.versions?.[0]?.summary, "The edit, with instructions");
  assert.ok(!(await argsOf()).some((arg) => arg.startsWith("--instructions")));
});

test("the Pexels and Pixabay keys the page saved go to an edit with rich visuals only", async () => {
  await writeFile(
    env,
    "ANTHROPIC_API_KEY=sk-ant-saved\nPEXELS_API_KEY=pexels-saved\nPIXABAY_API_KEY=1-pixabay\n",
  );
  const passed = async (visuals: string) => {
    const { body: job } = await create([{ path: "d.mp4", size: 2 }], {
      settings: { ...settings, musicLicense: undefined, visuals },
    });
    assert.equal((await put(job.id, 0, new Uint8Array(2))).status, 200);
    assert.equal((await start(job.id)).status, 200);
    const latest = async () =>
      (await (await jobRoute.GET(new Request(url), ctx({ id: job.id }))).json()) as Job;
    while ((await latest()).status === "running") await new Promise((done) => setTimeout(done, 20));
    return readFile(join(root, job.id, "stock.txt"), "utf8");
  };
  assert.equal(await passed("rich"), "pexels-saved 1-pixabay");
  assert.equal(await passed("minimal"), " ");
});

test("the project list shows each edit's disk usage, and deleting one removes its folder", async () => {
  const listed = async () => (await (await jobsRoute.GET()).json()) as ProjectSummary[];
  const before = await listed();
  assert.ok(before.length >= 2);
  for (let i = 1; i < before.length; i++) {
    assert.ok((before[i - 1] as ProjectSummary).created >= (before[i] as ProjectSummary).created);
  }
  const done = before.find((project) => project.status === "done") as ProjectSummary;
  assert.ok(done.bytes >= 1000, "the video counts");
  assert.equal(done.footage, true);

  const remove = (id: string, headers: Record<string, string> = {}) =>
    removeRoute.POST(new Request(`${url}/${id}/remove`, { method: "POST", headers }), ctx({ id }));
  const foreign = await remove(done.id, { origin: "https://elsewhere.example" });
  assert.equal(foreign.status, 403);
  assert.equal((await remove(done.id)).status, 204);
  assert.equal(existsSync(join(root, done.id)), false);
  assert.ok(!(await listed()).some((project) => project.id === done.id));
  assert.equal((await remove(done.id)).status, 404);
});

test("a finished edit changes as versions, the newest three keeping their videos", async () => {
  delete process.env.FAKE_EDIT_NO_CAPTIONS;
  const { body: created } = await create([{ path: "c.mp4", size: 2 }]);
  assert.equal((await put(created.id, 0, new Uint8Array(2))).status, 200);
  assert.equal((await start(created.id)).status, 200);
  const id = created.id;
  const dir = join(root, id);
  const read = async () =>
    (await (await jobRoute.GET(new Request(url), ctx({ id }))).json()) as Job;
  const until = async (done: (job: Job) => boolean) => {
    for (;;) {
      const job = await read();
      if (done(job)) return job;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  await until((job) => job.status === "done");

  const view = (await (
    await editRoute.GET(new Request(`${url}/${id}/edit`), ctx({ id }))
  ).json()) as EditView;
  assert.equal(view.version, 1);
  assert.equal(view.captions, "bold");
  assert.ok(view.lines.length > 0);
  // Each overlay, graphic and B-roll clip by what it is and what it shows, never a template's id.
  assert.deepEqual(
    view.removables.map((item) => item.label),
    ["Lower third: 王小明", "Title: Claude", "B-roll: screen.mp4"],
  );
  assert.equal(view.older, false);
  // The same edit as 0.4.0 wrote it, with a card and a keyword pop: it opens without them, and
  // the panel says that re-planning gives it the new motion graphics.
  const projectFile = join(dir, "out", "edit.project.json");
  const current = await readFile(projectFile, "utf8");
  const old = JSON.parse(current);
  old.cards = [
    { card: "stat", params: { value: 3 }, start: 0, duration: 360_000, placement: "full" },
  ];
  old.overlays.push({ template: "keyword", params: { text: "三倍" }, start: 0, duration: 180_000 });
  await writeFile(projectFile, JSON.stringify(old));
  const older = (await (
    await editRoute.GET(new Request(`${url}/${id}/edit`), ctx({ id }))
  ).json()) as EditView;
  assert.equal(older.older, true);
  assert.deepEqual(older.removables, view.removables);
  await writeFile(projectFile, current);
  // The example project names analyses that are not there, which a cut needs: it says so.
  const preview = await previewRoute.POST(
    new Request(`${url}/${id}/preview`, {
      method: "POST",
      body: JSON.stringify({ cuts: [[120_000, 240_000]] }),
    }),
    ctx({ id }),
  );
  assert.equal(preview.status, 400);

  const apply = (captions: string) =>
    versionsRoute.POST(
      new Request(`${url}/${id}/versions`, {
        method: "POST",
        body: JSON.stringify({ revision: { captions }, summary: `captions ${captions}` }),
      }),
      ctx({ id }),
    );
  // Another caption style only renders again: the edit command, which plans with Claude, does
  // not run, the record is the one shown with the style changed, and no plan cost is added.
  const renders = join(root, "renders.log");
  process.env.FAKE_RENDER_LOG = renders;
  const planned = await readFile(join(dir, "args.json"), "utf8");
  for (const [n, captions] of [
    [2, "creator"],
    [3, "minimal"],
    [4, "pop"],
  ] as const) {
    const shown = JSON.parse(
      await readFile(
        join(dir, "out", n === 2 ? "edit.project.json" : `edit-v${n - 1}.project.json`),
        "utf8",
      ),
    );
    const response = await apply(captions);
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as Job).render?.version, n);
    const job = await until((each) => each.render === undefined);
    assert.equal(job.current, n);
    const record = JSON.parse(await readFile(join(dir, "out", `edit-v${n}.project.json`), "utf8"));
    assert.deepEqual(record, { ...shown, captions: { ...shown.captions, preset: captions } });
    // The version keeps its caption style, which the summary shows.
    assert.equal(job.versions?.at(-1)?.captions, captions);
    assert.equal(job.versions?.at(-1)?.claude, undefined);
    const rendered = (await readFile(renders, "utf8")).trim().split("\n");
    assert.equal(rendered.length, n - 1);
    assert.ok(rendered.at(-1)?.includes(`edit-v${n}.project.json`), rendered.at(-1));
  }
  assert.equal(await readFile(join(dir, "args.json"), "utf8"), planned);
  delete process.env.FAKE_RENDER_LOG;
  // Version 1 keeps its record, not its video; the downloads are the version shown.
  let job = await read();
  assert.deepEqual(
    job.versions?.map((version) => [version.n, version.video]),
    [
      [1, false],
      [2, true],
      [3, true],
      [4, true],
    ],
  );
  assert.equal(existsSync(join(dir, "out", "edit.mp4")), false);
  const video = await videoRoute.GET(new Request(`${url}/${id}/video`), ctx({ id }));
  assert.equal((await video.arrayBuffer()).byteLength, 500);

  // Going back to it renders it again from its record.
  const show = await versionRoute.POST(
    new Request(`${url}/${id}/versions/1`, { method: "POST" }),
    ctx({ id, n: "1" }),
  );
  assert.equal(show.status, 200);
  job = await until((each) => each.render === undefined);
  assert.equal(job.current, 1);
  assert.ok(existsSync(join(dir, "out", "edit.mp4")));
  // One already kept shows at once.
  await versionRoute.POST(
    new Request(`${url}/${id}/versions/3`, { method: "POST" }),
    ctx({ id, n: "3" }),
  );
  assert.equal((await read()).current, 3);

  // A render that fails says why and leaves no version behind.
  process.env.FAKE_RENDER_FAIL = "1";
  assert.equal((await apply("bold")).status, 200);
  job = await until((each) => each.render?.error !== undefined);
  delete process.env.FAKE_RENDER_FAIL;
  assert.match(job.render?.error ?? "", /caption font/);
  assert.equal(job.versions?.length, 4);
  assert.equal(job.current, 3);
  assert.equal(existsSync(join(dir, "out", "edit-v5.project.json")), false);

  const bad = await versionsRoute.POST(
    new Request(`${url}/${id}/versions`, {
      method: "POST",
      body: JSON.stringify({ revision: { cuts: [[1]] } }),
    }),
    ctx({ id }),
  );
  assert.equal(bad.status, 400);

  // Without its footage, a project cannot change, and is left as it was.
  await rm(join(dir, "footage"), { recursive: true });
  const refused = await apply("bold");
  assert.equal(refused.status, 409);
  assert.match(((await refused.json()) as { error: string }).error, /footage was deleted/);
  assert.equal((await read()).versions?.length, 4);
  // Showing version 3 again took version 1's video: it cannot render again, a kept one shows.
  const gone = await versionRoute.POST(
    new Request(`${url}/${id}/versions/1`, { method: "POST" }),
    ctx({ id, n: "1" }),
  );
  assert.equal(gone.status, 409);
  const back = await versionRoute.POST(
    new Request(`${url}/${id}/versions/2`, { method: "POST" }),
    ctx({ id, n: "2" }),
  );
  assert.equal(back.status, 200, "a kept video needs no footage");
});

test("a re-plan makes a new version from the same footage, at another length, aspect or music", async () => {
  delete process.env.FAKE_RENDER_FAIL;
  const { body: created } = await create([
    { path: "d.mp4", size: 2 },
    { path: "music/one.mp3", size: 2 },
    { path: "music/two.mp3", size: 2 },
  ]);
  const id = created.id;
  for (const index of [0, 1, 2]) {
    assert.equal((await put(id, index, new Uint8Array(2))).status, 200);
  }
  assert.equal((await start(id)).status, 200);
  const read = async () =>
    (await (await jobRoute.GET(new Request(url), ctx({ id }))).json()) as Job;
  const until = async (done: (job: Job) => boolean) => {
    for (;;) {
      const job = await read();
      if (done(job)) return job;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  await until((job) => job.status === "done");
  const replan = (choice: object) =>
    replanRoute.POST(
      new Request(`${url}/${id}/replan`, { method: "POST", body: JSON.stringify(choice) }),
      ctx({ id }),
    );

  assert.equal((await replan({ length: 5, aspect: "1:1", music: "auto" })).status, 400);
  assert.equal((await replan({ length: 30, aspect: "4:3", music: "auto" })).status, 400);
  assert.equal((await replan({ length: 30.5, aspect: "1:1", music: "auto" })).status, 400);
  const other = await replan({ length: 30, aspect: "1:1", music: "music/three.mp3" });
  assert.equal(other.status, 400, "only a track the edit was offered");

  const response = await replan({
    length: 30,
    aspect: "1:1",
    music: "music/two.mp3",
    // A leading "-" must not read as one of the command's own options.
    instructions: " -Open with the demo. ",
  });
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as Job).render?.version, 2);
  const job = await until((each) => each.render === undefined);
  assert.equal(job.current, 2);
  const version = job.versions?.[1];
  assert.equal(version?.aspect, "1:1");
  assert.equal(version?.length, 30);
  assert.match(version?.summary ?? "", /30 s, 1:1, two\.mp3, with instructions/);
  assert.deepEqual(version?.claude, {
    plan: { dollars: 0.07, requests: 1 },
    check: { dollars: 0.012, requests: 9 },
  });
  const args = JSON.parse(await readFile(join(root, id, "args.json"), "utf8")) as string[];
  assert.deepEqual(args.slice(args.indexOf("--length"), args.indexOf("--length") + 4), [
    "--length",
    "30",
    "--aspect",
    "1:1",
  ]);
  assert.equal(args[args.indexOf("-o") + 1], join("out", "edit-v2.mp4"));
  assert.deepEqual(
    args.filter((_, i) => args[i - 1] === "--music"),
    [join("footage", "music", "two.mp3")],
  );
  assert.ok(args.includes("--instructions=-Open with the demo."));
  assert.equal(version?.look, "clean");
  assert.equal(version?.captions, "bold");
  // The look and caption style of the version shown, not the settings' warm look.
  assert.equal(args[args.indexOf("--look") + 1], "clean");
  assert.equal(args[args.indexOf("--captions") + 1], "bold");
  // The page plays the track the new version chose.
  assert.deepEqual(job.result?.music, ["music/two.mp3"]);
  // Its download is named by its own length and aspect.
  const video = await videoRoute.GET(new Request(`${url}/${id}/video?download`), ctx({ id }));
  assert.match(video.headers.get("content-disposition") ?? "", /edit-30s-1x1\.mp4/);
});

test("several shorts: each made in its own folder, opened and changed on its own, all in one zip", async () => {
  delete process.env.FAKE_RENDER_FAIL;
  const shorts = { count: 3, min: 30, max: 60 };
  const { body: created } = await create(
    [
      { path: "long.mp4", size: 2 },
      { path: "second.mp4", size: 2 },
    ],
    { settings: { ...settings, shorts } },
  );
  const id = created.id;
  assert.equal(created.settings.length, 60, "the length is the range's longest");
  for (const index of [0, 1]) assert.equal((await put(id, index, new Uint8Array(2))).status, 200);
  assert.equal((await start(id)).status, 200);
  const read = async () =>
    (await (await jobRoute.GET(new Request(url), ctx({ id }))).json()) as Job;
  const until = async (done: (job: Job) => boolean) => {
    for (;;) {
      const job = await read();
      if (done(job)) return job;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const job = await until((each) => each.status === "done");
  const args = JSON.parse(await readFile(join(root, id, "args.json"), "utf8")) as string[];
  const after = (option: string) => args[args.indexOf(option) + 1];
  assert.equal(after("--length"), "30-60");
  assert.equal(after("--shorts"), "3");
  assert.equal(after("-o"), "out");

  // Two of three, in Claude's order, each with what it cost; the run with finding them too.
  assert.deepEqual(
    job.shorts?.map((short) => [short.folder, short.title, short.seconds, short.source]),
    [
      ["01", "剪輯的一天：從 0 到 1?", 44.5, join("footage", "long.mp4")],
      ["02", "Why we cut. ", 29.5, join("footage", "long.mp4")],
    ],
  );
  assert.deepEqual(job.shorts?.[0]?.claude?.plan, { dollars: 0.07, requests: 1 });
  assert.deepEqual(job.claude?.find, { dollars: 0.1, requests: 1 });
  assert.equal(job.shorts?.[0]?.result?.captions, true);
  const listed = (await (await jobsRoute.GET()).json()) as ProjectSummary[];
  assert.equal(listed.find((project) => project.id === id)?.shorts, 2);

  // A short plays and downloads by its place and title, safe as a file name everywhere.
  const short = (path: string, folder = "01") => `${url}/${id}/${path}?short=${folder}`;
  const video = await videoRoute.GET(new Request(`${short("video")}&download`), ctx({ id }));
  assert.equal(video.status, 200);
  assert.equal((await video.arrayBuffer()).byteLength, 1000);
  assert.match(
    video.headers.get("content-disposition") ?? "",
    new RegExp(`filename\\*=UTF-8''${encodeURIComponent("01-剪輯的一天：從 0 到 1.mp4")}`),
  );
  const missing = await videoRoute.GET(new Request(short("video", "07")), ctx({ id }));
  assert.equal(missing.status, 404);

  // Each short changes on its own, as versions of its own.
  const view = (await (
    await editRoute.GET(new Request(short("edit", "02")), ctx({ id }))
  ).json()) as EditView;
  assert.equal(view.version, 1);
  const applied = await versionsRoute.POST(
    new Request(short("versions", "02"), {
      method: "POST",
      body: JSON.stringify({ revision: { captions: "pop" }, summary: "captions pop" }),
    }),
    ctx({ id }),
  );
  assert.equal(applied.status, 200);
  const changed = await until((each) => each.render === undefined);
  assert.deepEqual(
    changed.shorts?.map((each) => [each.current ?? 1, each.versions?.length ?? 1]),
    [
      [1, 1],
      [2, 2],
    ],
  );
  assert.equal(changed.versions, undefined, "the run itself has no versions");
  assert.ok(existsSync(join(root, id, "out", "02", "edit-v2.mp4")));

  // A re-plan of a short cuts from its own file and stretch, 30 s on each side within the file.
  const replanned = await replanRoute.POST(
    new Request(short("replan"), {
      method: "POST",
      body: JSON.stringify({ length: 30, aspect: "9:16", music: "auto" }),
    }),
    ctx({ id }),
  );
  assert.equal(replanned.status, 200);
  const planned = await until((each) => each.render === undefined);
  const again = JSON.parse(await readFile(join(root, id, "args.json"), "utf8")) as string[];
  assert.deepEqual(
    again.slice(0, again.indexOf("--length")),
    [join("footage", "long.mp4")],
    "the short's file alone",
  );
  assert.equal(again[again.indexOf("--within") + 1], "0-91.25");
  // Planned again as a short about its moment, hook first, with no opening title.
  assert.ok(again.includes("--short=剪輯的一天：從 0 到 1?. Description 1."));
  assert.ok(!again.includes("--shorts"));
  assert.equal(again[again.indexOf("-o") + 1], join("out", "01", "edit-v2.mp4"));
  assert.equal(planned.shorts?.[0]?.current, 2);

  // Download all: every short's video and captions by place and title, and their words.
  const zipped = await shortsRoute.GET(new Request(`${url}/${id}/shorts`), ctx({ id }));
  assert.equal(zipped.status, 200);
  assert.match(zipped.headers.get("content-disposition") ?? "", /shorts-30-60s-9x16\.zip/);
  const dir = join(root, "unzipped");
  await mkdir(dir);
  const zip = join(dir, "shorts.zip");
  await writeFile(zip, Buffer.from(await zipped.arrayBuffer()));
  const names = [
    "01-剪輯的一天：從 0 到 1.mp4",
    "01-剪輯的一天：從 0 到 1.srt",
    "02-Why we cut.mp4",
    "02-Why we cut.srt",
    "shorts.txt",
  ];
  // Python's zipfile and the system's unzip both read it, names as written.
  const python = execFileSync(
    "python3",
    [
      "-c",
      "import json, sys, zipfile; z = zipfile.ZipFile(sys.argv[1]); z.testzip(); " +
        "print(json.dumps([[i.filename, i.file_size, i.flag_bits & 0x800] for i in z.infolist()]))",
      zip,
    ],
    { encoding: "utf8" },
  );
  const entries = JSON.parse(python) as [string, number, number][];
  assert.deepEqual(
    entries.map(([name]) => name),
    names,
  );
  assert.ok(entries.every(([, , utf8]) => utf8 === 0x800));
  assert.equal(entries[2]?.[1], 500, "the version shown, which the change rendered");
  execFileSync("unzip", ["-q", zip, "-d", dir]);
  assert.equal(
    await readFile(join(dir, "shorts.txt"), "utf8"),
    "01. 剪輯的一天：從 0 到 1?\nDescription 1.\n#one #two #three\n\n" +
      "02. Why we cut. \nDescription 2.\n#one #two #three\n",
  );
  assert.equal((await readFile(join(dir, "02-Why we cut.mp4"))).length, 500);
});

test("a project from before several shorts opens as it was", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  await mkdir(join(root, id), { recursive: true });
  const old = {
    id,
    created: 1,
    settings: { ...settings, style: "clean", visuals: "rich" },
    files: [{ path: "a.mp4", size: 2, use: "video", received: 2 }],
    status: "error",
    stages: {},
    error: "Stopped",
  };
  await writeFile(join(root, id, "job.json"), JSON.stringify(old));
  const { Jobs } = await import("../../../lib/jobs.ts");
  const store = new Jobs({ root, command: [], renderCommand: [], key: async () => undefined });
  assert.deepEqual(await store.get(id), old);
  const summary = (await store.list()).find((project) => project.id === id);
  assert.equal(summary?.shorts, undefined);
});

test("a run of shorts keeps each as it is done; cancelled, they stay listed and downloadable", async () => {
  const held = join(root, "shorts-hold");
  await writeFile(held, "");
  process.env.FAKE_SHORTS_HOLD = held;
  const shorts = { count: 3, min: 30, max: 60 };
  const { body: created } = await create([{ path: "cancel.mp4", size: 2 }], {
    settings: { ...settings, shorts },
  });
  const id = created.id;
  assert.equal((await put(id, 0, new Uint8Array(2))).status, 200);
  assert.equal((await start(id)).status, 200);
  const read = async () =>
    (await (await jobRoute.GET(new Request(url), ctx({ id }))).json()) as Job;
  for (;;) {
    if ((await read()).shorts?.length === 1) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  // Saved as soon as it is done: a server that stops now still lists it.
  await new Promise((resolve) => setTimeout(resolve, 100));
  const saved = JSON.parse(await readFile(join(root, id, "job.json"), "utf8")) as Job;
  assert.deepEqual(
    saved.shorts?.map((short) => short.folder),
    ["01"],
  );

  const cancelled = await jobRoute.DELETE(
    new Request(`${url}/${id}`, { method: "DELETE" }),
    ctx({ id }),
  );
  assert.equal(((await cancelled.json()) as Job).status, "cancelled");
  delete process.env.FAKE_SHORTS_HOLD;
  await rm(held);
  const job = await read();
  assert.deepEqual(
    job.shorts?.map((short) => short.folder),
    ["01"],
  );
  // Downloadable one by one and all together; never changed, as the footage is gone.
  const short = (path: string) => `${url}/${id}/${path}?short=01`;
  assert.equal((await videoRoute.GET(new Request(short("video")), ctx({ id }))).status, 200);
  const zipped = await shortsRoute.GET(new Request(`${url}/${id}/shorts`), ctx({ id }));
  assert.equal(zipped.status, 200);
  assert.ok((await zipped.arrayBuffer()).byteLength > 1000);
  assert.equal((await editRoute.GET(new Request(short("edit")), ctx({ id }))).status, 409);
  const replanned = await replanRoute.POST(
    new Request(short("replan"), {
      method: "POST",
      body: JSON.stringify({ length: 30, aspect: "9:16", music: "auto" }),
    }),
    ctx({ id }),
  );
  assert.equal(replanned.status, 409);
});

test("a run of shorts stopped at its cost limit ends done with the shorts made, saying so", async () => {
  process.env.FAKE_SHORTS_STOP = "1";
  try {
    const shorts = { count: 3, min: 30, max: 60 };
    const { body: created } = await create([{ path: "costly.mp4", size: 2 }], {
      settings: { ...settings, shorts },
    });
    const id = created.id;
    assert.equal((await put(id, 0, new Uint8Array(2))).status, 200);
    assert.equal((await start(id)).status, 200);
    let job: Job;
    for (;;) {
      job = (await (await jobRoute.GET(new Request(url), ctx({ id }))).json()) as Job;
      if (job.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(job.status, "done");
    assert.equal(job.stopped, "cost");
    assert.equal(job.shorts?.length, 1);
  } finally {
    delete process.env.FAKE_SHORTS_STOP;
  }
});

test("a link: read when pasted, refused saying why, fetched into the footage as the edit starts", async (t) => {
  const video = Buffer.alloc(30_000, 5);
  const server = createServer((_, response) => response.end(video));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const read = (link: string, language = "en") =>
    linksRoute.POST(
      new Request("http://127.0.0.1/api/links", {
        method: "POST",
        headers: { "accept-language": language },
        body: JSON.stringify({ url: link }),
      }),
    );

  const link = `${base}/v?title=Street%20photos%3A%20Taipei`;
  const listed = await read(link);
  assert.equal(listed.status, 200);
  assert.deepEqual(await listed.json(), {
    url: link,
    id: "v1",
    title: "Street photos: Taipei",
    seconds: 37,
    site: "Generic",
  });
  for (const [path, pattern] of [
    ["/channel/playlist", /playlist or a channel: paste the link of one video/],
    ["/private", /private: only public videos/],
    ["/live", /live video/],
  ] as const) {
    const refused = await read(`${base}${path}`);
    assert.equal(refused.status, 400, path);
    assert.match(((await refused.json()) as { error: string }).error, pattern);
  }
  const zh = await read(`${base}/private`, "zh-TW");
  assert.match(((await zh.json()) as { error: string }).error, /不公開/);
  const notLink = await read("file:///etc/passwd");
  assert.equal(notLink.status, 400);

  const { response, body: job } = await create([{ path: "a.mp4", size: 4 }], {
    settings,
    links: [link],
  });
  assert.equal(response.status, 201);
  assert.equal((await put(job.id, 0, new Uint8Array(4))).status, 200);
  // The link's video is fetched by the server, not sent: there is no such file to send.
  assert.equal((await put(job.id, 1, new Uint8Array(4))).status, 404);
  assert.equal((await start(job.id)).status, 200);
  let done = job;
  while (done.status === "running" || done.status === "uploading") {
    await new Promise((resolve) => setTimeout(resolve, 20));
    done = (await (
      await jobRoute.GET(new Request(`${url}/${job.id}`), ctx({ id: job.id }))
    ).json()) as Job;
  }
  assert.equal(done.status, "done", done.error);
  const fetched = done.files[1];
  assert.deepEqual(fetched, {
    path: "Street photos Taipei.mp4",
    size: video.length,
    use: "video",
    received: video.length,
    url: link,
    title: "Street photos: Taipei",
  });
  assert.deepEqual(
    await readFile(join(root, job.id, "footage", "Street photos Taipei.mp4")),
    video,
  );
  const args = JSON.parse(await readFile(join(root, job.id, "args.json"), "utf8")) as string[];
  assert.deepEqual(args.slice(0, 2), [
    join("footage", "a.mp4"),
    join("footage", "Street photos Taipei.mp4"),
  ]);
  // The project is named after the video.
  const projects = (await (await jobsRoute.GET()).json()) as ProjectSummary[];
  assert.equal(projects.find((project) => project.id === job.id)?.name, "Street photos: Taipei");
});
