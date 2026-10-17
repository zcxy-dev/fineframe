import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { EditError } from "./error.ts";
import { kindOf, type MediaKind } from "./media.ts";

/** A media file to edit from. */
export interface MediaFile {
  /** The path as the caller gave it, or the folder they gave joined with the file's name. */
  given: string;
  /** Absolute. */
  path: string;
  kind: MediaKind;
}

/**
 * The media files `inputs` name, in order: each file as given, and the video, audio and image
 * files directly in each folder, by name. A file given by name with another extension is read as
 * video, for the analysis to judge. Folders leave out `output` and earlier edits, the videos with
 * a `<name>.project.json` beside them, so an edit written into its footage folder is not
 * footage the next time.
 */
export async function collectInputs(
  inputs: readonly string[],
  output: string,
): Promise<MediaFile[]> {
  const files: MediaFile[] = [];
  const seen = new Set<string>();
  const add = (given: string, path: string, kind: MediaKind) => {
    if (seen.has(path)) return;
    seen.add(path);
    files.push({ given, path, kind });
  };
  for (const input of inputs) {
    const path = resolve(input);
    const info = await stat(path).catch(() => null);
    if (!info) throw new EditError(`${input}: no such file or folder`);
    if (!info.isDirectory()) {
      add(input, path, kindOf(path) ?? "video");
      continue;
    }
    const before = files.length;
    for (const name of (await readdir(path)).sort()) {
      const file = join(path, name);
      const kind = kindOf(name);
      if (!kind || name.startsWith(".") || file === resolve(output)) continue;
      const stem = basename(name, extname(name));
      if (kind === "video" && existsSync(join(path, `${stem}.project.json`))) continue;
      if (!(await stat(file)).isFile()) continue;
      add(join(input, name), file, kind);
    }
    if (files.length === before)
      throw new EditError(`${input}: no video, audio or image file in it`);
  }
  return files;
}
