// The desktop app's server against a stand-in for Next.js that answers like the page and starts
// a process of its own, as an edit or the analysis's setup would.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { type Places, serverEnvironment, startServer } from "./server.ts";

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function fakeEditor(dir: string): Promise<Places> {
  const editor = join(dir, "editor");
  const web = join(editor, "apps", "web");
  const next = join(editor, "node_modules", "next");
  await mkdir(web, { recursive: true });
  await mkdir(join(next, "dist", "bin"), { recursive: true });
  await writeFile(join(web, "package.json"), '{ "name": "web" }');
  await writeFile(join(next, "package.json"), '{ "name": "next", "version": "0.0.0" }');
  // `next start --hostname <host> --port <port>`: records where it runs and what it was given,
  // and starts a child that would outlive it if only it were stopped.
  await writeFile(
    join(next, "dist", "bin", "next"),
    `const { createServer } = require("node:http");
const { spawn } = require("node:child_process");
const { writeFileSync } = require("node:fs");
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
writeFileSync(${JSON.stringify(join(dir, "started.json"))}, JSON.stringify({
  args: process.argv.slice(2), cwd: process.cwd(), child: child.pid,
  keys: process.env.VIDEO_EDITOR_ENV_FILE, setup: process.env.VIDEO_EDITOR_SETUP,
}));
console.log("listening");
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ set: false, openrouter: false }));
}).listen(port, "127.0.0.1");
`,
  );
  return {
    editor,
    bin: join(dir, "bin"),
    data: join(dir, "data"),
    log: join(dir, "logs", "server.log"),
  };
}

test("the server runs from the app's folders and keeps keys and Python out of any repository", () => {
  const places = { editor: "/app/editor", bin: "/app/bin", data: "/home/a/App", log: "/x" };
  const env = serverEnvironment(places, 4321, { PATH: "/usr/bin", HOME: "/home/a" });
  assert.equal(env.PATH, `/app/bin${delimiter}/usr/bin`);
  assert.equal(env.PORT, "4321");
  assert.equal(env.VIDEO_EDITOR_HOST, "127.0.0.1");
  assert.equal(env.VIDEO_EDITOR_ENV_FILE, join("/home/a/App", "keys.env"));
  assert.equal(env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(env.UV_PROJECT_ENVIRONMENT, join("/home/a/App", "python", "env"));
  assert.equal(env.UV_PYTHON_PREFERENCE, "only-managed");
  assert.equal(env.HOME, "/home/a");
  // From a clone, uv is the one on PATH.
  assert.equal(
    serverEnvironment({ ...places, bin: null }, 1, { PATH: "/usr/bin" }).PATH,
    "/usr/bin",
  );
});

test("the server starts on a free loopback port, and stopping it stops what it started", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "desktop-server-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const places = await fakeEditor(dir);
  const server = await startServer(places, process.execPath);
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  const started = JSON.parse(await readFile(join(dir, "started.json"), "utf8"));
  assert.deepEqual(started.args.slice(0, 3), ["start", "--hostname", "127.0.0.1"]);
  assert.equal(started.args[4], server.url.split(":").at(-1));
  assert.equal(started.cwd, join(places.editor, "apps", "web"));
  assert.equal(started.keys, join(places.data, "keys.env"));
  assert.equal(started.setup, "1");
  // The app's folder is its owner's alone.
  assert.equal((await stat(places.data)).mode & 0o777, 0o700);
  assert.ok(alive(started.child));

  await server.stop();
  assert.ok(!alive(server.child.pid as number));
  assert.ok(!alive(started.child), "the server's own child stops with it");
  assert.match(await readFile(places.log, "utf8"), /listening/);
});
