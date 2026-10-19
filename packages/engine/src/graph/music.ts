// Background music: each track's range at its gain, faded and ducked under speech, mixed into one
// bed. The finished mix adds the bed to the main sound before loudness is measured (see
// ./master.ts), so normalisation covers both and keeps the voice's lead over the music.
import { QUIET } from "../ffmpeg.ts";
import { EDGE_FADE_SAMPLES } from "../pieces.ts";
import { SAMPLE_RATE, type Timeline, type TimelineMusic, ticksToSamples } from "../timeline.ts";
import { soundClock } from "./audio.ts";
import { mix } from "./broll.ts";
import { RAW_AUDIO } from "./encode.ts";

/** Samples per second of a ducking envelope, which FFmpeg resamples to the mix's rate: its ramps
 * take tenths of a second, so a millisecond step is far below anything heard, and an hour's
 * envelope is 14 MB instead of 700. */
export const ENVELOPE_RATE = 1000;
/** Music comes back up in a pause only if it can stay up this long between its release and the
 * next attack; for less it would only pump. */
export const MIN_RISE = 0.5;
/** Speech quieter than the edit's own takes the music down at most this much further. */
export const MAX_RIDE_DB = 12;
/** BS.1770's gates: blocks under the absolute one are silence; the relative one, under a
 * stretch's own mean, drops the dips between words. */
const ABSOLUTE = -70;
const RELATIVE = 10;
/** FFmpeg's momentary loudness: a 400 ms window every 100 ms, value k ending 0.1 s after k's
 * frame starts. */
const STEP = 0.1;
const WINDOW = 0.4;

/** Music fades follow a quarter sine, as dissolves do: a fade-out keeps its body longer than a
 * straight line and then falls away. Edges without a fade get the 5 ms cut fade instead, so a
 * range that stops or starts mid-note does not click. */
const CURVE = "qsin";
const EDGE_CURVE = "hsin";

/**
 * How far the music is ducked at each envelope sample, from 0 (not at all) to 1 (by the full
 * depth), over `seconds` from output time `from`. It is 1 while someone speaks. It starts down
 * `attack` seconds before speech starts, so the first syllable already has the music under it,
 * which a compressor listening to the voice cannot do, and comes back up over `release` after
 * speech ends. Both ramps are raised cosines. Pauses too short for the music to stay up
 * MIN_RISE stay ducked.
 */
export function duckDepth(
  speech: readonly [number, number][],
  from: number,
  seconds: number,
  attack: number,
  release: number,
): Float32Array {
  const spans: [number, number][] = [];
  for (const [start, end] of speech) {
    const last = spans.at(-1);
    if (last && start - last[1] < attack + release + MIN_RISE) last[1] = Math.max(last[1], end);
    else spans.push([start, end]);
  }
  const count = Math.ceil(seconds * ENVELOPE_RATE) + 1;
  const depth = new Float32Array(count);
  for (const [start, end] of spans) {
    const first = Math.max(0, Math.floor((start - attack - from) * ENVELOPE_RATE));
    const last = Math.min(count - 1, Math.ceil((end + release - from) * ENVELOPE_RATE));
    for (let i = first; i <= last; i++) {
      const t = from + i / ENVELOPE_RATE;
      const d =
        t < start
          ? ramp((t - start + attack) / attack)
          : t > end
            ? ramp(1 - (t - end) / release)
            : 1;
      depth[i] = Math.max(depth[i] ?? 0, d);
    }
  }
  return depth;
}

function ramp(x: number): number {
  return x <= 0 ? 0 : x >= 1 ? 1 : (1 - Math.cos(Math.PI * x)) / 2;
}

/** The linear gain a ducking depth curve gives: the depth is followed in decibels, so the ramps
 * sound even. */
export function duckGains(depth: Float32Array, depthDb: number): Float32Array {
  return depth.map((d) => 10 ** ((depthDb * d) / 20));
}

/** FFmpeg's arguments that print the momentary loudness of a raw stereo file every 100 ms. */
export function momentaryArgs(pcm: string): string[] {
  const meter = "ebur128=metadata=1,ametadata=mode=print:key=lavfi.r128.M:file=-";
  return [...QUIET, ...RAW_AUDIO, "-i", pcm, "-af", meter, "-f", "null", "-"];
}

/** The momentary loudness values `momentaryArgs` printed, in LUFS, in order. */
export function parseMomentary(text: string): number[] {
  return [...text.matchAll(/lavfi\.r128\.M=(-?[\d.]+|-?inf)/g)].map((m) =>
    m[1]?.endsWith("inf") ? -Infinity : Number(m[1]),
  );
}

/**
 * How much further than its depth the music ducks under each stretch of `speech`, in dB, from
 * the momentary loudness of the sound it is mixed under: as far as the stretch's speech falls
 * under the speech of the whole edit, up to MAX_RIDE_DB. The planner sets the music under the
 * edit's speech as a whole, so without this a quieter speaker, such as a guest far from the
 * microphone, would have the music that much closer. Both are gated as BS.1770 gates, over the
 * windows that lie inside a stretch, or the one nearest its middle for a stretch shorter than
 * a window.
 */
export function rides(speech: readonly [number, number][], momentary: readonly number[]): number[] {
  const last = momentary.length - 1;
  const windows = speech.map(([start, end]) => {
    // Value k covers [(k + 1) STEP - WINDOW, (k + 1) STEP].
    const first = Math.max(0, Math.ceil((start + WINDOW) / STEP - 1 - 1e-6));
    const final = Math.min(last, Math.floor(end / STEP - 1 + 1e-6));
    if (first <= final) return momentary.slice(first, final + 1);
    const middle = Math.min(last, Math.max(0, Math.round((start + end) / 2 / STEP + 1)));
    return momentary.slice(middle, middle + 1);
  });
  const edit = gatedMean(windows.flat());
  return windows.map((values) => Math.min(MAX_RIDE_DB, Math.max(0, edit - gatedMean(values))));
}

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

/** The gain envelope of a music range, as ENVELOPE_RATE samples from its start, or null when it
 * is not ducked. `ride[k]` (see `rides`) takes the music further down under `speech[k]`; it
 * comes in over the attack, centred between two stretches, so the gain never steps. */
export function envelopeOf(
  track: TimelineMusic,
  speech: Timeline["speech"],
  ride: readonly number[] = [],
): Float32Array | null {
  const { ducking } = track.music;
  if (!ducking) return null;
  const from = track.start / SAMPLE_RATE;
  const attack = ducking.attackMs / 1000;
  const depth = duckDepth(
    speech,
    from,
    track.samples / SAMPLE_RATE,
    attack,
    ducking.releaseMs / 1000,
  );
  const extra = rideCurve(speech, ride, from, depth.length, attack);
  return depth.map((d, i) => 10 ** ((d * (ducking.depthDb - (extra[i] ?? 0))) / 20));
}

/** Each stretch's ride, as `count` ENVELOPE_RATE samples from `from`. Between two stretches
 * the larger ride holds from half an attack before the first ends to half an attack after the
 * second starts; a running mean over the attack then turns each change into a ramp that long,
 * so the music is already down as quieter speech starts and comes back up only once louder
 * speech has. */
function rideCurve(
  speech: readonly [number, number][],
  ride: readonly number[],
  from: number,
  count: number,
  attack: number,
): Float64Array {
  const steps = new Float64Array(count);
  if (!ride.some((r) => r > 0)) return steps;
  const time = (i: number) => from + i / ENVELOPE_RATE;
  let k = 0;
  for (let i = 0; i < count; i++) {
    const t = time(i);
    while (k + 1 < speech.length && t >= (speech[k + 1]?.[0] ?? 0) + attack / 2) k++;
    const next = speech[k + 1];
    const between = next && t >= (speech[k]?.[1] ?? 0) - attack / 2 && t < next[0] + attack / 2;
    steps[i] = Math.max(ride[k] ?? 0, between ? (ride[k + 1] ?? 0) : 0);
  }
  const half = Math.max(1, Math.round((attack * ENVELOPE_RATE) / 2));
  const sums = new Float64Array(count + 1);
  for (let i = 0; i < count; i++) sums[i + 1] = (sums[i] ?? 0) + (steps[i] ?? 0);
  const smooth = new Float64Array(count);
  for (let i = 0; i < count; i++) {
    const lo = Math.max(0, i - half);
    const hi = Math.min(count, i + half + 1);
    smooth[i] = ((sums[hi] ?? 0) - (sums[lo] ?? 0)) / (hi - lo);
  }
  return smooth;
}

/**
 * FFmpeg's arguments for the music bed: exactly `timeline.samples` samples of stereo, as raw
 * samples into `out`. `envelopes[k]` is the file holding the gain envelope of
 * `timeline.music[k]` (mono 32-bit float at ENVELOPE_RATE), or null for a range not ducked. The
 * sound effects join the bed after the music, never ducked.
 *
 * Each track is decoded from its start rather than sought: a variable-bitrate MP3 without a
 * seek table only estimates where a seek lands, which would move the beats the edit's cuts were
 * placed on, and a song takes moments to decode.
 */
export function musicBed(timeline: Timeline, envelopes: (string | null)[], out: string): string[] {
  const args: string[] = [];
  const graph: string[] = [];
  let inputs = 0;
  const ranges = [...timeline.music, ...timeline.sfx];
  for (const [k, track] of ranges.entries()) {
    args.push("-i", track.source.path);
    const sound = inputs++;
    const { samples } = track;
    const chain = [
      soundClock(`[${sound}:a:0]`, 0, ticksToSamples(track.music.in), samples),
      track.fadeIn > 0
        ? `afade=t=in:ss=0:ns=${track.fadeIn}:curve=${CURVE}`
        : `afade=t=in:ss=0:ns=${EDGE_FADE_SAMPLES}:curve=${EDGE_CURVE}`,
      track.fadeOut > 0
        ? `afade=t=out:ss=${samples - track.fadeOut}:ns=${track.fadeOut}:curve=${CURVE}`
        : `afade=t=out:ss=${samples - EDGE_FADE_SAMPLES}:ns=${EDGE_FADE_SAMPLES}:curve=${EDGE_CURVE}`,
      `volume=${track.music.gainDb}dB`,
    ];
    const envelope = envelopes[k];
    if (envelope) {
      args.push("-f", "f32le", "-ar", String(ENVELOPE_RATE), "-ac", "1", "-i", envelope);
      const gain = inputs++;
      // pan copies the gain to both channels as it is; an upmix would lower it by 3 dB.
      graph.push(
        `${chain.join(",")}[s${k}]`,
        `[${gain}:a]aresample=${SAMPLE_RATE},pan=stereo|c0=c0|c1=c0,aformat=sample_fmts=fltp,` +
          `apad=whole_len=${samples},atrim=end_sample=${samples}[g${k}]`,
        `[s${k}][g${k}]amultiply,adelay=delays=${track.start}S:all=1[m${k}]`,
      );
    } else {
      graph.push(`${chain.join(",")},adelay=delays=${track.start}S:all=1[m${k}]`);
    }
  }
  const labels = ranges.map((_, k) => `[m${k}]`).join("");
  const together = ranges.length > 1 ? `${mix(ranges.length, "longest")},` : "";
  graph.push(
    `${labels}${together}apad=whole_len=${timeline.samples},atrim=end_sample=${timeline.samples}[a]`,
  );
  return [
    ...QUIET,
    ...args,
    "-filter_complex",
    graph.join(";"),
    "-map",
    "[a]",
    "-c:a",
    "pcm_f32le",
    ...RAW_AUDIO,
    "-y",
    out,
  ];
}

/** FFmpeg's arguments that add the music bed to the main sound, both raw, into `out`. */
export function addBed(main: string, bed: string, out: string): string[] {
  return [
    ...QUIET,
    ...RAW_AUDIO,
    "-i",
    main,
    ...RAW_AUDIO,
    "-i",
    bed,
    "-filter_complex",
    `[0:a][1:a]${mix(2)}[a]`,
    "-map",
    "[a]",
    "-c:a",
    "pcm_f32le",
    ...RAW_AUDIO,
    "-y",
    out,
  ];
}
