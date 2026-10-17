// What Claude will cost for an edit, before it starts. Plain arithmetic, so the web page can
// show it as the length is chosen.

/**
 * US dollars Claude is likely to cost for an edit of `length` seconds from `footage` seconds of
 * video, as a range. The plan reads every transcript and writes more decisions for a longer
 * edit; the review checks each cut, and a longer edit has more of them. Fitted to the
 * measurements in packages/engine/MEASUREMENTS.md: a first plan of 7 minutes of footage cost
 * $0.06 for 30 s, $0.07 for 1 min and $0.12 for 5 min, and whole edits $0.10 to $0.13. Edits
 * much longer than those are not measured, so the range is wide.
 */
export function estimateCost(footage: number, length: number): { low: number; high: number } {
  const footageMinutes = Math.max(0, footage) / 60;
  const lengthMinutes = Math.max(0, length) / 60;
  const plan = 0.045 + 0.002 * footageMinutes + 0.012 * lengthMinutes;
  const check = 0.01 + 0.004 * lengthMinutes;
  const likely = plan + check;
  return { low: likely * 0.7, high: likely * 1.4 };
}
