/**
 * A dropped file's path inside what was dropped, made safe to write under a job's footage
 * folder: forward slashes, no empty or `.` segments. Null for a path that could leave the folder
 * or that names a hidden file, which a person did not mean to drop.
 */
export function safeRelativePath(path: string): string | null {
  const segments = path
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
  if (segments.length === 0 || segments.length > 16) return null;
  for (const segment of segments) {
    if (segment.startsWith(".")) return null;
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it rejects.
    if (/[\u0000-\u001f\u007f]/.test(segment)) return null;
    if (new TextEncoder().encode(segment).length > 255) return null;
  }
  return segments.join("/");
}

/** A name for a download: the edit's length and aspect, which tell two edits apart. */
export function downloadName(length: number, aspect: string, extension: string): string {
  return `edit-${Math.round(length)}s-${aspect.replace(":", "x")}.${extension}`;
}
