// The keys the page saves, against stand-ins for Anthropic's and OpenRouter's APIs on this
// machine, and for Pexels' and Pixabay's in place of fetch.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import { promisify } from "node:util";

const dir = await mkdtemp(join(tmpdir(), "web-key-"));
const icacls = (...args: string[]) => promisify(execFile)("icacls", args);
// A folder every user of the machine may read, as a clone outside the user's own folder is.
if (process.platform === "win32") await icacls(dir, "/grant", "*S-1-5-32-545:(OI)(CI)R");
const env = join(dir, ".env");
process.env.VIDEO_EDITOR_ENV_FILE = env;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENROUTER_API_KEY;
delete process.env.PEXELS_API_KEY;
delete process.env.PIXABAY_API_KEY;

// Anthropic as far as the check sees it: one model lookup, answered by the key it is sent.
const asked: { path?: string; key?: string }[] = [];
const anthropic = createServer((request, response) => {
  const key = request.headers["x-api-key"] as string | undefined;
  asked.push({ path: request.url, key });
  const reply = (status: number, body: object) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  if (key === "sk-ant-good") reply(200, { type: "model", id: "claude-opus-5-5" });
  else if (key === "sk-ant-no-opus") {
    reply(404, { type: "error", error: { type: "not_found_error", message: "model: claude" } });
  } else {
    reply(401, {
      type: "error",
      error: { type: "authentication_error", message: "invalid x-api-key" },
    });
  }
});
await new Promise<void>((done) => anthropic.listen(0, "127.0.0.1", done));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(anthropic.address() as AddressInfo).port}`;

// OpenRouter as far as the check sees it: the key's own details, for the key it is sent.
const openrouter = createServer((request, response) => {
  asked.push({ path: request.url, key: request.headers.authorization });
  const good = request.headers.authorization === "Bearer sk-or-good";
  response.writeHead(good ? 200 : 401, { "content-type": "application/json" });
  response.end(JSON.stringify(good ? { data: {} } : { error: { message: "User not found." } }));
});
await new Promise<void>((done) => openrouter.listen(0, "127.0.0.1", done));
process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${(openrouter.address() as AddressInfo).port}/api/v1/`;

const { readKey } = await import("./key.ts");
const route = await import("../app/api/key/route.ts");

test.after(async () => {
  anthropic.close();
  openrouter.close();
  await rm(dir, { recursive: true, force: true });
});

const put = (body: unknown, headers: Record<string, string> = {}) =>
  route.PUT(
    new Request("http://127.0.0.1:3000/api/key", {
      method: "PUT",
      headers: { host: "127.0.0.1:3000", ...headers },
      body: JSON.stringify(body),
    }),
  );
const status = async () =>
  (await route.GET()).json() as Promise<{
    set: boolean;
    openrouter: boolean;
    pexels: boolean;
    pixabay: boolean;
  }>;
const none = { set: false, openrouter: false, pexels: false, pixabay: false };

test("with no key, the page is told to ask for one", async () => {
  assert.deepEqual(await status(), none);
  assert.equal(await readKey(), undefined);
});

test("a key Anthropic refuses is not saved, and the page is told what to do", async () => {
  for (const [key, pattern] of [
    ["sk-ant-wrong", /did not accept this key/],
    ["sk-ant-no-opus", /cannot use claude-opus-5-5/],
    ["", /Paste/],
    ["sk-ant two words", /Paste/],
  ] as const) {
    const response = await put({ key });
    assert.equal(response.status, 400, key);
    assert.match(((await response.json()) as { error: string }).error, pattern);
  }
  assert.deepEqual(await status(), none);
});

test("another site cannot set the key through the owner's browser", async () => {
  const response = await put({ key: "sk-ant-good" }, { origin: "https://elsewhere.example" });
  assert.equal(response.status, 403);
  assert.deepEqual(await status(), none);
});

test("a working key is saved for its owner alone, beside what .env holds, and never sent back", async () => {
  await writeFile(env, "# Mine\nOTHER=1\nANTHROPIC_API_KEY=sk-ant-old\n", { mode: 0o644 });
  asked.length = 0;
  const response = await put({ key: "  sk-ant-good\n" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ...none, set: true });
  // Checked with a model lookup, which costs nothing.
  assert.deepEqual(asked, [{ path: "/v1/models/claude-opus-5-5", key: "sk-ant-good" }]);
  assert.equal(await readFile(env, "utf8"), "# Mine\nOTHER=1\nANTHROPIC_API_KEY=sk-ant-good\n");
  if (process.platform === "win32") {
    // Windows ignores the mode. The access list takes nothing from the folder, which lets every
    // user read.
    const { stdout } = await icacls(env);
    assert.doesNotMatch(stdout, /\(I\)|\\Users:/, stdout);
    assert.ok(stdout.toLowerCase().includes(`\\${userInfo().username}:(f)`.toLowerCase()), stdout);
  } else {
    assert.equal((await stat(env)).mode & 0o777, 0o600);
  }
  assert.equal(await readKey(), "sk-ant-good");
  const shown = JSON.stringify(await status());
  assert.equal(shown, '{"set":true,"openrouter":false,"pexels":false,"pixabay":false}');
});

test("an OpenRouter key is checked with OpenRouter and saved beside the Anthropic one", async () => {
  for (const [key, pattern] of [
    ["sk-or-wrong", /OpenRouter did not accept this key/],
    ["sk-ant-good", /starting with sk-or-/],
  ] as const) {
    const response = await put({ key, service: "openrouter" });
    assert.equal(response.status, 400, key);
    assert.match(((await response.json()) as { error: string }).error, pattern);
  }
  asked.length = 0;
  const response = await put({ key: "sk-or-good", service: "openrouter" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ...none, set: true, openrouter: true });
  assert.deepEqual(asked, [{ path: "/api/v1/key", key: "Bearer sk-or-good" }]);
  assert.equal(
    await readFile(env, "utf8"),
    "# Mine\nOTHER=1\nANTHROPIC_API_KEY=sk-ant-good\nOPENROUTER_API_KEY=sk-or-good\n",
  );
  if (process.platform === "win32") {
    const { stdout } = await icacls(env);
    assert.doesNotMatch(stdout, /\(I\)|\\Users:/, stdout);
  } else {
    assert.equal((await stat(env)).mode & 0o777, 0o600);
  }
  assert.equal(await readKey("openrouter"), "sk-or-good");
  assert.equal((await put({ key: "sk-or-good", service: "other" })).status, 400);
});

test("the optional Pexels and Pixabay keys are checked with one free search each and saved", async () => {
  // Pexels takes the key in a header, Pixabay in the address; each answers a key it does not
  // know as it does: 401 and 400.
  const searched: string[] = [];
  const fetched = mock.method(globalThis, "fetch", async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const key =
      url.hostname === "api.pexels.com"
        ? new Headers(init?.headers).get("authorization")
        : url.searchParams.get("key");
    searched.push(`${url.origin}${url.pathname} ${key}`);
    const good = key === "pexels-good" || key === "1-pixabay-good";
    return new Response("{}", { status: good ? 200 : url.hostname === "pixabay.com" ? 400 : 401 });
  });
  try {
    for (const [key, service, pattern] of [
      [
        "pexels-wrong",
        "pexels",
        /Pexels did not accept this key\. Copy it again from pexels\.com\/api/,
      ],
      ["1-pixabay-wrong", "pixabay", /Pixabay did not accept this key/],
      ["two words", "pexels", /Paste the whole key/],
      ["", "pixabay", /Paste the whole key/],
    ] as const) {
      const response = await put({ key, service });
      assert.equal(response.status, 400, key);
      assert.match(((await response.json()) as { error: string }).error, pattern);
    }
    searched.length = 0;
    assert.equal((await put({ key: "pexels-good", service: "pexels" })).status, 200);
    const response = await put({ key: "1-pixabay-good", service: "pixabay" });
    assert.deepEqual(await response.json(), {
      set: true,
      openrouter: true,
      pexels: true,
      pixabay: true,
    });
    assert.deepEqual(searched, [
      "https://api.pexels.com/v1/search pexels-good",
      "https://pixabay.com/api/videos/ 1-pixabay-good",
    ]);
  } finally {
    fetched.mock.restore();
  }
  assert.equal(
    await readFile(env, "utf8"),
    "# Mine\nOTHER=1\nANTHROPIC_API_KEY=sk-ant-good\nOPENROUTER_API_KEY=sk-or-good\n" +
      "PEXELS_API_KEY=pexels-good\nPIXABAY_API_KEY=1-pixabay-good\n",
  );
  assert.equal(await readKey("pexels"), "pexels-good");
  assert.equal(await readKey("pixabay"), "1-pixabay-good");
});

test("the saved key wins over the server's environment, which counts without one", async () => {
  process.env.ANTHROPIC_API_KEY = "sk-ant-from-env";
  assert.equal(await readKey(), "sk-ant-good");
  await rm(env);
  assert.equal(await readKey(), "sk-ant-from-env");
  assert.deepEqual(await status(), { ...none, set: true });
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
});
