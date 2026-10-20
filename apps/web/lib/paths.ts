import type { Job } from "./jobs.ts";

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

/** The length and aspect the version shown was planned for, which a re-plan may have changed
 * from the edit's. */
export function shownPlan(job: Job): { length: number; aspect: Job["settings"]["aspect"] } {
  const shown = job.versions?.find((version) => version.n === (job.current ?? 1));
  return {
    length: shown?.length ?? job.settings.length,
    aspect: shown?.aspect ?? job.settings.aspect,
  };
}

/** A name for a download: the length and aspect of the version shown, which tell two edits
 * apart; a short's place and title. */
export function downloadName(job: Job, extension: string): string {
  const short = job.shorts?.find((each) => each.folder === job.short);
  if (short) return `${short.folder}-${fileTitle(short.title)}.${extension}`;
  const { length, aspect } = shownPlan(job);
  return `edit-${Math.round(length)}s-${aspect.replace(":", "x")}.${extension}`;
}

/** Characters no file name may hold on Windows, macOS or Linux, and control characters. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what it removes.
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f\u007f]/g;
const TITLE_MAX = 60;

/** `title` as part of a file name on any system: without the characters one refuses, without a
 * trailing dot or space, at most TITLE_MAX characters; "short" when nothing is left. */
export function fileTitle(title: string): string {
  const safe = [...title.replace(UNSAFE, " ").replace(/\s+/g, " ").trim()]
    .slice(0, TITLE_MAX)
    .join("")
    .replace(/[. ]+$/, "");
  return safe || "short";
}
