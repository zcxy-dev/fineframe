// The desktop app's account: signing in through the website in the browser (Supabase's PKCE flow,
// redirected to a port on this computer's loopback address), the session kept in a file only its
// owner can read beside the API keys, and whether it has a subscription. That is checked with
// Supabase before each edit, and trusted offline for 7 days after the last check that reached it.
// Only Node's own modules: the page's server, the desktop app and its `fineframe` command all run
// it.
import { createHash, randomBytes } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { writePrivate } from "./private.ts";

/** The website: the sign-in, the pricing and the account. */
export const SITE = "https://fineframe.app";

/** How long the app keeps working without reaching Supabase after a check said it may. */
export const OFFLINE_GRACE = 7 * 24 * 60 * 60 * 1000;

/** How long the browser has to come back from the sign-in. */
const SIGN_IN_WAIT = 10 * 60 * 1000;

/** The Supabase project the app signs in with; both values are public. */
export interface Supabase {
  url: string;
  anonKey: string;
}

/**
 * The project of this build: `supabase.json` at the editor's root, which the installer's stage
 * writes, or else FINEFRAME_SUPABASE_URL and FINEFRAME_SUPABASE_ANON_KEY, as when the app runs
 * from a clone. Null with neither: this build cannot sign in.
 */
export async function readSupabase(
  editor: string,
  env: Record<string, string | undefined> = process.env,
): Promise<Supabase | null> {
  const text = await readFile(join(editor, "supabase.json"), "utf8").catch(() => null);
  if (text) return JSON.parse(text) as Supabase;
  const url = env.FINEFRAME_SUPABASE_URL;
  const anonKey = env.FINEFRAME_SUPABASE_ANON_KEY;
  return url && anonKey ? { url: url.replace(/\/$/, ""), anonKey } : null;
}

interface Session {
  accessToken: string;
  refreshToken: string;
  /** When the access token expires, in ms since the epoch. */
  expiresAt: number;
  user: { id: string; email: string };
}

/** The last check that reached Supabase: when, and whether it found a subscription. */
interface Check {
  at: number;
  entitled: boolean;
}

/** The account file: the session, and the last check. */
interface Saved {
  session: Session;
  checked?: Check;
}

/** A row of the `subscriptions` table, as the app reads it. */
export interface Subscription {
  status: string;
  current_period_end: string | null;
}

/** Signed out, or signed in as `email` with a subscription or not. `offline`: Supabase could not
 * be reached, so `entitled` is the last check's, while it is less than 7 days old. */
export type Status =
  | { signedIn: false }
  | { signedIn: true; email: string; entitled: boolean; offline: boolean };

/** What stands between the user and an edit. */
export type Blocker = "sign-in" | "subscribe" | "offline";

/** Whether `rows` hold a subscription that lets the app edit at `now`: active, on trial or with a
 * payment overdue, or cancelled with its paid period not over yet. */
export function entitledBy(rows: readonly Subscription[], now: number): boolean {
  return rows.some(
    (row) =>
      ["active", "trialing", "past_due"].includes(row.status) ||
      (row.status === "canceled" &&
        row.current_period_end !== null &&
        Date.parse(row.current_period_end) > now),
  );
}

/** Whether the last check still holds at `now` without reaching Supabase. */
function entitledOffline(checked: Check | undefined, now: number): boolean {
  return checked?.entitled === true && now - checked.at < OFFLINE_GRACE;
}

/** The site's own path for a page's language. */
export const siteLocale = (locale: string) => (locale === "zh-TW" ? "zh-tw" : "en");

const pkce = () => {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
};

/** Supabase refused a request, with `status`. */
class Refused extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`Supabase refused the request (HTTP ${status})`);
    this.status = status;
  }
}

/** Supabase's answer to `path`, as JSON; Refused when it refuses the request. */
async function call(
  supabase: Supabase,
  path: string,
  init: { method?: string; body?: unknown; token?: string } = {},
): Promise<unknown> {
  const response = await fetch(`${supabase.url}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      apikey: supabase.anonKey,
      "Content-Type": "application/json",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status >= 400 && response.status < 500) throw new Refused(response.status);
  if (!response.ok) throw new Error(`Supabase answered HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
}

/** A session from Supabase's token answer. */
function sessionOf(answer: unknown, now: number): Session {
  const token = answer as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user: { id: string; email: string };
  };
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: now + token.expires_in * 1000,
    user: { id: token.user.id, email: token.user.email },
  };
}

async function read(file: string): Promise<Saved | null> {
  const text = await readFile(file, "utf8").catch(() => null);
  return text ? (JSON.parse(text) as Saved) : null;
}

const save = (file: string, saved: Saved) =>
  writePrivate(file, `${JSON.stringify(saved, null, 2)}\n`);

/**
 * Whether the user saved in `file` may edit: the session refreshed when it is about to expire,
 * then the subscription read and the check saved. Without Supabase, the last check holds for 7
 * days; a session Supabase refuses is signed out.
 */
export async function accountStatus(
  file: string,
  supabase: Supabase | null,
  now = Date.now(),
): Promise<Status> {
  const saved = await read(file);
  if (!saved || !supabase) return { signedIn: false };
  const { email } = saved.session.user;
  // Supabase refuses a refresh token that was revoked or whose user was deleted, and an access
  // token that is not its own.
  let refreshing = false;
  try {
    let session = saved.session;
    if (session.expiresAt - now < 60_000) {
      refreshing = true;
      const answer = await call(supabase, "/auth/v1/token?grant_type=refresh_token", {
        body: { refresh_token: session.refreshToken },
      });
      refreshing = false;
      session = sessionOf(answer, now);
      // Saved at once: the refresh token used is spent.
      await save(file, { ...saved, session });
    }
    const rows = (await call(
      supabase,
      `/rest/v1/subscriptions?select=status,current_period_end&user_id=eq.${encodeURIComponent(session.user.id)}`,
      { token: session.accessToken },
    )) as Subscription[];
    const entitled = entitledBy(rows, now);
    await save(file, { session, checked: { at: now, entitled } });
    return { signedIn: true, email, entitled, offline: false };
  } catch (error) {
    if (
      error instanceof Refused &&
      (error.status === 401 || (refreshing && error.status === 400))
    ) {
      await rm(file, { force: true });
      return { signedIn: false };
    }
    return { signedIn: true, email, entitled: entitledOffline(saved.checked, now), offline: true };
  }
}

/** What keeps the user from editing, or null: nothing does where the account is not checked (no
 * `file`, as with `pnpm edit` from a clone) or FINEFRAME_DEV_ENTITLED=1 says so, which only
 * development and CI set. */
export async function editBlocker(
  file: string | undefined,
  editor: string,
  env: Record<string, string | undefined> = process.env,
): Promise<Blocker | null> {
  if (!file || env.FINEFRAME_DEV_ENTITLED === "1") return null;
  const status = await accountStatus(file, await readSupabase(editor, env));
  if (!status.signedIn) return "sign-in";
  if (status.entitled) return null;
  return status.offline ? "offline" : "subscribe";
}

/** The page the browser shows when it comes back: done, or what failed. */
export interface Landing {
  done: string;
  failed: string;
}

/** A sign-in under way: the page to open in the browser, and its end. */
export interface SignIn {
  url: string;
  /** Settles once the browser came back and the session is saved, or rejects. */
  done: Promise<void>;
  cancel: () => void;
}

/**
 * Starts a sign-in: the website's sign-in page, given a PKCE challenge and a loopback address of
 * this app's to send the browser back to with Supabase's code, which only this app's verifier
 * turns into a session. The session is saved in `file`.
 */
export function startSignIn(
  file: string,
  supabase: Supabase,
  locale: string,
  landing: Landing,
): Promise<SignIn> {
  const { verifier, challenge } = pkce();
  let settle: { resolve: () => void; reject: (error: Error) => void } | undefined;
  const done = new Promise<void>((resolve, reject) => {
    settle = { resolve, reject };
  });
  // Nothing waits on it until the page asks.
  done.catch(() => {});
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/callback") {
      response.writeHead(404).end();
      return;
    }
    const code = url.searchParams.get("code");
    const answer = (ok: boolean) => {
      const text = ok ? landing.done : landing.failed;
      response
        .writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" })
        .end(
          `<!doctype html><meta charset="utf-8"><title>Fineframe</title><body style="font:16px system-ui,sans-serif;display:grid;place-items:center;height:90vh">${text}</body>`,
        );
    };
    const finish = async () => {
      if (!code) throw new Error(url.searchParams.get("error") ?? "No code came back");
      const answer = await call(supabase, "/auth/v1/token?grant_type=pkce", {
        body: { auth_code: code, code_verifier: verifier },
      });
      await save(file, { session: sessionOf(answer, Date.now()) });
    };
    void finish().then(
      () => {
        answer(true);
        settle?.resolve();
        close();
      },
      (error: Error) => {
        answer(false);
        settle?.reject(error);
        close();
      },
    );
  });
  const timer = setTimeout(() => {
    settle?.reject(new Error("The sign-in timed out"));
    close();
  }, SIGN_IN_WAIT);
  const close = () => {
    clearTimeout(timer);
    server.close();
  };
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const query = new URLSearchParams({
        redirect_to: `http://127.0.0.1:${port}/callback`,
        code_challenge: challenge,
        code_challenge_method: "s256",
      });
      resolve({
        url: `${SITE}/${siteLocale(locale)}/app-sign-in/?${query}`,
        done,
        cancel: () => {
          settle?.reject(new Error("The sign-in was cancelled"));
          close();
        },
      });
    });
  });
}

/** Signs out: Supabase revokes the session if it can be reached, and the file goes. */
export async function signOut(file: string, supabase: Supabase | null): Promise<void> {
  const saved = await read(file);
  if (saved && supabase) {
    await call(supabase, "/auth/v1/logout?scope=local", {
      method: "POST",
      token: saved.session.accessToken,
    }).catch(() => {});
  }
  await rm(file, { force: true });
}
