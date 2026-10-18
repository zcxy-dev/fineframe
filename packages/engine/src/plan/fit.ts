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
 * 4. When none of those lands within the tolerance, which happens when whole lines are long
 *    beside it, changes to several segments of the last choice together may: of those that land
 *    within it, the one that loses the fewest lines of the most important priority wins.
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
  best ??= anyChanges(segments, spans, measure, target, tolerance);
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

/**
 * Any changes to `spans` together, each segment whole, on its first lines or dropped, that land
 * within the tolerance: the choice that loses the fewest lines of priority 1, then of 2 and so
 * on, the nearest of equals. Each segment's change is measured alone and the changes add up by
 * dynamic programming over lengths in steps of a hundredth of the tolerance, so this stays quick
 * for long edits; the best choices whose sums come near the target are then measured whole.
 */
function anyChanges(
  segments: readonly FitSegment[],
  spans: readonly Span[],
  measure: (spans: readonly Span[], breath: number) => number,
  target: number,
  tolerance: number,
) {
  const base = measure(spans, 1);
  const levels = [...new Set(segments.map((s) => s.priority))].sort((a, b) => a - b);
  const step = (target * tolerance) / 100;
  // A choice up to some segment: its spans from the last back, its change in length and the
  // lines it loses at each level.
  interface Draft {
    span: Span;
    from: Draft | undefined;
    delta: number;
    lost: number[];
  }
  const fewer = (p: { lost: number[] }, q: { lost: number[] }) => {
    const level = p.lost.findIndex((n, k) => n !== q.lost[k]);
    return level >= 0 && (p.lost[level] as number) < (q.lost[level] as number);
  };
  const changes = segments.map((segment, i) => {
    const whole: [number, number] = [0, segment.lines - 1];
    const options = segment.lines > 0 ? [whole, ...prefixes(whole), null] : [null];
    return options.map((span) => ({
      span,
      delta: span?.[1] === spans[i]?.[1] ? 0 : measure(withSpan(spans, i, span), 1) - base,
      lost: segment.lines - ((span?.[1] ?? -1) + 1),
    }));
  });
  // Twice the tolerance, for the breath and for joins the changes share.
  const slack = 2 * target * tolerance;
  // How far the segments from each on can still move the length, so a choice that can
  // no longer end within the slack is dropped.
  const reach = [{ least: 0, most: 0 }];
  for (const options of changes.toReversed()) {
    const deltas = options.map((change) => change.delta);
    const after = reach[0] as { least: number; most: number };
    reach.unshift({
      least: after.least + Math.min(...deltas),
      most: after.most + Math.max(...deltas),
    });
  }
  const start: Draft = { span: null, from: undefined, delta: 0, lost: levels.map(() => 0) };
  let drafts = [start];
  for (const [i, segment] of segments.entries()) {
    const { least, most } = reach[i + 1] as { least: number; most: number };
    // Of the choices whose lengths round to the same step, the one losing the fewest.
    const next = new Map<number, Draft>();
    for (const from of drafts) {
      for (const { span, delta, lost } of changes[i] ?? []) {
        const off = base + from.delta + delta - target;
        if (off + least > slack || off + most < -slack) continue;
        const draft: Draft = {
          span,
          from,
          delta: from.delta + delta,
          lost: from.lost.map((n, k) => (levels[k] === segment.priority ? n + lost : n)),
        };
        const key = Math.round(draft.delta / step);
        const held = next.get(key);
        if (!held || fewer(draft, held)) next.set(key, draft);
      }
    }
    drafts = [...next.values()];
  }
  const near = drafts
    .map((draft) => ({
      draft,
      lost: draft.lost,
      off: Math.abs(base + draft.delta - target),
    }))
    .sort((p, q) => (fewer(p, q) ? -1 : fewer(q, p) ? 1 : p.off - q.off));
  for (const { draft } of near) {
    const choice: Span[] = [];
    for (let at = draft; at.from; at = at.from) choice.unshift(at.span);
    const fit = { spans: choice, ...tuneBreath((breath) => measure(choice, breath), target) };
    if (Math.abs(fit.length - target) <= target * tolerance) return fit;
  }
  return undefined;
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
