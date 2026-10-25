// When a running edit will finish: the analysis at the rate its bar has moved, then the plan, the
// render and the check, which take about as long on any machine, from the edit's length.

import { en, type Messages } from "./i18n/en.ts";
import type { Job, Stage } from "./jobs.ts";

type Step = NonNullable<Job["progress"]>["step"];

/** Too little of the analysis to say how fast it goes: its first half minute, or 2 % of the
 * bar, from the bar's first move. */
const MIN_MILLISECONDS = 30_000;
const MIN_FRACTION = 0.02;
/** Where the bar is when the analysis ends, when every file needs it
 * (ANALYZE_SHARE in packages/engine/src/edit/edit.ts). */
const ANALYSIS_END = 0.9;
/** How long a new rate takes to move the estimate most of the way, in milliseconds, and how far
 * the finish may move later and earlier for each millisecond since the last line: the bar moves
 * in steps, some of them minutes apart, and the time left should not jump with each. It comes
 * down faster than it goes up, so that one too high after a slow stretch catches up. */
const SETTLE = 30_000;
const LATER = 0.5;
const EARLIER = 1;

/** Seconds the plan, the render and the check take after the analysis, for an edit of `length`
 * seconds: fitted to the measured edits (packages/engine/MEASUREMENTS.md), 41 to 72 s for a
 * minute and 133 s for five. */
export function afterAnalysis(length: number): number {
  return 45 + 0.3 * length;
}

/**
 * Follows one edit and estimates when it finishes. The finish moves later by at most half the
 * time since the last line and earlier by at most as long, so the time left only counts down, at
 * half to twice the clock's pace. Time while `downloading` (a model, which shows its own time
 * left), or on an analysis line that is none of the footage's steps (checking Claude, a first-use
 * download such as FFmpeg's, the analysis starting, the music's analysis), is not counted as the
 * analysis's work and moves the finish later by as long: on a first edit it can take minutes that
 * say nothing of the footage's pace. Nor is the time before the footage's steps first move the bar:
 * the first step's model loads then, and shot detection's first 5 % can take several times as
 * long as each 5 % after it.
 */
export class Finish {
  readonly #after: number;
  #last: { at: number; fraction: number; paused: boolean } | undefined;
  #from = 0;
  #worked = 0;
  /** Whether the footage's steps have moved the bar yet. */
  #moving = false;
  /** When the stages after the analysis began. */
  #analysed: number | undefined;
  #finish: number | undefined;

  /** For `edits` edits of `length` seconds each, one after another, as a run of shorts makes
   * them. */
  constructor(length: number, edits = 1) {
    this.#after = afterAnalysis(length) * edits * 1000;
  }

  /** The bar at `at` (epoch milliseconds) in `stage`, on the analysis's `step`; returns the
   * estimated finish, or undefined until there is enough to go on. */
  update(
    at: number,
    fraction: number,
    stage: Stage,
    downloading = false,
    step?: Step,
  ): number | undefined {
    const paused = downloading || (stage === "analyze" && (step === undefined || step === "music"));
    const last = this.#last;
    if (!last) this.#from = fraction;
    const elapsed = last ? Math.max(0, at - last.at) : 0;
    if (last?.paused) {
      if (this.#finish !== undefined) this.#finish += elapsed;
    } else if (stage === "analyze") {
      if (this.#moving) this.#worked += elapsed;
      else if (fraction > this.#from) {
        this.#moving = true;
        this.#from = fraction;
      }
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
      const move = (measured - this.#finish) * weight;
      this.#finish += Math.max(-elapsed * EARLIER, Math.min(elapsed * LATER, move));
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
