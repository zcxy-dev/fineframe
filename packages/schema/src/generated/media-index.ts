// Generated from media-index.schema.json by `pnpm gen`; do not edit.

export type Seconds = number;
/**
 * Loudness units relative to full scale, to 0.1. -70, BS.1770's absolute gate, is the floor: silence or anything quieter.
 */
export type Lufs = number;

/**
 * What `vework analyze` found in one source file: the facts the editing engine plans from. Times are seconds from the file's time zero, the container's start time, not raw stream timestamps.
 */
export interface MediaIndex {
  version: 1;
  source: SourceInfo;
  /**
   * Shot transitions found by TransNetV2, in time order.
   */
  transitions: ShotTransition[];
  /**
   * Stretches of speech found by Silero VAD on the first audio track, in time order. The gaps between them are pauses.
   */
  speech: SpeechSegment[];
  transcript: Transcript;
  /**
   * Present when Claude corrected the transcript before alignment (`vework analyze --correct`): every change it proposed, applied or rejected, in time order. The transcript holds the result.
   */
  corrections?: Correction[];
  loudness?: Loudness;
  /**
   * Laughter, applause and music on the first audio track, found by the CED-Base AudioSet tagger, in order of start. Kinds can overlap: applause over music, music under speech. Empty without audio.
   */
  audio_events?: AudioEvent[];
  framing?: FaceFraming;
  voice?: Voice;
}
export interface SourceInfo {
  /**
   * The file name, without its folder.
   */
  name: string;
  /**
   * Seconds, as the container states it; 0 when it does not.
   */
  duration: number;
  /**
   * The file's time zero, which every other time in the index counts from, as a container timestamp in seconds: where vework's decoder starts the file, which other decoders can place elsewhere. Absent in indexes written before vework recorded it.
   */
  start?: number;
  /**
   * The first video stream that is footage (cover art is not), or null.
   */
  video: VideoStream | null;
  /**
   * Every audio stream, in file order.
   */
  audio: AudioStream[];
}
export interface VideoStream {
  /**
   * Pixels, upright: phone footage stored landscape with a 90° display matrix reports portrait. Pixels that are not square are counted as stored; `sample_aspect` gives their shape.
   */
  width: number;
  /**
   * Pixels, upright, like `width`.
   */
  height: number;
  /**
   * The shape of one pixel as displayed, its width over its height: 1 for square pixels, 4/3 for HDV's 1440 × 1080 shown as 16:9. The picture's shape is width × sample_aspect / height. Absent in indexes written before vework recorded it.
   */
  sample_aspect?: number;
  /**
   * Average frame rate; 0 when the stream states none.
   */
  fps: number;
  /**
   * Degrees counter-clockwise from the display matrix.
   */
  rotation: number;
  /**
   * FFmpeg's codec name, e.g. h264.
   */
  codec: string;
  /**
   * The transfer characteristics the stream is tagged with, as an ITU-T H.273 code point: 1 BT.709, 16 PQ (HDR10), 18 HLG; null when untagged. Absent in indexes written before vework recorded it.
   */
  transfer?: number | null;
  /**
   * The matrix coefficients the stream is tagged with, as an ITU-T H.273 code point: 1 BT.709, 5 and 6 BT.601, 9 BT.2020; null when untagged. Absent in indexes written before vework recorded it.
   */
  matrix?: number | null;
}
export interface AudioStream {
  /**
   * Position among the file's audio streams.
   */
  index: number;
  channels: number;
  sample_rate: number;
  /**
   * The container's language tag as written (often ISO 639-2, e.g. eng or und), or null.
   */
  language: string | null;
}
/**
 * A hard cut has start == end at the new shot's first frame; a dissolve or fade spans [start, end].
 */
export interface ShotTransition {
  start: Seconds;
  end: Seconds;
}
/**
 * Seconds at the VAD's sample resolution, not rounded, so a cut at its edge does not clip a word.
 */
export interface SpeechSegment {
  start: Seconds;
  end: Seconds;
}
/**
 * Qwen3-ASR (or the OpenRouter model in `cloud`), converted to Taiwan Traditional Chinese, corrected by Claude when asked (see `corrections`) and timed by Qwen3-ForcedAligner, each word edge then placed from the audio below its grid. Empty, with a null language, when the file has no speech.
 */
export interface Transcript {
  /**
   * BCP 47 code of the language spoken longest (und when unknown), or null without speech.
   */
  language: string | null;
  /**
   * The transcript as written, one line per transcribed chunk.
   */
  text: string;
  /**
   * In time order: one word per Han character or English word, carrying the punctuation next to it.
   */
  words: Word[];
  /**
   * Present when the speech was heard on OpenRouter (`vework analyze --asr cloud`) rather than by the local speech model; the words are still timed locally.
   */
  cloud?: {
    /**
     * The OpenRouter model slug.
     */
    model: string;
    /**
     * US dollars OpenRouter charged for the transcription.
     */
    cost: number;
    /**
     * The cost per minute of the source's audio track.
     */
    cost_per_minute: number;
  };
}
export interface Word {
  text: string;
  start: Seconds;
  end: Seconds;
}
/**
 * One change Claude proposed to a transcribed chunk.
 */
export interface Correction {
  /**
   * Start of the transcribed chunk the change is in.
   */
  start: number;
  /**
   * End of that chunk.
   */
  end: number;
  /**
   * The transcribed text Claude quoted for the change.
   */
  original: string;
  /**
   * What Claude proposed instead, converted to Taiwan Traditional Chinese.
   */
  corrected: string;
  /**
   * Claude's reason for the change.
   */
  reason: string;
  /**
   * Why vework did not apply the change, or null when it did.
   */
  rejected: string | null;
}
/**
 * EBU R128 loudness of the first audio track, one value per second: value i covers [i, i + 1) s, and a final partial second has one too. Measured at 48 kHz in the track's own channels, weighed as BS.1770 sums them: surround channels by 1.41 and low-frequency effects left out, as FFmpeg's ebur128 filter does. Against that filter's short-term loudness at the source's own rate, every second reads the same to 0.1 LU on the synthetic corpus's speech and drum-and-bass music and on synthetic pink and white noise in mono, stereo and 5.1, at 44.1 and 48 kHz. Empty without audio.
 */
export interface Loudness {
  /**
   * The loudest 400 ms window inside each second, at 100 ms steps: short peaks such as a laugh, a shout or a hit.
   */
  momentary: Lufs[];
  /**
   * The 3 s window centred on each second, shifted inward at the ends of the audio: sustained energy.
   */
  short_term: Lufs[];
}
/**
 * A stretch where the tagger hears one kind of sound. It listens to 2 s windows, one starting every second, and each window stands for the second at its centre, so an edge falls on a half second and can be off by up to 1.5 s, or on an end of the audio and off by up to 2 s.
 */
export interface AudioEvent {
  /**
   * laughter: any kind of laugh. applause: applause, clapping or cheering. music: any music, also under speech.
   */
  kind: "laughter" | "applause" | "music";
  start: Seconds;
  end: Seconds;
  /**
   * The highest probability the tagger gave this kind inside the stretch, 0 to 1.
   */
  confidence: number;
}
/**
 * Faces and who speaks in each shot, for framing the picture in another shape. Faces are found by YuNet in frames sampled `fps` times a second and tracked through each shot; a speaker is the face whose mouth moves most while Silero hears speech. Crop paths are not stored: they depend on the output's shape, and the engine computes them from this. Absent without a picture.
 */
export interface FaceFraming {
  /**
   * Frames sampled per second. Each sample is the frame on screen at its time.
   */
  fps: number;
  /**
   * Back to back from 0 to the end of the picture, in time order, split at each transition: a hard cut's time, a dissolve's middle.
   */
  shots: FramedShot[];
}
export interface FramedShot {
  start: Seconds;
  end: Seconds;
  /**
   * talking_head: one person on camera. two_shot: two people of similar size side by side. group: more than two people on camera. screen_cam: no one on camera but a small face in a corner, such as a webcam over a screen recording. screen: no face that counts.
   */
  layout: "talking_head" | "two_shot" | "group" | "screen_cam" | "screen";
  /**
   * Every face seen in enough of the shot to count, in order of id.
   */
  faces: FaceTrack[];
  /**
   * Who speaks when, in time order and not overlapping. Speech while no face on screen moves its mouth, such as a voice-over, has no span.
   */
  speakers: SpeakerSpan[];
}
/**
 * One person's face through one shot.
 */
export interface FaceTrack {
  /**
   * Unique in the index, so speaker spans can name the face. The same person in another shot has another id.
   */
  id: number;
  /**
   * The face in each sample it was found in, in time order. Samples where the detector missed it are left out.
   *
   * @minItems 1
   */
  boxes: [FaceBox, ...FaceBox[]];
}
/**
 * A face's box at one sample: 0..1 of the displayed picture's width and height, from its top-left corner, as a project's crop rects are, cut off at the picture's edges.
 */
export interface FaceBox {
  /**
   * The sample's time.
   */
  t: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface SpeakerSpan {
  /**
   * The id of the face that speaks.
   */
  face: number;
  start: Seconds;
  end: Seconds;
}
/**
 * The first audio track's speech as voice processing needs it: measured as recorded, and a copy with its noise removed, measured again, which the renderer plays instead of the track. Present when the track has speech. Measured on the track's mono mix at 48 kHz; the mix adds two channels at -3 dB each, so a voice centred in stereo reads 3 dB above either channel.
 */
export interface Voice {
  /**
   * The recording beside its denoised speech: the name of a 48 kHz two-channel 32-bit float WAV in the index's folder. Channel 0 is the track's mono mix as measured here, channel 1 the same with its noise removed in full. Both come from one decode, so they line up sample for sample, which two decoders need not do: they differ in the codec priming they drop. Its sample 0 is the source's time zero, and it runs as long as the track. The renderer plays it instead of the track, mixing the recording back in to limit how far noise is lowered.
   */
  stem: string;
  /**
   * The denoiser: DeepFilterNet3, run with ONNX Runtime.
   */
  model: "DeepFilterNet3";
  recorded: VoiceLevels;
  denoised: VoiceLevels;
}
export interface VoiceLevels {
  /**
   * The room between words: the median RMS level, in dB FS, of the 50 ms windows at least 0.2 s from speech. Null with less than 1 s of them. -120 is digital silence.
   */
  noise_floor_db: number | null;
  /**
   * Integrated loudness of the speech: BS.1770 with its gates, over the 400 ms windows centred in speech. -70 when they are all quieter than that.
   */
  speech_lufs: number;
  /**
   * EBU Tech 3342 loudness range of the whole track: how far its loud and quiet stretches lie apart. Uneven levels read high.
   */
  loudness_range_lu: number;
  /**
   * The share of the track's sample instants at which any channel is within 0.1 dB of full scale, counted as decoded, before the mono mix. Denoising does not undo clipping, so the denoised speech repeats the recording's figure.
   */
  clipped_share: number;
  /**
   * Reverberation time, seconds: how long the room takes to fall 60 dB, read from the steepest falls of the 500 Hz–4 kHz level after stretches of speech that a pause follows (worker/README.md#voice has its accuracy). Null with fewer than five falls 15 dB clear of the noise.
   */
  rt60: number | null;
  /**
   * The 150–500 Hz band against the 500 Hz–2 kHz band of the speech's average spectrum, in dB: a boomy or boxy voice reads high. Null without speech energy there.
   */
  mud_db: number | null;
  /**
   * The 2–5 kHz band against the 500 Hz–2 kHz band, in dB: a dull or muffled voice reads low.
   */
  presence_db: number | null;
}
