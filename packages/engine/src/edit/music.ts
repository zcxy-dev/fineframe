import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import type { License } from "./analyze.ts";
import { EditError } from "./error.ts";
import type { MediaFile } from "./inputs.ts";
import { kindOf } from "./media.ts";

/** A track the edit may play, with the licence it is used under. */
export interface MusicFile {
  file: MediaFile;
  license: License;
}

/**
 * The licence `<name>.txt` beside a track states: its first line is the licence's name, a line
 * that is a web address says where its terms are, and any other lines are the credit it asks
 * for. Null when there is no such file.
 */
async function readLicense(track: string): Promise<License | null> {
  const path = join(dirname(track), `${basename(track, extname(track))}.txt`);
  if (!existsSync(path)) return null;
  const lines = (await readFile(path, "utf8"))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const [name, ...rest] = lines;
  if (!name) throw new EditError(`${path}: empty; its first line is the track's licence`);
  const url = rest.find((line) => /^https?:\/\/\S+$/.test(line));
  const credit = rest.filter((line) => line !== url).join(" ");
  return { name, ...(url ? { url } : {}), ...(credit ? { attribution: credit } : {}) };
}

/**
 * The tracks `inputs` name, in order: each audio file as given, and the audio files directly in
 * each folder, by name, each with its licence: from `<name>.txt` beside it, or else `fallback`.
 * A track without either fails, so no music is used without a licence.
 */
export async function collectMusic(
  inputs: readonly string[],
  fallback?: string,
): Promise<MusicFile[]> {
  const files: MediaFile[] = [];
  for (const input of inputs) {
    const path = resolve(input);
    const info = await stat(path).catch(() => null);
    if (!info) throw new EditError(`${input}: no such file or folder`);
    if (!info.isDirectory()) {
      if (kindOf(path) !== "audio") {
        throw new EditError(`${input}: not an audio file; --music takes tracks and their folders`);
      }
      files.push({ given: input, path, kind: "audio" });
      continue;
    }
    const before = files.length;
    for (const name of (await readdir(path)).sort()) {
      const file = join(path, name);
      if (kindOf(name) !== "audio" || name.startsWith(".")) continue;
      if ((await stat(file)).isFile())
        files.push({ given: join(input, name), path: file, kind: "audio" });
    }
    if (files.length === before) throw new EditError(`${input}: no audio file in it`);
  }
  const tracks: MusicFile[] = [];
  for (const file of files) {
    if (tracks.some((track) => track.file.path === file.path)) continue;
    const license = (await readLicense(file.path)) ?? (fallback ? { name: fallback } : null);
    if (!license) {
      const sidecar = `${basename(file.path, extname(file.path))}.txt`;
      throw new EditError(
        `${file.given}: no licence. Use only music you have the right to use, and say under ` +
          `which licence: its name on the first line of ${sidecar} beside the track (a web ` +
          "address and a credit line may follow), or --music-license for every track without one",
      );
    }
    tracks.push({ file, license });
  }
  return tracks;
}
