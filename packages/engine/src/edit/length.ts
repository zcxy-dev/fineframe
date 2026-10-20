// Pure, so the web page reads lengths with the same rules as the command.

/** The shortest and longest edits the planner makes, in seconds. */
export const LENGTH_RANGE = [15, 3600] as const;
/** The shortest and longest a short of `pnpm edit --shorts` may be, in seconds. */
export const SHORTS_RANGE = [15, 180] as const;
/** How many shorts a run may make. */
export const SHORTS_COUNT = [1, 10] as const;
/** The most moments footage gives: about one per SECONDS_PER_MOMENT of it, and never more than
 * MOST_MOMENTS. */
const SECONDS_PER_MOMENT = 120;
const MOST_MOMENTS = 20;

/** The most moments `seconds` of footage can give. */
export function mostMoments(seconds: number): number {
  return Math.min(MOST_MOMENTS, Math.max(1, Math.round(seconds / SECONDS_PER_MOMENT)));
}

/**
 * A length as people write it, in seconds: 90, 90s, 1.5m, 3m, 1m30s, 1m30, 1h, 1h5m or 1h30, or
 * a clock reading, 1:30 or 1:00:00. Null for anything else.
 */
export function parseLength(text: string): number | null {
  const clock = text.match(/^(?:(\d+):)?(\d+):([0-5]\d)$/);
  if (clock) {
    const [, hours, minutes, seconds] = clock;
    if (hours !== undefined && Number(minutes) > 59) return null;
    return Number(hours ?? 0) * 3600 + Number(minutes) * 60 + Number(seconds);
  }
  const number = "(\\d+(?:\\.\\d+)?)";
  const units = text.match(new RegExp(`^(?:${number}h)?(?:${number}m)?(?:${number}(s?))?$`));
  if (!units || units.slice(1, 4).every((part) => part === undefined)) return null;
  let [, hours, minutes, seconds] = units;
  // A bare number right after hours is minutes, as "1h30" is said.
  if (seconds !== undefined && units[4] === "" && hours !== undefined && minutes === undefined) {
    [minutes, seconds] = [seconds, undefined];
  }
  return Number(hours ?? 0) * 3600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0);
}

/** Two lengths joined by a dash, as `parseLength` reads each, the first under the second: 30-60s,
 * 90s-3m, 10:12-11:30. Null for anything else. */
export function parseSpan(text: string): [number, number] | null {
  const parts = text.split("-");
  if (parts.length !== 2) return null;
  const [from, to] = parts.map((part) => parseLength(part.trim())) as [
    number | null,
    number | null,
  ];
  return from !== null && to !== null && from < to ? [from, to] : null;
}
