// The people's names and terms of the last edit, which the page fills in again for the next one.
// They are kept in the jobs' folder, beside the edits that used them, outside the repository.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Settings } from "./settings.ts";

export interface Remembered {
  names: string[];
  terms: string[];
}

const FILE = "remembered.json";

/** What the last edit started in `root` was given; nothing before the first. */
export async function remembered(root: string): Promise<Remembered> {
  const text = await readFile(join(root, FILE), "utf8").catch(() => null);
  const found = text ? (JSON.parse(text) as Partial<Remembered>) : {};
  const list = (value: unknown) =>
    Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
  return { names: list(found.names), terms: list(found.terms) };
}

/** Keeps the names and terms of an edit just started in `root`, written whole. */
export async function remember(root: string, settings: Settings): Promise<void> {
  await mkdir(root, { recursive: true });
  const path = join(root, FILE);
  const value: Remembered = { names: settings.names, terms: settings.terms ?? [] };
  await writeFile(`${path}.tmp`, JSON.stringify(value));
  await rename(`${path}.tmp`, path);
}
