// Chooses each source's voice processing from what vework measured on its speech, and the
// loudness the finished video is normalised to.

import { dirname, resolve } from "node:path";
import {
  type EqBand,
  loadJson,
  type MediaIndex,
  type Project,
  type VoiceDecision,
  type VoiceMeasurement,
  validateMediaIndex,
} from "@video-editor/schema";

type Measured = NonNullable<MediaIndex["voice"]>;
type Levels = Measured["recorded"];

/** Every source's speech is brought to this level before the mix, so one source sounds as loud
 * as the next and the loudness pass moves them together. It leaves headroom under the targets. */
export const SPEECH_LUFS = -20;

/** Speech this far above the room needs nothing removed: after normalisation the room is 50 dB
 * or more below the voice, under what a phone speaker or earbuds let anyone hear. */
const CLEAN_DB = 55;
/** How far the denoiser may lower the room: at least enough to matter, and never so far that
 * its artefacts or a swallowed breath become the thing heard. */
const DENOISE_DB = { least: 6, most: 30 };
/** A room whose reverberation lasts this long is heard on a voice. DeepFilterNet lowers
 * reverberation as well as noise, so such a room is denoised at least DEREVERB_DB however quiet
 * it is: synthetic rooms of 0.5 to 0.7 s read about 0.25 s in its output. */
const ROOM_RT60 = 0.4;
/** When noise hides the recording's reverberation, what the denoiser leaves of it: it leaves
 * synthetic rooms of 0.5 to 0.7 s at 0.23 to 0.25 s, and dry voices in noise at 0.18 s or less. */
const DENOISED_ROOM_RT60 = 0.21;
const DEREVERB_DB = 20;
/** Still heard after denoising: an expander lowers the tail, harder the longer it lasts. */
const TAIL_RT60 = 0.35;
/** The expander leaves alone what is within this far of the speech's level, quiet syllables
 * included; the tail falls through it within a fraction of a second. */
const TAIL_BELOW_DB = 25;

/** Where the voice's spectrum is steered: low-mids (150–500 Hz) 1 dB over the body
 * (500 Hz–2 kHz), where a long-term average speech spectrum has them, and presence (2–5 kHz)
 * 11 dB under it, a dB brighter than that average. Only boom is cut, never added, and moves are
 * bounded, so a measurement that is off cannot ruin a voice. */
const MUD = { target: 1, hz: 300, q: 1, deepest: -4 };
const PRESENCE = { target: -11, hz: 3500, q: 0.8, cut: -3, boost: 4 };
/** A clipped recording keeps its presence: lifting it would sharpen the distortion. */
const CLIPPED_SHARE = 1e-4;

/** A loudness range this wide is a speaker who moves or turns away: a leveller evens it out
 * over 3 s windows before the compressor. Its RMS target sits 4.5 dB over the speech's integrated
 * loudness, which on the synthetic clips left the speech within 1.5 dB of its measured level, so
 * it evens the level without moving it; it raises by at most 12 dB. Clips stepped by 12 dB came
 * out at 3.6 LU. */
const LEVEL = { fromLu: 8, leftLu: 4, rmsOverDb: 4.5, windowSeconds: 3, gainDb: 12 };

/** Compression: 2:1 for an even voice, up to 3:1 as the loudness range grows from 4 to 8 LU;
 * a wider range is levelled first. The threshold sits 2 dB over the speech's own level, so the
 * louder syllables are reduced. */
const RATIO = { least: 2, most: 3, from: 4, per: 4 };
const OVER_DB = 2;
const ATTACK_MS = 10;
const RELEASE_MS = 120;
/** How far this compression lowers the speech's integrated loudness, per unit of 1 - 1/ratio:
 * 4.4 to 6.6 dB on the synthetic clips, clean, noisy and uneven alike. Makeup gain adds it back. */
const COMPRESSION_DB = 5.5;

/** De-essing: above 6 kHz, compressed where it rises within `belowDb` of the common speech
 * level, harder when presence was lifted. */
const DEESS = { hz: 6000, least: 0.3, perDb: 0.1, belowDb: 18 };
/** Peaks held 11 dB over the speech: raised to -14 LUFS they stay under -1 dBTP, so the loudness
 * pass keeps the voice's dynamics with one gain. */
const CEILING_OVER_DB = 11;

/** The loudness to normalise to: -14 LUFS for portrait and square video, which social
 * platforms play at about that, and -16 for landscape long-form; -1 dBTP leaves room for the
 * codec's overshoot. */
export function loudnessFor(aspect: Project["output"]["aspect"]): Project["audio"]["loudness"] {
  return { integratedLufs: aspect === "16:9" ? -16 : -14, truePeakDbtp: -1 };
}

/** The voice processing for one source, from its media index's `voice` measurements. */
export function decideVoice(source: string, measured: Measured): VoiceDecision {
  const { recorded } = measured;
  // Without a second of pause to measure the room in, as in crosstalk, no room is guessed: the
  // denoiser goes as far as it may, and on clean speech it takes off 0.2 dB, so that costs
  // little.
  const snr =
    recorded.noise_floor_db === null ? null : recorded.speech_lufs - recorded.noise_floor_db;
  const reverberant =
    recorded.rt60 === null
      ? (measured.denoised.rt60 ?? 0) >= DENOISED_ROOM_RT60
      : recorded.rt60 >= ROOM_RT60;
  const denoise = snr === null || snr < CLEAN_DB || reverberant;
  // The stages after the denoiser hear the denoised speech.
  const heard: Levels = denoise ? measured.denoised : recorded;
  const chain: VoiceDecision["chain"] = {};
  if (denoise) {
    const limit =
      snr === null ? DENOISE_DB.most : clamp(CLEAN_DB - snr, DENOISE_DB.least, DENOISE_DB.most);
    chain.denoise = {
      attenuationLimitDb: round(reverberant ? Math.max(limit, DEREVERB_DB) : limit),
    };
  }
  if ((heard.rt60 ?? 0) >= TAIL_RT60) {
    chain.dereverb = {
      amount: round(clamp((heard.rt60 ?? 0) - 0.3, 0.1, 1), 2),
      thresholdDb: round(Math.min(heard.speech_lufs - TAIL_BELOW_DB, 0)),
    };
  }
  chain.highpassHz = 80;
  const eq: EqBand[] = [];
  if (heard.mud_db !== null) {
    const gain = clamp(MUD.target - heard.mud_db, MUD.deepest, 0);
    if (gain <= -0.5) eq.push({ type: "peak", frequencyHz: MUD.hz, gainDb: round(gain), q: MUD.q });
  }
  let lift = 0;
  if (heard.presence_db !== null) {
    const clipped = recorded.clipped_share > CLIPPED_SHARE;
    const most = clipped ? 0 : PRESENCE.boost;
    const gain = round(clamp(PRESENCE.target - heard.presence_db, PRESENCE.cut, most));
    if (Math.abs(gain) >= 0.5) {
      eq.push({ type: "peak", frequencyHz: PRESENCE.hz, gainDb: gain, q: PRESENCE.q });
      lift = Math.max(gain, 0);
    }
  }
  if (eq.length > 0) chain.eq = eq;
  let range = heard.loudness_range_lu;
  if (range >= LEVEL.fromLu) {
    chain.level = {
      targetDb: round(Math.min(heard.speech_lufs + LEVEL.rmsOverDb, 0)),
      windowSeconds: LEVEL.windowSeconds,
      maxGainDb: LEVEL.gainDb,
    };
    range = LEVEL.leftLu;
  }
  const ratio = round(
    clamp(RATIO.least + (range - RATIO.from) / RATIO.per, RATIO.least, RATIO.most),
  );
  chain.compressor = {
    thresholdDb: round(clamp(heard.speech_lufs + OVER_DB, -60, 0)),
    ratio,
    attackMs: ATTACK_MS,
    releaseMs: RELEASE_MS,
    makeupDb: round(
      clamp(SPEECH_LUFS - heard.speech_lufs + COMPRESSION_DB * (1 - 1 / ratio), -36, 36),
    ),
  };
  chain.deesser = {
    frequencyHz: DEESS.hz,
    intensity: round(clamp(DEESS.least + DEESS.perDb * lift, 0, 1), 2),
    thresholdDb: SPEECH_LUFS - DEESS.belowDb,
  };
  chain.limiter = { ceilingDb: SPEECH_LUFS + CEILING_OVER_DB };
  return {
    source,
    measurements: {
      recorded: camel(recorded),
      ...(denoise ? { denoised: camel(measured.denoised) } : {}),
    },
    chain,
  };
}

/**
 * The project with a voice decision for every main-track source whose media index measured
 * speech, replacing any it had. The planner calls it before rendering, as it does autoGrade.
 */
export async function planVoice(project: Project, projectPath: string): Promise<Project> {
  const base = dirname(resolve(projectPath));
  const used = new Set(project.main.map((clip) => clip.source));
  const voice: VoiceDecision[] = [];
  for (const source of project.sources) {
    if (!used.has(source.id) || !source.index) continue;
    const index = await loadJson(resolve(base, source.index), validateMediaIndex);
    if (index.voice) voice.push(decideVoice(source.id, index.voice));
  }
  const { voice: _, ...audio } = project.audio;
  return { ...project, audio: voice.length > 0 ? { ...audio, voice } : audio };
}

function camel(levels: Levels): VoiceMeasurement {
  const optional = (key: keyof VoiceMeasurement, value: number | null) =>
    value === null ? {} : { [key]: value };
  return {
    ...optional("noiseFloorDb", levels.noise_floor_db),
    loudnessLufs: levels.speech_lufs,
    loudnessRangeLu: levels.loudness_range_lu,
    clippedShare: levels.clipped_share,
    ...optional("reverbRt60Seconds", levels.rt60),
    ...optional("mudDb", levels.mud_db),
    ...optional("presenceDb", levels.presence_db),
  } as VoiceMeasurement;
}

function clamp(value: number, least: number, most: number): number {
  return Math.min(Math.max(value, least), most);
}

function round(value: number, digits = 1): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
