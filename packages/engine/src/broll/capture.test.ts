import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Browser } from "playwright-core";
import { ffmpeg, run } from "../ffmpeg.ts";
import { scratch } from "../testing.ts";
import { capturePage, checkedUrl, openCaptureBrowser } from "./capture.ts";

// A product page with a consent banner over it: the banner's Accept tells the server if pressed.
const PAGE = `<!doctype html>
<html style="height:100%"><body style="height:100%;margin:0;font:32px sans-serif;background:#fff">
  <h1 style="margin:40px">Example tool</h1>
  <p style="margin:40px">Plans start at <span id="price" style="background:#0a0">$9 a month</span></p>
  <div style="height:300px"></div>
  <div style="height:3000px;background:#00f"></div>
  <div id="cookie-banner" style="position:fixed;bottom:0;left:0;right:0;height:200px;background:#f00">
    We use cookies <button onclick="fetch('/accepted')">Accept</button>
  </div>
  <script>document.body.style.overflow = "hidden"</script>
</body></html>`;

// Chrome downloads on the first run, as for the effects: run it locally.
const local = { skip: process.env.CI ? "downloads Chrome: run it locally" : false };

let browser: Browser;
let base = "";
let accepted = false;
let port = 0;
/** What reached the server under the name localhost, which the captures never allow. */
const reached: string[] = [];
const server = createServer((request, response) => {
  if (request.url === "/accepted") accepted = true;
  if (request.headers.host?.startsWith("localhost")) reached.push(request.url ?? "");
  const local = `localhost:${port}`;
  if (request.url === "/hostile") {
    // A page that reaches for this computer, as a hostile one might: directly, through a
    // redirect and over a WebSocket.
    response.setHeader("content-type", "text/html");
    response.end(`<p>Hostile</p><img src="http://${local}/image"><img src="/hop">
      <script>new WebSocket("ws://${local}/socket")</script>`);
    return;
  }
  if (request.url === "/moved") {
    response.writeHead(302, { location: "/" }).end();
    return;
  }
  if (request.url === "/hop") {
    response.writeHead(302, { location: `http://${local}/redirected` }).end();
    return;
  }
  response.setHeader("content-type", "text/html");
  response.end(PAGE);
});
server.on("upgrade", (request, socket) => {
  reached.push(request.url ?? "");
  socket.destroy();
});

before(async () => {
  if (process.env.CI) return;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}/`;
  browser = await openCaptureBrowser();
});

after(async () => {
  await browser?.close();
  server.close();
});

/** The PNG's pixels as RGB, decoded by FFmpeg. */
async function pixels(path: string): Promise<Buffer> {
  const bin = await ffmpeg();
  const raw = `${path}.rgb`;
  await run(bin, ["-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-y", raw]);
  return readFile(raw);
}

test(
  "crops a still at 2x to the text named, with the banner hidden, not accepted",
  local,
  async (t) => {
    const dir = await scratch(t, "capture-");
    const out = join(dir, "price.png");
    const shot = await capturePage({
      url: base,
      out,
      text: "$9 a month",
      browser,
      allowHosts: ["127.0.0.1"],
    });
    assert.equal(shot.kind, "still");
    assert.ok(shot.focus);
    // The crop keeps 24 CSS pixels around the text on every side, at 2x, give or take the
    // rounding of the text's box to whole pixels.
    const { x, y, width } = shot.focus;
    assert.ok(Math.abs(x - 48) <= 2 && Math.abs(y - 48) <= 2, `${x}, ${y}`);
    assert.ok(Math.abs(shot.width - width - 96) <= 4, `${shot.width} for ${width}`);
    const rgb = await pixels(out);
    assert.equal(rgb.length, shot.width * shot.height * 3);
    let green = 0;
    let red = 0;
    for (let i = 0; i < rgb.length; i += 3) {
      const [r = 0, g = 0, b = 0] = rgb.subarray(i, i + 3);
      if (g > 150 && r < 60 && b < 60) green++;
      if (r > 200 && g < 60 && b < 60) red++;
    }
    assert.ok(green > 0.2 * (shot.focus.width * shot.focus.height), "the highlighted price shows");
    assert.equal(red, 0, "the banner is hidden");
    assert.equal(accepted, false);
  },
);

test("a scroll is a smooth clip down the page, the banner hidden", local, async (t) => {
  const dir = await scratch(t, "capture-");
  const out = join(dir, "scroll.mp4");
  const clip = await capturePage({
    url: base,
    out,
    scroll: 2,
    viewport: { width: 640, height: 360 },
    browser,
    allowHosts: ["127.0.0.1"],
  });
  assert.deepEqual([clip.kind, clip.width, clip.height], ["clip", 1280, 720]);
  const { stderr } = await run(await ffmpeg(), ["-i", out, "-map", "0:v", "-f", "null", "-"]);
  assert.match(stderr, /frame=\s*60\b/);
  // It starts at the white top and ends further down the page, where it is blue, even though
  // the banner had locked scrolling.
  const raw = join(dir, "ends.rgb");
  const ends = "select='eq(n\\,0)+eq(n\\,59)',scale=16:9";
  await run(
    await ffmpeg(),
    ["-v", "error", "-i", out, "-vf", ends, "-fps_mode", "passthrough"].concat([
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      raw,
    ]),
  );
  const rgb = await readFile(raw);
  const blue = (frame: Buffer) => {
    let sum = 0;
    for (let i = 0; i < frame.length; i += 3) sum += (frame[i + 2] ?? 0) - (frame[i] ?? 0);
    return sum / (frame.length / 3);
  };
  const size = 16 * 9 * 3;
  assert.equal(rgb.length, 2 * size);
  assert.ok(blue(rgb.subarray(0, size)) < 10);
  assert.ok(blue(rgb.subarray(size)) > 60, String(blue(rgb.subarray(size))));
});

test(
  "a page cannot make the capture reach a local address, through a redirect or a socket",
  local,
  async (t) => {
    const dir = await scratch(t, "capture-");
    // 127.0.0.1 stands for a public site here; localhost is the computer the capture runs on.
    const allowHosts = ["127.0.0.1"];
    await capturePage({ url: `${base}hostile`, out: join(dir, "a.png"), browser, allowHosts });
    const hop = capturePage({ url: `${base}hop`, out: join(dir, "b.png"), browser, allowHosts });
    const refused = await hop.then(
      () => false,
      () => true,
    );
    assert.deepEqual(reached, []);
    assert.ok(refused, "the redirect to localhost is refused");
    // A redirect to a public page is followed.
    const moved = await capturePage({
      url: `${base}moved`,
      out: join(dir, "c.png"),
      text: "$9 a month",
      browser,
      allowHosts,
    });
    assert.ok(moved.focus);
  },
);

test("only public http and https pages are opened", () => {
  assert.equal(checkedUrl("https://example.com/pricing").host, "example.com");
  for (const url of [
    "file:///etc/passwd",
    "http://localhost:3000/",
    "http://127.0.0.1/",
    "http://192.168.1.1/",
    "http://10.0.0.8/",
    "http://169.254.169.254/latest/meta-data/",
    "http://[::1]/",
    "http://localhost./",
    "http://224.0.0.1/",
    "http://[64:ff9b::7f00:1]/",
    "https://user:secret@example.com/",
    "not a url",
  ]) {
    assert.throws(() => checkedUrl(url), Error, url);
  }
  assert.equal(checkedUrl("http://127.0.0.1:8080/", ["127.0.0.1"]).port, "8080");
});
