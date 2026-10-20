// A run of several shorts as the page shows it: each short as an edit of its own, with the same
// result page, and the reason when fewer were made than asked for.
import type { Job } from "./jobs.ts";

/** A re-plan of a short takes its material from the short's stretch and this many seconds on
 * each side. */
export const REPLAN_MARGIN = 30;

/**
 * One short of `job` as the page shows an edit: its versions, the one shown, its result, what it
 * cost and its length, and a render only while one of its own versions renders. `short` names it
 * in every request the page makes about it.
 */
export function shortView(job: Job, folder: string): Job | null {
  const short = job.shorts?.find((each) => each.folder === folder);
  if (!short) return null;
  const { versions, current, result, claude, render, ...rest } = job;
  return {
    ...rest,
    status: "done",
    settings: { ...job.settings, length: short.length },
    short: folder,
    ...(short.versions ? { versions: short.versions } : {}),
    ...(short.current ? { current: short.current } : {}),
    ...(short.result ? { result: short.result } : {}),
    ...(short.claude ? { claude: short.claude } : {}),
    ...(render?.short === folder ? { render } : {}),
  };
}

/** The address of `path` for the edit the page shows: the job's own, or one of its shorts'. */
export function jobApi(job: Job, path = "", query: Record<string, string | number> = {}): string {
  const params = new URLSearchParams(
    Object.entries({ ...query, ...(job.short ? { short: job.short } : {}) }).map(([key, value]) => [
      key,
      String(value),
    ]),
  );
  const search = params.size > 0 ? `?${params}` : "";
  return `/api/jobs/${job.id}${path ? `/${path}` : ""}${search}`;
}

/** How many shorts were made and asked for, when the run finished with fewer than asked. */
export function fewerShorts(job: Job): { made: number; asked: number } | null {
  const asked = job.settings.shorts?.count;
  const made = job.shorts?.length ?? 0;
  return job.status === "done" && asked !== undefined && made < asked ? { made, asked } : null;
}
