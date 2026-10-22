import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  accountStatus,
  editBlocker,
  entitledBy,
  OFFLINE_GRACE,
  type Subscription,
  type Supabase,
  signOut,
  startSignIn,
} from "./account.ts";

const NOW = Date.parse("2026-10-22T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

test("a subscription entitles while active, on trial, past due, or cancelled until its period ends", () => {
  const row = (status: string, end: number | null = null): Subscription => ({
    status,
    current_period_end: end === null ? null : new Date(end).toISOString(),
  });
  for (const status of ["active", "trialing", "past_due"]) {
    assert.equal(entitledBy([row(status)], NOW), true, status);
  }
  assert.equal(entitledBy([row("canceled", NOW + DAY)], NOW), true);
  assert.equal(entitledBy([row("canceled", NOW - 1)], NOW), false);
  assert.equal(entitledBy([row("canceled")], NOW), false);
  assert.equal(entitledBy([row("paused", NOW + DAY)], NOW), false);
  assert.equal(entitledBy([], NOW), false);
  assert.equal(entitledBy([row("canceled", NOW - DAY), row("active")], NOW), true);
});

/** A stand-in for Supabase: its PKCE exchange, its refresh and the subscriptions table, with
 * `rows` for every user. */
let supabase: Server;
let address: Supabase;
let rows: Subscription[] = [];
let challenge = "";
let refreshes = 0;
const token = (n: number) => ({
  access_token: `access-${n}`,
  refresh_token: `refresh-${n}`,
  expires_in: 3600,
  user: { id: "user-1", email: "someone@example.com" },
});
before(async () => {
  supabase = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const json = (status: number, value: unknown) =>
        response
          .writeHead(status, { "Content-Type": "application/json" })
          .end(JSON.stringify(value));
      if (request.headers.apikey !== "anon") return json(401, {});
      const given = body ? JSON.parse(body) : {};
      if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "pkce") {
        const hashed = createHash("sha256").update(given.code_verifier).digest("base64url");
        return given.auth_code === "the-code" && hashed === challenge
          ? json(200, token(1))
          : json(400, { error: "invalid_grant" });
      }
      if (url.pathname === "/auth/v1/token") {
        refreshes++;
        return given.refresh_token === "refresh-1"
          ? json(200, token(2))
          : json(400, { error: "invalid_grant" });
      }
      if (url.pathname === "/rest/v1/subscriptions") {
        const auth = request.headers.authorization;
        if (auth !== "Bearer access-1" && auth !== "Bearer access-2") return json(401, {});
        assert.equal(url.searchParams.get("user_id"), "eq.user-1");
        return json(200, rows);
      }
      json(404, {});
    });
  });
  await new Promise<void>((resolve) => supabase.listen(0, "127.0.0.1", resolve));
  const port = (supabase.address() as { port: number }).port;
  address = { url: `http://127.0.0.1:${port}`, anonKey: "anon" };
});
after(() => supabase.close());

const landing = { done: "Signed in", failed: "Not signed in" };

/** A sign-in through the stand-in, with the browser's return played by a request. */
async function signIn(file: string): Promise<void> {
  const started = await startSignIn(file, address, "zh-TW", landing);
  const opened = new URL(started.url);
  assert.equal(opened.origin + opened.pathname, "https://fineframe.app/zh-tw/app-sign-in/");
  assert.equal(opened.searchParams.get("code_challenge_method"), "s256");
  challenge = opened.searchParams.get("code_challenge") ?? "";
  const back = new URL(opened.searchParams.get("redirect_to") ?? "");
  assert.equal(back.hostname, "127.0.0.1");
  const page = await fetch(`${back}?code=the-code`);
  assert.equal(await page.text().then((text) => text.includes(landing.done)), true);
  await started.done;
}

test("signing in through the browser saves the session for its owner alone, and signing out deletes it", async () => {
  const folder = await mkdtemp(join(tmpdir(), "account-"));
  const file = join(folder, "account.json");
  try {
    await signIn(file);
    if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
    rows = [{ status: "active", current_period_end: null }];
    assert.deepEqual(await accountStatus(file, address), {
      signedIn: true,
      email: "someone@example.com",
      entitled: true,
      offline: false,
    });
    rows = [];
    assert.equal(
      await editBlocker(file, folder, {
        FINEFRAME_SUPABASE_URL: address.url,
        FINEFRAME_SUPABASE_ANON_KEY: "anon",
      }),
      "subscribe",
    );
    assert.equal(await editBlocker(file, folder, { FINEFRAME_DEV_ENTITLED: "1" }), null);
    assert.equal(await editBlocker(undefined, folder, {}), null);
    await signOut(file, address);
    assert.deepEqual(await accountStatus(file, address), { signedIn: false });
    assert.equal(await editBlocker(file, folder, {}), "sign-in");
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("a code the app's verifier does not match signs nobody in", async () => {
  const folder = await mkdtemp(join(tmpdir(), "account-"));
  const file = join(folder, "account.json");
  try {
    const started = await startSignIn(file, address, "en", landing);
    challenge = "another app's challenge";
    const back = new URL(started.url).searchParams.get("redirect_to");
    const page = await fetch(`${back}?code=the-code`);
    assert.equal(page.status, 400);
    await assert.rejects(started.done);
    assert.deepEqual(await accountStatus(file, address), { signedIn: false });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("offline, the last check holds for 7 days; an expired session is refreshed, a revoked one signs out", async () => {
  const folder = await mkdtemp(join(tmpdir(), "account-"));
  const file = join(folder, "account.json");
  try {
    await signIn(file);
    rows = [{ status: "active", current_period_end: null }];
    const checked = Date.now();
    assert.equal((await accountStatus(file, address, checked)).signedIn, true);
    const unreachable: Supabase = { url: "http://127.0.0.1:9", anonKey: "anon" };
    const at = (offset: number) => accountStatus(file, unreachable, checked + offset);
    assert.deepEqual(await at(OFFLINE_GRACE - DAY), {
      signedIn: true,
      email: "someone@example.com",
      entitled: true,
      offline: true,
    });
    assert.deepEqual(await at(OFFLINE_GRACE + 1), {
      signedIn: true,
      email: "someone@example.com",
      entitled: false,
      offline: true,
    });
    // An hour on, the access token has expired: it is refreshed and the new one saved.
    const before = refreshes;
    assert.equal((await accountStatus(file, address, checked + 2 * 60 * 60 * 1000)).signedIn, true);
    assert.equal(refreshes, before + 1);
    const saved = JSON.parse(await readFile(file, "utf8"));
    assert.equal(saved.session.refreshToken, "refresh-2");
    // refresh-2 is not one the stand-in takes, as a revoked session's is not.
    assert.deepEqual(await accountStatus(file, address, checked + 4 * 60 * 60 * 1000), {
      signedIn: false,
    });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
