// Pure, so the web page reads lengths with the same rules as the command.

/** The shortest and longest edits the planner makes, in seconds. */
export const LENGTH_RANGE = [15, 3600] as const;

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
