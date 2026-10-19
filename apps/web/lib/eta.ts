// When a running edit will finish: the analysis at the rate its bar has moved, then the plan, the
// render and the check, which take about as long on any machine, from the edit's length.

import { en, type Messages } from "./i18n/en.ts";
import type { Stage } from "./jobs.ts";

/** Too little of the analysis to say how fast it goes: its first half minute, or 2 % of the
 * bar. */
const MIN_MILLISECONDS = 30_000;
const MIN_FRACTION = 0.02;
/** Where the bar is when the analysis ends, when every file needs it
 * (ANALYZE_SHARE in packages/engine/src/edit/edit.ts). */
const ANALYSIS_END = 0.9;
/** How long a new rate takes to move the estimate most of the way, in milliseconds, and how far
 * the finish may move for each millisecond since the last line: the bar moves in steps, some of
 * them minutes apart, and the time left should not jump with each. */
const SETTLE = 30_000;
const SLEW = 0.5;

/** Seconds the plan, the render and the check take after the analysis, for an edit of `length`
 * seconds: fitted to the measured edits (packages/engine/MEASUREMENTS.md), 41 to 72 s for a
 * minute and 133 s for five. */
export function afterAnalysis(length: number): number {
  return 45 + 0.3 * length;
}

/**
 * Follows one edit and estimates when it finishes. The finish moves by at most half the time
 * since the last line, so the time left only counts down, at half to one and a half times the
 * clock's pace. Time while `paused` (a model downloading, which shows its own time left) is not
 * counted as the analysis's work and moves the finish later by as long.
 */
export class Finish {
  readonly #after: number;
  #last: { at: number; fraction: number; paused: boolean } | undefined;
  #from = 0;
  #worked = 0;
  /** When the stages after the analysis began. */
  #analysed: number | undefined;
  #finish: number | undefined;

  /** For an edit of `length` seconds. */
  constructor(length: number) {
    this.#after = afterAnalysis(length) * 1000;
  }

  /** The bar at `at` (epoch milliseconds) in `stage`; returns the estimated finish, or undefined
   * until there is enough to go on. */
  update(at: number, fraction: number, stage: Stage, paused = false): number | undefined {
    const last = this.#last;
    if (!last) this.#from = fraction;
    const elapsed = last ? Math.max(0, at - last.at) : 0;
    if (last?.paused) {
      if (this.#finish !== undefined) this.#finish += elapsed;
    } else if (stage === "analyze") {
      this.#worked += elapsed;
    }
    this.#last = { at, fraction, paused };
    if (paused) return this.#finish;
    let measured: number;
    if (stage === "analyze") {
      const moved = fraction - this.#from;
      if (this.#worked < MIN_MILLISECONDS || moved < MIN_FRACTION) return this.#finish;
      const left = (Math.max(0, ANALYSIS_END - fraction) * this.#worked) / moved;
      measured = at + left + this.#after;
    } else {
      this.#analysed ??= at;
      measured = Math.max(at, this.#analysed + this.#after);
    }
    if (this.#finish === undefined) this.#finish = measured;
    else {
      const weight = 1 - Math.exp(-elapsed / SETTLE);
      const most = elapsed * SLEW;
      this.#finish += Math.max(-most, Math.min(most, (measured - this.#finish) * weight));
    }
    return this.#finish;
  }
}

/** Time left in `t`'s words, rounded more coarsely the longer it is: less than a minute, about
 * 4 min, 25 min, 1 h 5 min. */
export function formatEstimate(seconds: number, t: Messages = en): string {
  if (seconds < 60) return t.eta.underMinute;
  const { h, min } = t.units;
  const minutes = Math.round(seconds / 60);
  if (minutes < 10) return t.eta.about(`${minutes} ${min}`);
  const rounded = Math.round(minutes / 5) * 5;
  if (rounded < 60) return t.eta.about(`${rounded} ${min}`);
  const rest = rounded % 60;
  return t.eta.about(`${Math.floor(rounded / 60)} ${h}${rest ? ` ${rest} ${min}` : ""}`);
}
