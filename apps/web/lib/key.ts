// The Anthropic API key the edits use. The page saves it in the git-ignored .env at the
// repository root, readable by its owner alone, where `pnpm edit` reads it too. The key goes to
// Anthropic and to the edit's process, and nowhere else: never to a log, never back to the page.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { resolve } from "node:path";
import { parseEnv, promisify } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { PLAN_MODELS } from "@video-editor/engine/claude";

const NAME = "ANTHROPIC_API_KEY";

/** The .env the key is saved in; VIDEO_EDITOR_ENV_FILE moves it. */
export function envFile(): string {
  return process.env.VIDEO_EDITOR_ENV_FILE ?? resolve(process.cwd(), "../../.env");
}

/** The key: the one saved in .env, which the page saved last, or else the server's own. */
export async function readKey(): Promise<string | undefined> {
  const text = await readFile(envFile(), "utf8").catch(() => "");
  return parseEnv(text)[NAME] || process.env[NAME] || undefined;
}

/** Why `key` cannot be a key, or null. */
export function keyProblem(key: string): string | null {
  // Anthropic's keys are letters, digits, dashes and underscores after sk-ant-; anything else,
  // such as a line break, could also break .env.
  if (!/^sk-ant-[\w-]{1,400}$/.test(key)) {
    return "Paste the whole key: one line, starting with sk-ant-";
  }
  return null;
}

/**
 * Asks Anthropic whether `key` can plan an edit: it looks up the planning model, which costs
 * nothing. Null when it can, or what to do when it cannot.
 */
export async function checkKey(key: string): Promise<string | null> {
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

/** Saves `key` in .env, keeping its other lines, readable and writable by its owner alone. */
export async function saveKey(key: string): Promise<void> {
  const file = envFile();
  const text = await readFile(file, "utf8").catch(() => "");
  const kept = text
    .split(/\r?\n/)
    .filter((line) => !new RegExp(`^\\s*(export\\s+)?${NAME}\\s*=`).test(line));
  while (kept.at(-1) === "") kept.pop();
  const next = `${[...kept, `${NAME}=${key}`].join("\n")}\n`;
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
