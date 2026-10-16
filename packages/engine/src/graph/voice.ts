// A clip's speech through its source's voice chain (project.json `audio.voice`), in the chain's
// order: denoise, dereverb, high-pass, EQ, leveller, compressor, de-esser, limiter.

import type { EqBand, VoiceDecision } from "@video-editor/schema";
import { SAMPLE_RATE } from "../timeline.ts";
import { clock } from "./audio.ts";
import { decimal } from "./inputs.ts";

type Chain = VoiceDecision["chain"];

/** An opened input: its stream label and where the chain's first instant falls in it. */
export interface Opened {
  input: string;
  offset: number;
}

/** The chain runs on the mono mix, as vework measured it: FFmpeg and vework's PyAV both mix two
 * channels at -3 dB each, so the levels the chain was chosen from hold. */
const MONO = `aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=mono`;
/** The processed voice in both channels at its mono level. */
const BOTH = "pan=stereo|c0=c0|c1=c0";
/** The dereverb expander's deepest cut, at `amount` 1. */
const TAIL_DB = 12;
/** Seconds the leveller measures at a time. */
const LEVEL_FRAME = 0.2;
const BAND_FILTERS: Record<EqBand["type"], string> = {
  peak: "equalizer",
  lowShelf: "lowshelf",
  highShelf: "highshelf",
};

/**
 * Seconds of the source a clip's chain hears before the clip begins, so that by its first instant
 * the filters are where they would be partway through the source. The leveller needs its whole
 * window: it starts from unity gain and would otherwise swell up after every cut. The other stages
 * settle within a fraction of a second.
 */
export function lead(chain: Chain): number {
  return (chain.level?.windowSeconds ?? 0) + 1;
}

/**
 * Filter graph lines that take a clip's sound through the chain, ending in the returned label.
 * `sound` is the source's sound, or for a chain that denoises its denoised stem, opened `lead`
 * before the clip or at the source's start. Every piece of a clip starts the chain at that same
 * instant, so a clip split between pieces joins sample for sample even through filters that
 * carry state.
 */
export function voiceSound(
  sound: Opened,
  chain: Chain,
  tag: string,
): { lines: string[]; out: string } {
  const lines: string[] = [];
  const steps = stages(chain);
  const mix: string[] = [];
  if (chain.denoise) {
    // The stem holds the recording and its denoised copy from one decode, so they line up
    // sample for sample; the source decoded here can sit a codec's priming away from them.
    // The denoiser's output is linear in the spectrum, so mixing the recording back at the
    // limit lowers no sound by more than the limit, as DeepFilterNet's own limit does.
    const kept = 10 ** (-chain.denoise.attenuationLimitDb / 20);
    mix.push(`pan=mono|c0=${decimal(kept)}*c0+${decimal(1 - kept)}*c1`);
  }
  lines.push(`${[clock(sound.input, sound.offset), ...mix, MONO, ...steps].join(",")}[${tag}c]`);
  const out = `[${tag}v]`;
  // The look-ahead's delay taken out, so the voice stays on its samples.
  const last = [
    ...(chain.limiter
      ? [`alimiter=limit=${level(chain.limiter.ceilingDb)}:attack=5:release=50:level=0:latency=1`]
      : []),
    BOTH,
  ].join(",");
  if (chain.deesser) {
    const { frequencyHz, intensity, thresholdDb } = chain.deesser;
    lines.push(
      `[${tag}c]acrossover=split=${decimal(frequencyHz)}:order=4th[${tag}lo][${tag}hi]`,
      `[${tag}hi]acompressor=threshold=${level(thresholdDb)}:ratio=${decimal(1 + 5 * intensity)}` +
        `:attack=1:release=50:detection=rms[${tag}hc]`,
      `[${tag}lo][${tag}hc]${sum(2)},${last}${out}`,
    );
  } else {
    lines.push(`[${tag}c]${last}${out}`);
  }
  return { lines, out };
}

/** The stages between the denoiser and the de-esser, as one filter chain. */
export function stages(chain: Chain): string[] {
  const filters: string[] = [];
  if (chain.dereverb) {
    const { amount, thresholdDb } = chain.dereverb;
    filters.push(
      `agate=threshold=${level(thresholdDb)}:ratio=2:range=${level(-TAIL_DB * amount)}` +
        ":attack=5:release=80:detection=rms",
    );
  }
  if (chain.highpassHz) filters.push(`highpass=f=${decimal(chain.highpassHz)}`);
  for (const band of chain.eq ?? []) {
    const { frequencyHz, q, gainDb } = band;
    filters.push(
      `${BAND_FILTERS[band.type]}=f=${decimal(frequencyHz)}:t=q:w=${decimal(q)}:g=${decimal(gainDb)}`,
    );
  }
  if (chain.level) {
    const { targetDb, windowSeconds, maxGainDb } = chain.level;
    // The window in 200 ms frames, an odd number as dynaudnorm needs; peaks stay under -0.4 dBFS.
    // No threshold: FFmpeg 7's leaves the frames under it out of the smoothing without
    // renormalising it, which pulls the gain down by tens of dB before every pause.
    const frames = Math.round(windowSeconds / LEVEL_FRAME);
    filters.push(
      `dynaudnorm=f=${LEVEL_FRAME * 1000}:g=${frames | 1}:p=0.95:m=${decimal(10 ** (maxGainDb / 20))}` +
        `:r=${level(targetDb)}`,
    );
  }
  if (chain.compressor) {
    const { thresholdDb, ratio, attackMs, releaseMs, makeupDb } = chain.compressor;
    filters.push(
      `acompressor=threshold=${level(thresholdDb)}:ratio=${decimal(ratio)}` +
        `:attack=${decimal(attackMs)}:release=${decimal(releaseMs)}:detection=rms`,
      // acompressor's own makeup cannot go below 0 dB, and a loud source needs turning down.
      `volume=${decimal(makeupDb)}dB`,
    );
  }
  return filters;
}

/** Two streams added sample for sample. */
function sum(inputs: number): string {
  return `amix=inputs=${inputs}:duration=longest:dropout_transition=0:normalize=0`;
}

/** A level in dB as the linear amplitude FFmpeg's dynamics filters take. */
function level(db: number): string {
  return decimal(10 ** (db / 20));
}
