// What Claude will cost for an edit, before it starts. Plain arithmetic, so the web page can
// show it as the length is chosen.

import { mostMoments } from "../edit/length.ts";

/** Finding the moments: the request and its answer, and each minute of footage it reads. */
const FIND_BASE = 0.015;
const FIND_PER_MINUTE = 0.0045;

/**
 * US dollars Claude is likely to cost for an edit of `length` seconds from `footage` seconds of
 * video, as a range. The plan reads every transcript and writes more decisions for a longer
 * edit; with rich visuals, Claude writes the edit's motion graphics, more for a longer edit; the
 * review checks each cut, and a longer edit has more of them. Fitted to the measurements in
 * packages/engine/MEASUREMENTS.md: the plan of 7 minutes of footage, which lists the music
 * library's 40 tracks, cost $0.10 for 30 s, $0.08 for 1 min and $0.20 for 5 min, and the graphics
 * $0.14 to $0.30 for a 30 s edit, $0.21 to $0.54 for 1 min, $0.63 and $0.74 for 3 min and $0.79
 * and $1.00 for 5 min. Edits much longer than those are not measured, so the range is wide.
 */
export function estimateCost(
  footage: number,
  length: number,
  visuals: "rich" | "minimal" = "rich",
): { low: number; high: number } {
  const lengthMinutes = Math.max(0, length) / 60;
  const plan = planCost(footage, length);
  const graphics = visuals === "rich" ? 0.05 + 0.27 * lengthMinutes : 0;
  const check = 0.01 + 0.004 * lengthMinutes;
  const likely = plan + graphics + check;
  return { low: likely * 0.6, high: likely * 1.5 };
}

/** One planning request for an edit of `length` seconds from `footage` seconds of video. */
function planCost(footage: number, length: number): number {
  return 0.05 + (0.002 * Math.max(0, footage)) / 60 + (0.018 * Math.max(0, length)) / 60;
}

/**
 * US dollars Claude is likely to cost for `count` shorts of `range` seconds from `footage`
 * seconds of video, as a range: one request reads every transcript to find the moments, and each
 * short costs at most an edit of the range's longest length from a stretch twice as long. At most
 * one short per two minutes of footage is made, and at most as many moments again are tried and
 * left out, each after its two planning requests (MAX_PLAN_CALLS), which the upper bound counts.
 * Fitted to the runs measured in
 * packages/engine/MEASUREMENTS.md: finding the moments cost $0.05 for 7 minutes of footage and
 * $0.07 for 14, and each short of 26 to 51 s $0.34 to $0.42.
 */
export function estimateShortsCost(
  footage: number,
  count: number,
  range: readonly [number, number],
  visuals: "rich" | "minimal" = "rich",
): { low: number; high: number } {
  const find = FIND_BASE + FIND_PER_MINUTE * (Math.max(0, footage) / 60);
  const length = range[1];
  const each = estimateCost(2 * length, length, visuals);
  const made = Math.min(count, mostMoments(footage));
  const failed = Math.min(count, mostMoments(footage) - made);
  const tried = 2 * planCost(2 * length, length) * 1.5;
  return {
    low: find * 0.6 + made * each.low,
    high: find * 1.5 + made * each.high + failed * tried,
  };
}
