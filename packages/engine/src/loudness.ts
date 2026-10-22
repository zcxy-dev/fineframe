// Loudness arithmetic shared by the planner, which sets the music under the speech, and the
// renderer, which rides it further down under quieter speech.

/** BS.1770's gates: blocks under the absolute one are silence; the relative one, under a
 * stretch's own mean, drops the dips between words. */
const ABSOLUTE = -70;
const RELATIVE = 10;

/** BS.1770's gated mean of loudness values: the power mean of those above ABSOLUTE and within
 * RELATIVE of their own mean; ABSOLUTE for silence. */
export function gatedMean(values: readonly number[]): number {
  const heard = values.filter((v) => v > ABSOLUTE);
  const mean = (list: readonly number[]) =>
    10 * Math.log10(list.reduce((sum, v) => sum + 10 ** (v / 10), 0) / list.length);
  if (heard.length === 0) return ABSOLUTE;
  const level = mean(heard);
  return mean(heard.filter((v) => v >= level - RELATIVE));
}
