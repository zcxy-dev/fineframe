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
});

/** A stand-in for Supabase as the entitlement contract describes it: the OAuth server's token
 * endpoint, the billing switch and the subscriptions table, with `rows` for the user. */
let supabase: Server;
let address: Supabase;
let billing = false;
let rows: Subscription[] = [];
let challenge = "";
let redirect = "";
let refreshes = 0;
/** An access token as Supabase signs one, its claims readable; the signature is not checked. */
const jwt = (n: number) =>
  `e30.${Buffer.from(JSON.stringify({ sub: "user-1", email: "someone@example.com", n })).toString("base64url")}.sig`;
const token = (n: number) => ({
  access_token: jwt(n),
  refresh_token: `refresh-${n}`,
  expires_in: 3600,
  token_type: "bearer",
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
      if (request.headers.apikey !== "publishable") return json(401, {});
      const form = new URLSearchParams(body);
      if (url.pathname === "/auth/v1/oauth/token") {
        if (form.get("client_id") !== "client") return json(401, {});
        if (form.get("grant_type") === "authorization_code") {
          const verifier = form.get("code_verifier") ?? "";
          const hashed = createHash("sha256").update(verifier).digest("base64url");
          const ok =
            form.get("code") === "the-code" &&
            hashed === challenge &&
            form.get("redirect_uri") === redirect;
          return ok ? json(200, token(1)) : json(400, { error: "invalid_grant" });
        }
        refreshes++;
        return form.get("refresh_token") === "refresh-1"
          ? json(200, token(2))
          : json(400, { error: "invalid_grant" });
      }
      const auth = request.headers.authorization;
      if (auth !== `Bearer ${jwt(1)}` && auth !== `Bearer ${jwt(2)}`) return json(401, {});
      if (url.pathname === "/rest/v1/app_config") return json(200, [{ billing_enabled: billing }]);
      if (url.pathname === "/rest/v1/subscriptions") return json(200, rows);
      json(404, {});
    });
  });
  await new Promise<void>((resolve) => supabase.listen(0, "127.0.0.1", resolve));
  const port = (supabase.address() as { port: number }).port;
  address = { url: `http://127.0.0.1:${port}`, publishableKey: "publishable", clientId: "client" };
});
after(() => supabase.close());

const landing = { done: "Signed in", failed: "Not signed in" };
const env = (supabase: Supabase) => ({
  FINEFRAME_SUPABASE_URL: supabase.url,
  FINEFRAME_SUPABASE_PUBLISHABLE_KEY: supabase.publishableKey,
  FINEFRAME_OAUTH_CLIENT_ID: supabase.clientId,
});

/** Starts a sign-in through the stand-in; the browser's return is the caller's to play. */
async function startThroughStandIn(file: string) {
  const started = await startSignIn(file, address, landing);
  const opened = new URL(started.url);
  assert.equal(`${opened.origin}${opened.pathname}`, `${address.url}/auth/v1/oauth/authorize`);
  assert.equal(opened.searchParams.get("response_type"), "code");
  assert.equal(opened.searchParams.get("client_id"), "client");
  assert.equal(opened.searchParams.get("code_challenge_method"), "S256");
  challenge = opened.searchParams.get("code_challenge") ?? "";
  redirect = opened.searchParams.get("redirect_uri") ?? "";
  assert.match(redirect, /^http:\/\/127\.0\.0\.1:4782[123]\/callback$/);
  return { started, state: opened.searchParams.get("state") ?? "" };
}

async function signIn(file: string): Promise<void> {
  const { started, state } = await startThroughStandIn(file);
  // A return that is not this sign-in's own is answered and ignored.
  assert.equal((await fetch(`${redirect}?code=the-code&state=other`)).status, 400);
  const page = await fetch(`${redirect}?code=the-code&state=${state}`);
  assert.equal((await page.text()).includes(landing.done), true);
  await started.done;
}

test("signing in through the browser saves the session for its owner alone, and signing out deletes it", async () => {
  const folder = await mkdtemp(join(tmpdir(), "account-"));
  const file = join(folder, "account.json");
  try {
    await signIn(file);
    if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(await accountStatus(file, address), {
      signedIn: true,
      email: "someone@example.com",
      entitled: true,
      offline: false,
    });
    assert.equal(await editBlocker(file, folder, env(address)), null);
    assert.equal(await editBlocker(file, folder, { FINEFRAME_DEV_ENTITLED: "1" }), null);
    assert.equal(await editBlocker(undefined, folder, {}), null);
    await signOut(file);
    assert.deepEqual(await accountStatus(file, address), { signedIn: false });
    assert.equal(await editBlocker(file, folder, env(address)), "sign-in");
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("with billing on, only a subscription lets the user edit", async () => {
  const folder = await mkdtemp(join(tmpdir(), "account-"));
  const file = join(folder, "account.json");
  try {
    await signIn(file);
    billing = true;
    rows = [];
    assert.equal(await editBlocker(file, folder, env(address)), "subscribe");
    rows = [{ status: "active", current_period_end: null }];
    assert.equal(await editBlocker(file, folder, env(address)), null);
  } finally {
    billing = false;
    rows = [];
    await rm(folder, { recursive: true, force: true });
  }
});

test("a code the app's verifier does not match signs nobody in", async () => {
  const folder = await mkdtemp(join(tmpdir(), "account-"));
  const file = join(folder, "account.json");
  try {
    const { started, state } = await startThroughStandIn(file);
    challenge = "another app's challenge";
    const page = await fetch(`${redirect}?code=the-code&state=${state}`);
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
    const checked = Date.now();
    assert.equal((await accountStatus(file, address, checked)).signedIn, true);
    const unreachable: Supabase = { ...address, url: "http://127.0.0.1:9" };
    const at = (offset: number) => accountStatus(file, unreachable, checked + offset);
    const offline = { signedIn: true, email: "someone@example.com", offline: true };
    assert.deepEqual(await at(OFFLINE_GRACE - DAY), { ...offline, entitled: true });
    assert.deepEqual(await at(OFFLINE_GRACE + 1), { ...offline, entitled: false });
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
