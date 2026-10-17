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
export function envFile(): string {
  return process.env.VIDEO_EDITOR_ENV_FILE ?? resolve(process.cwd(), "../../.env");
}

/** A key: the one saved, which the page saved last, or else the server's own. */
export async function readKey(service: Service = "anthropic"): Promise<string | undefined> {
  const name = VARIABLES[service];
  const text = await readFile(envFile(), "utf8").catch(() => "");
  return parseEnv(text)[name] || process.env[name] || undefined;
}

/** Why `key` cannot be a key for `service`, or null. */
export function keyProblem(key: string, service: Service = "anthropic"): string | null {
  // Keys are letters, digits, dashes and underscores after their prefix; anything else, such as
  // a line break, could also break the file they are saved in. Pexels and Pixabay keys have no
  // prefix.
  if (service === "pexels" || service === "pixabay") {
    return /^[\w-]{1,400}$/.test(key)
      ? null
      : "Paste the whole key: one line of letters and digits";
  }
  const prefix = service === "anthropic" ? "sk-ant-" : "sk-or-";
  if (!new RegExp(`^${prefix}[\\w-]{1,400}$`).test(key)) {
    return `Paste the whole key: one line, starting with ${prefix}`;
  }
  return null;
}

/** Asks `service` whether `key` works, at no cost: null when it does, or what to do. */
export function checkKey(key: string, service: Service = "anthropic"): Promise<string | null> {
  if (service === "anthropic") return checkAnthropic(key);
  if (service === "openrouter") return checkOpenRouter(key);
  return checkStock(key, service);
}

/** Whether `key` can plan an edit: it looks up the planning model. */
async function checkAnthropic(key: string): Promise<string | null> {
  const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 20_000 });
  try {
    await client.models.retrieve(PLAN_MODELS.best);
    return null;
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return "Anthropic did not accept this key. Copy it again from console.anthropic.com/settings/keys";
    }
    if (
      error instanceof Anthropic.PermissionDeniedError ||
      error instanceof Anthropic.NotFoundError
    ) {
      return `This key cannot use ${PLAN_MODELS.best}, which plans the edit. Use a key from an account that has it`;
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return "Could not reach Anthropic to check the key. Check the internet connection and try again";
    }
    // Anthropic's own words, which never hold the key.
    return `Anthropic could not check the key: ${(error as Error).message}`;
  }
}

/** Whether OpenRouter knows `key`: it reads the key's own details, as vework does before it
 * sends any speech. OPENROUTER_BASE_URL moves the server, as it does for vework. */
async function checkOpenRouter(key: string): Promise<string | null> {
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
      return "OpenRouter did not accept this key. Copy it again from openrouter.ai/settings/keys";
    }
    return `OpenRouter could not check the key (HTTP ${response.status}). Try again`;
  } catch {
    return "Could not reach OpenRouter to check the key. Check the internet connection and try again";
  }
}

/** Whether Pexels or Pixabay takes `key`: one search for a single clip, which is free. */
async function checkStock(key: string, service: "pexels" | "pixabay"): Promise<string | null> {
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
      return `${name} did not accept this key. Copy it again from ${site}`;
    }
    return `${name} could not check the key (HTTP ${response.status}). Try again`;
  } catch {
    return `Could not reach ${name} to check the key. Check the internet connection and try again`;
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
