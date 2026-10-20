// Stands in for yt-dlp in tests. With -J it describes the link's video, or fails as yt-dlp does
// for a private one, or describes a playlist or a live stream, as the link's words say; a link
// with `huge` in it says the video is a petabyte. Otherwise it fetches the link from the local
// test server, as two streams one after the other with progress lines in the template it was
// given, and writes the video where -P and -o say. A link with `slow` in it waits between chunks
// and meanwhile runs a program of its own that keeps writing a part file, as FFmpeg does while it
// joins the streams, whether or not its folder is still there, for a test to stop them. Each
// call's arguments are appended to $FAKE_YT_DLP_LOG, and the ids of its process and the one it
// runs to $FAKE_YT_DLP_PIDS.
import { spawn } from "node:child_process";
import { appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const args = process.argv.slice(2);
if (process.env.FAKE_YT_DLP_LOG) {
  await appendFile(process.env.FAKE_YT_DLP_LOG, `${JSON.stringify(args)}\n`);
}
const url = args[args.indexOf("--") + 1] ?? "";
const option = (name: string) => args[args.indexOf(name) + 1] ?? "";
const title = new URL(url).searchParams.get("title") ?? "A talk";

if (url.includes("private")) {
  process.stderr.write(
    "ERROR: [youtube] priv1: Private video. Sign in if you've been granted access to this video\n",
  );
  process.exit(1);
}
if (args.includes("-J")) {
  const video = url.includes("playlist")
    ? { _type: "playlist", id: "PL1", title: "A list" }
    : { id: "v1", title, duration: 37, extractor_key: "Generic" };
  const live = url.includes("live") ? { live_status: "is_live" } : {};
  const size = url.includes("huge") ? { filesize_approx: 1e15 } : {};
  process.stdout.write(`${JSON.stringify({ ...video, ...live, ...size })}\n`);
  process.exit(0);
}

if (url.includes("slow")) {
  const part = join(option("-P"), "video.part");
  const writer = spawn(
    process.execPath,
    [
      "-e",
      `setInterval(() => { try { require("fs").appendFileSync(${JSON.stringify(part)}, "x"); } catch {} }, 10)`,
    ],
    { stdio: "ignore" },
  );
  if (process.env.FAKE_YT_DLP_PIDS) {
    await writeFile(process.env.FAKE_YT_DLP_PIDS, `${process.pid}\n${writer.pid}\n`);
  }
}
const body = Buffer.from(await (await fetch(url)).arrayBuffer());
process.stdout.write(`S ${body.length}\n`);
const half = Math.floor(body.length / 2);
for (const [format, part] of [
  ["137", body.subarray(0, half)],
  ["140", body.subarray(half)],
] as const) {
  for (let bytes = 0; bytes < part.length; ) {
    bytes = Math.min(part.length, bytes + 1000);
    process.stdout.write(`P ${bytes} ${part.length} NA ${format}\n`);
    if (url.includes("slow")) await sleep(50);
  }
}
const name = option("-o")
  .replace("%(title).150B", title)
  .replace("%(id)s", "v1")
  .replace("%(ext)s", "mp4");
const path = join(option("-P"), name);
await writeFile(path, body);
process.stdout.write(`F ${path}\n`);
