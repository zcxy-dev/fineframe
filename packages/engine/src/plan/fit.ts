// Fits an edit to its target length by priority, in code, so the model never does the sums.

/** The lines of one segment that stay in the edit, as offsets into its lines, inclusive; null
 * when the whole segment is dropped. */
export type Span = [from: number, to: number] | null;

export interface FitSegment {
  lines: number;
  /** 1 holds the story together … 5 is a nice-to-have, dropped first. */
  priority: number;
}

export interface Fit {
  spans: Span[];
  breath: number;
  length: number;
  /** Segments dropped or trimmed, plus one if the breath had to change. */
  passes: number;
}

/** How far the breath at joins may stretch or shrink to bring the length nearer the target. */
export const BREATH_RANGE: readonly [number, number] = [0.6, 1.6];

/** Lengths this share of the target apart count as equally near it, so the choice that keeps
 * more lines wins. */
const NEAR = 0.005;

/**
 * Keeps what the story needs and lands as near `target` as whole lines and the breath allow,
 * within `tolerance` of it:
 *
 * 1. The choices drop segments by priority, the highest number first (the latest one among
 *    equals), or keep a segment's first lines instead, since a segment builds from setup to
 *    payoff. A segment whose dropping would undershoot stays whole, and the next is tried.
 * 2. Each choice gets the breath at every join, within BREATH_RANGE, that brings it nearest the
 *    target.
 * 3. The nearest choice within the tolerance wins; of those within NEAR of it, the one that keeps
 *    the most. A choice that keeps a less important segment whole while trimming a more
 *    important one counts only when no choice in priority order lands within the tolerance, and
 *    one that shortens any segment by its lines only when neither does.
 *
 * `measure(spans, breath)` is the edit's length in ticks with those lines. Returns the nearest
 * choice even when it misses; the caller decides what a miss means.
 */
export function fitLength(
  segments: readonly FitSegment[],
  measure: (spans: readonly Span[], breath: number) => number,
  target: number,
  tolerance: number,
): Fit {
  const whole: Span[] = segments.map((s) => (s.lines > 0 ? [0, s.lines - 1] : null));
  const order = segments
    .map((segment, i) => ({ segment, i }))
    .sort((a, b) => b.segment.priority - a.segment.priority || b.i - a.i)
    .map(({ i }) => i);

  // Choices in priority order, then those that cut a segment while a less important one stayed
  // whole, each by how much they cut, least first.
  const inOrder: Span[][] = [whole];
  const skipping: Span[][] = [];
  let spans = whole;
  let kept: number | undefined;
  for (const i of order) {
    if (measure(spans, 1) <= target) break;
    const span = spans[i];
    if (!span) continue;
    const priority = (segments[i] as FitSegment).priority;
    const choices = kept === undefined || priority >= kept ? inOrder : skipping;
    for (const run of prefixes(span)) choices.push(withSpan(spans, i, run));
    if (spans.filter(Boolean).length > 1) {
      const without = withSpan(spans, i, null);
      choices.push(without);
      if (measure(without, 1) >= target * (1 - tolerance)) {
        spans = without;
        continue;
      }
    }
    kept ??= priority;
  }
  const shortening = spans.flatMap((span, i) =>
    span ? prefixes(span).map((run) => withSpan(spans, i, run)) : [],
  );

  const tried: { spans: Span[]; breath: number; length: number }[] = [];
  let best: (typeof tried)[number] | undefined;
  for (const tier of [inOrder, skipping, shortening]) {
    const fits = tier.map((choice) => ({
      spans: choice,
      ...tuneBreath((breath) => measure(choice, breath), target),
    }));
    tried.push(...fits);
    const off = (fit: { length: number }) => Math.abs(fit.length - target);
    const inside = fits.filter((fit) => off(fit) <= target * tolerance);
    if (inside.length === 0) continue;
    const nearest = Math.min(...inside.map(off));
    best = inside.find((fit) => off(fit) <= nearest + target * NEAR);
    break;
  }
  best ??= tried.reduce((a, b) =>
    Math.abs(b.length - target) < Math.abs(a.length - target) ? b : a,
  );
  const passes =
    best.spans.filter((span, i) => span?.[1] !== whole[i]?.[1]).length +
    (best.breath !== 1 ? 1 : 0);
  return { spans: best.spans, breath: best.breath, length: best.length, passes };
}

function withSpan(spans: readonly Span[], i: number, span: Span): Span[] {
  return spans.map((s, k) => (k === i ? span : s));
}

/** Shorter runs of a span's first lines, longest first. */
function prefixes(span: [number, number]): [number, number][] {
  const [from, to] = span;
  const runs: [number, number][] = [];
  for (let last = to - 1; last >= from; last--) runs.push([from, last]);
  return runs;
}

/** The breath in BREATH_RANGE that brings the length nearest `target`, 1 when nothing nearer;
 * length grows with it. */
function tuneBreath(measure: (breath: number) => number, target: number) {
  const at = (breath: number) => ({ breath, length: measure(breath) });
  let [short, long] = BREATH_RANGE;
  const options = [at(1), at(short), at(long)];
  if ((options[1]?.length ?? 0) < target && (options[2]?.length ?? 0) > target) {
    for (let step = 0; step < 20; step++) {
      const mid = (short + long) / 2;
      if (measure(mid) < target) short = mid;
      else long = mid;
    }
    options.push(at(short), at(long));
  }
  return options.reduce((a, b) =>
    Math.abs(b.length - target) < Math.abs(a.length - target) ? b : a,
  );
}
