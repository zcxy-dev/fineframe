// The API keys the edits use: Anthropic's, which plans every edit, OpenRouter's, for cloud
// speech, and the optional free ones of Pexels and Pixabay, for stock footage. The page saves them in one file readable by its owner alone: the git-ignored .env at the
// repository root, where `pnpm edit` reads them too, or the one VIDEO_EDITOR_ENV_FILE names, such
// as the desktop app's in its own folder. A key goes to its service and to the edit's process,
// and nowhere else: never to a log, never back to the page.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import { parseEnv, promisify } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { PLAN_MODELS } from "@video-editor/engine/claude";
import { en, type Messages } from "./i18n/en.ts";

export type Service = "anthropic" | "openrouter" | "pexels" | "pixabay";
export const SERVICES: readonly Service[] = ["anthropic", "openrouter", "pexels", "pixabay"];

/** The variable each key is saved as, the one `pnpm edit` and vework read. */
export const VARIABLES: Record<Service, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  pexels: "PEXELS_API_KEY",
  pixabay: "PIXABAY_API_KEY",
};

/** The file the keys are saved in; VIDEO_EDITOR_ENV_FILE moves it. */
function envFile(): string {
  return process.env.VIDEO_EDITOR_ENV_FILE ?? resolve(process.cwd(), "../../.env");
}

/** A key: the one saved, which the page saved last, or else the server's own. */
export async function readKey(service: Service = "anthropic"): Promise<string | undefined> {
  const name = VARIABLES[service];
  const text = await readFile(envFile(), "utf8").catch(() => "");
  return parseEnv(text)[name] || process.env[name] || undefined;
}

/** Why `key` cannot be a key for `service`, in `t`'s words, or null. */
export function keyProblem(
  key: string,
  service: Service = "anthropic",
  t: Messages = en,
): string | null {
  // Keys are letters, digits, dashes and underscores after their prefix; anything else, such as
  // a line break, could also break the file they are saved in. Pexels and Pixabay keys have no
  // prefix.
  if (service === "pexels" || service === "pixabay") {
    return /^[\w-]{1,400}$/.test(key) ? null : t.server.pasteKey;
  }
  const prefix = service === "anthropic" ? "sk-ant-" : "sk-or-";
  if (!new RegExp(`^${prefix}[\\w-]{1,400}$`).test(key)) {
    return t.server.pastePrefixed(prefix);
  }
  return null;
}

/** Asks `service` whether `key` works, at no cost: null when it does, or what to do, in `t`'s
 * words. */
export function checkKey(
  key: string,
  service: Service = "anthropic",
  t: Messages = en,
): Promise<string | null> {
  if (service === "anthropic") return checkAnthropic(key, t);
  if (service === "openrouter") return checkOpenRouter(key, t);
  return checkStock(key, service, t);
}

/** Whether `key` can plan an edit: it looks up the planning model. */
async function checkAnthropic(key: string, t: Messages): Promise<string | null> {
  const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 20_000 });
  try {
    await client.models.retrieve(PLAN_MODELS.best);
    return null;
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return t.server.rejected("Anthropic", "console.anthropic.com/settings/keys");
    }
    if (
      error instanceof Anthropic.PermissionDeniedError ||
      error instanceof Anthropic.NotFoundError
    ) {
      return t.server.noModel(PLAN_MODELS.best);
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return t.server.unreachable("Anthropic");
    }
    // Anthropic's own words, which never hold the key.
    return t.server.anthropicSaid((error as Error).message);
  }
}

/** Whether OpenRouter knows `key`: it reads the key's own details, as vework does before it
 * sends any speech. OPENROUTER_BASE_URL moves the server, as it does for vework. */
async function checkOpenRouter(key: string, t: Messages): Promise<string | null> {
  const api = (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(
    /\/$/,
    "",
  );
  try {
    const response = await fetch(`${api}/key`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (response.ok) return null;
    if (response.status === 401) {
      return t.server.rejected("OpenRouter", "openrouter.ai/settings/keys");
    }
    return t.server.uncheckable("OpenRouter", response.status);
  } catch {
    return t.server.unreachable("OpenRouter");
  }
}

/** Whether Pexels or Pixabay takes `key`: one search for a single clip, which is free. */
async function checkStock(
  key: string,
  service: "pexels" | "pixabay",
  t: Messages,
): Promise<string | null> {
  const [name, url, init] =
    service === "pexels"
      ? [
          "Pexels",
          "https://api.pexels.com/v1/search?query=test&per_page=1",
          { headers: { Authorization: key } },
        ]
      : [
          "Pixabay",
          `https://pixabay.com/api/videos/?${new URLSearchParams({ key, q: "test", per_page: "3" })}`,
          {},
        ];
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
    if (response.ok) return null;
    // Pixabay answers a key it does not know with 400.
    if ([400, 401, 403].includes(response.status)) {
      const site = service === "pexels" ? "pexels.com/api" : "pixabay.com/api/docs";
      return t.server.rejected(name, site);
    }
    return t.server.uncheckable(name, response.status);
  } catch {
    return t.server.unreachable(name);
  }
}

/** Saves `key` for `service`, keeping the file's other lines, readable and writable by its owner
 * alone. */
export async function saveKey(key: string, service: Service = "anthropic"): Promise<void> {
  const name = VARIABLES[service];
  const file = envFile();
  const text = await readFile(file, "utf8").catch(() => "");
  const kept = text
    .split(/\r?\n/)
    .filter((line) => !new RegExp(`^\\s*(export\\s+)?${name}\\s*=`).test(line));
  while (kept.at(-1) === "") kept.pop();
  const next = `${[...kept, `${name}=${key}`].join("\n")}\n`;
  // Written whole beside it and renamed over it, so a half-written key is never read.
  const partial = `${file}.${randomUUID()}.partial`;
  try {
    await writeFile(partial, next, { mode: 0o600 });
    // Windows ignores the mode: the access list drops what it takes from the folder, which may
    // let every user of the machine read. The rename keeps the list.
    if (process.platform === "win32") {
      const domain = process.env.USERDOMAIN;
      const owner = `${domain ? `${domain}\\` : ""}${userInfo().username}`;
      const args = [partial, "/inheritance:r", "/grant:r", `${owner}:F`];
      await promisify(execFile)("icacls", args, { windowsHide: true });
    }
    await rename(partial, file);
  } finally {
    await rm(partial, { force: true });
  }
}
