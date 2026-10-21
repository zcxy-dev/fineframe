// Generated from project.schema.json by `pnpm gen`; do not edit.

export type PositiveTicks = number;
/**
 * A path relative to the project file, with forward slashes.
 */
export type RelativePath = string;
export type SourceId = string;
/**
 * A time or length in ticks: 120 000 per second, so every common frame rate has a whole number of ticks per frame.
 */
export type Ticks = number;
/**
 * `#rrggbb`.
 */
export type Colour = string;
/**
 * One of the bundled faces by its id, or a TrueType or OpenType file.
 */
export type BrandFont =
  | {
      id:
        | "noto-sans-tc"
        | "noto-serif-tc"
        | "lxgw-wenkai-tc"
        | "jf-openhuninn"
        | "iansui"
        | "chocolate-classical-sans"
        | "cactus-classical-serif"
        | "lxgw-marker-gothic";
    }
  | BrandFile;

/**
 * One edit, complete enough to render the same video again from this file and the source files. Every position or length on a timeline is integer ticks, 120 000 per second; processing parameters carry their unit in their name (attackMs, gainDb). Paths are relative to the project file.
 */
export interface Project {
  version: 1;
  output: Output;
  /**
   * @minItems 1
   */
  sources: [Source, ...Source[]];
  /**
   * The main track, in play order.
   *
   * @minItems 1
   */
  main: [Clip, ...Clip[]];
  /**
   * B-roll and picture-in-picture over the main track, drawn in array order. The main track's audio keeps playing under it.
   */
  broll?: BrollClip[];
  /**
   * Motion graphics written for this edit, as HTML and CSS that packages/effects renders: labels and lower thirds over the picture, panels and full-frame graphics cut to as B-roll. Over the main track and B-roll and under the overlays, drawn in array order.
   */
  graphics?: Graphic[];
  captions?: Captions;
  /**
   * Animated effects over the picture and B-roll and under the captions, drawn in array order.
   */
  overlays?: Overlay[];
  audio: Audio;
  plan?: Plan;
  brand?: Brand;
}
export interface Output {
  aspect: "9:16" | "1:1" | "16:9";
  /**
   * Pixels; even, as 4:2:0 video needs, and in the aspect ratio.
   */
  width: number;
  height: number;
  fps: FrameRate;
  /**
   * The length that was asked for.
   */
  target: {
    duration: PositiveTicks;
    /**
     * How far the edit may land from the target, as a fraction of it: 0.05 is ±5 %.
     */
    tolerance: number;
  };
}
/**
 * Frames per second as an exact fraction, e.g. 30000/1001 for 29.97. 120 000 × den must be divisible by num, so a frame lasts a whole number of ticks.
 */
export interface FrameRate {
  num: number;
  den: number;
}
export interface Source {
  /**
   * Unique in the project; clips and decisions name their source by it.
   */
  id: string;
  kind: "video" | "audio" | "image";
  path: RelativePath;
  /**
   * A path relative to the project file, with forward slashes.
   */
  index?: string;
  /**
   * Identifies the exact file the edit was planned on, so a render from a changed file fails instead of drifting.
   */
  fingerprint: {
    bytes: number;
    /**
     * SHA-256 of the whole file, lowercase hex.
     */
    sha256: string;
  };
  credit?: Credit;
}
/**
 * Where B-roll or a sound effect came from and the credit it asks for; the renderer lists those the video plays in <name>.broll.txt beside it.
 */
export interface Credit {
  /**
   * What it is, such as "Video by Jane Doe on Pexels" or "Screenshot of example.com".
   */
  what: string;
  /**
   * The page it came from.
   */
  source: string;
  /**
   * The licence it is used under; absent for a screenshot, whose page keeps its owner's rights.
   */
  license?: {
    name: string;
    url: string;
  };
  /**
   * Who made it, when the source names them.
   */
  by?: {
    name: string;
    url?: string;
  };
  /**
   * A note the credit must carry, such as a trademark's.
   */
  note?: string;
}
/**
 * A range of one source on the main track.
 */
export interface Clip {
  source: SourceId;
  /**
   * Source time where the clip starts.
   */
  in: number;
  /**
   * Source time where the clip ends, exclusive; after in.
   */
  out: number;
  /**
   * How this clip follows the one before it; absent is a hard cut. The first clip has none.
   */
  transition?: Dissolve | Dip;
  framing?: Framing;
  grade?: Grade;
}
/**
 * Picture and sound cross-fade: the last `duration` ticks of the clip before overlap the first `duration` ticks of this clip.
 */
export interface Dissolve {
  type: "dissolve";
  duration: PositiveTicks;
}
/**
 * The clip before fades to `color`, picture and sound, over its last floor(duration / 2) ticks, and this clip fades in from it over the rest of `duration`, so each fade is whole ticks long. The clips do not overlap.
 */
export interface Dip {
  type: "dip";
  duration: PositiveTicks;
  color: string;
}
/**
 * Which part of the source fills the area it is shown in: the output frame, or a B-roll clip's rect. Without framing, the largest centred region with that area's shape is used. A crop of another shape is narrowed around its centre to match.
 */
export interface Framing {
  crop?: StaticCrop | CropPath;
  /**
   * Punch-in: shows 1/scale of the crop, e.g. 1.25 to hide a jump cut; a path pushes in over time, or changes the scale at a cut.
   */
  scale?: number | ScalePath;
  /**
   * The point a punch-in zooms about, which stays where it is on screen: the speaker's face, as fractions of the crop's width and height once narrowed to the area's shape. The crop's centre when absent.
   */
  anchor?: {
    x: number;
    y: number;
  };
}
export interface StaticCrop {
  type: "static";
  rect: CropRect;
  below?: CropRect;
}
/**
 * The part of the source a crop shows, in fractions of the source's displayed width and height, from its top-left corner. It may reach past the picture's edges, so that a subject the picture cuts off keeps room around it, or the whole picture shows in an area of another shape; there a blurred copy of the picture, enlarged to cover the area, shows instead. Some of it lies on the picture. `below`, when given, splits the area into a top and a bottom half: `rect` fills the top and `below` the bottom.
 */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
/**
 * A moving crop: linear between keyframes, held before the first and after the last. Its rects keep their size, and `below` stays present or absent, except across a cut: two keyframes a tick apart.
 */
export interface CropPath {
  type: "path";
  /**
   * @minItems 2
   */
  keyframes: [CropKeyframe, CropKeyframe, ...CropKeyframe[]];
}
export interface CropKeyframe {
  /**
   * Source time, increasing from one keyframe to the next.
   */
  t: number;
  rect: CropRect;
  below?: CropRect;
}
/**
 * A slow push-in: the scale eases between keyframes along half a cosine, so it starts and stops without a jolt, and is held before the first and after the last. Two keyframes a tick apart change the scale at a cut.
 */
export interface ScalePath {
  type: "path";
  /**
   * @minItems 2
   */
  keyframes: [ScaleKeyframe, ScaleKeyframe, ...ScaleKeyframe[]];
}
export interface ScaleKeyframe {
  /**
   * Source time, increasing from one keyframe to the next.
   */
  t: number;
  scale: number;
}
/**
 * Colour, applied in this order: auto, match, look.
 */
export interface Grade {
  /**
   * The bounded per-clip correction measured from the clip itself, as FFmpeg's eq filter takes it; 1 leaves a value unchanged.
   */
  auto?: {
    contrast: number;
    gamma: number;
    saturation: number;
  };
  /**
   * Brings this source's colour toward a reference source: rgb' = matrix × rgb + offset, on normalised R'G'B', except that skin tones change hue and saturation only within the limits packages/engine/README.md gives.
   */
  match?: {
    reference: SourceId;
    /**
     * @minItems 3
     * @maxItems 3
     */
    matrix: [[number, number, number], [number, number, number], [number, number, number]];
    /**
     * @minItems 3
     * @maxItems 3
     */
    offset: [number, number, number];
  };
  /**
   * A designed look on top: a preset id from the engine's look catalog, at an intensity from 0 (none) to 1 (as designed).
   */
  look?: {
    id: string;
    intensity: number;
  };
}
/**
 * A source range over the main track. `rect` places it in the output frame; without one it fills the frame.
 */
export interface BrollClip {
  source: SourceId;
  in: Ticks;
  out: Ticks;
  /**
   * A time or length in ticks: 120 000 per second, so every common frame rate has a whole number of ticks per frame.
   */
  start: number;
  rect?: Rect;
  /**
   * Fade in and out over this many ticks; absent cuts in and out.
   */
  fade?: number;
  /**
   * Mix the B-roll's own sound at this gain; absent mutes it.
   */
  gainDb?: number;
  framing?: Framing;
  grade?: Grade;
}
/**
 * A B-roll clip's place in the output frame, in fractions of its width and height, from its top-left corner.
 */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Graphic {
  /**
   * label: a chip over the picture; lower-third: a pill low on one side over the picture; panel: the upper panel of a split screen, the top 880 of every 1920 rows at 9:16; full: the whole frame.
   */
  layout: "label" | "lower-third" | "panel" | "full";
  /**
   * Its markup, laid out in a box the size of the frame (the panel's for a panel), with --u 1 % of the frame's short side. No scripts, images or url().
   */
  html: string;
  /**
   * Its own styles beside the house stylesheet in packages/effects, its parts' CSS entrance animations among them.
   */
  css: string;
  box?: Rect1;
  /**
   * The spoken words it shows, by source and word index in that source's media index: it goes when a cut takes any of them out.
   */
  words?: {
    source: SourceId;
    word: number;
  }[];
  /**
   * A time or length in ticks: 120 000 per second, so every common frame rate has a whole number of ticks per frame.
   */
  start: number;
  duration: PositiveTicks;
}
/**
 * A B-roll clip's place in the output frame, in fractions of its width and height, from its top-left corner.
 */
export interface Rect1 {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Captions {
  /**
   * The caption style, drawn by the preset of that id in packages/engine: bold (word by word, the word being spoken in amber), creator (a few words at a time, big, in a box, with numbers and English words in amber), minimal (small white type), pop (each word pops in as it is said) or none (no captions on the picture; the SubRip file is still written).
   */
  preset: "bold" | "creator" | "minimal" | "pop" | "none";
  /**
   * Also write the lines as SubRip next to the video.
   */
  srt: boolean;
  /**
   * In time order, on the output timeline.
   */
  lines: CaptionLine[];
}
export interface CaptionLine {
  start: Ticks;
  end: Ticks;
  /**
   * The line's main language.
   */
  language: string;
  /**
   * The line as shown and as the SubRip export writes it, punctuation included.
   */
  text: string;
  /**
   * The line's words with their times, for word-by-word animation; their texts appear in `text` in this order.
   */
  words?: CaptionWord[];
}
export interface CaptionWord {
  text: string;
  start: Ticks;
  end: Ticks;
  /**
   * Set when the word is in another language than its line, e.g. an English word in a Mandarin sentence.
   */
  language?: string;
}
export interface Overlay {
  /**
   * The effect template's id, from the catalog in packages/effects.
   */
  template: string;
  /**
   * The template's parameters, as its JSON Schema in that catalog defines them.
   */
  params: {
    [k: string]: unknown;
  };
  /**
   * A time or length in ticks: 120 000 per second, so every common frame rate has a whole number of ticks per frame.
   */
  start: number;
  duration: PositiveTicks;
}
export interface Audio {
  /**
   * The finished mix is normalised to this, within the ranges EBU R128 normalisation (FFmpeg's loudnorm) accepts.
   */
  loudness: {
    integratedLufs: number;
    truePeakDbtp: number;
  };
  /**
   * How each source's speech is processed; a source not listed is used as recorded.
   */
  voice?: VoiceDecision[];
  /**
   * Background music, mixed under the main track's sound.
   */
  music?: MusicTrack[];
  /**
   * Sound effects on visible actions, mixed under the voice with the music and not ducked.
   */
  sfx?: SoundEffect[];
}
/**
 * How one source's speech is processed on the main track, chosen from its measurements. The chain runs on the mono mix of the source's sound, which then plays in both channels.
 */
export interface VoiceDecision {
  source: SourceId;
  /**
   * The source's speech as its media index measured it (`voice`), which the chain was chosen from: as recorded, and denoised when the chain denoises, for the stages after the denoiser.
   */
  measurements: {
    recorded: VoiceMeasurement;
    denoised?: VoiceMeasurement;
  };
  /**
   * Stages run in this order; an absent stage is skipped.
   */
  chain: {
    /**
     * Plays the denoised speech from the source's media index (`voice.stem`) instead of its sound, with the recording beside it in the stem mixed back in to keep the noise at most `attenuationLimitDb` lower than it was, so breaths and the room stay natural.
     */
    denoise?: {
      attenuationLimitDb: number;
    };
    /**
     * A gentle downward expander: below `thresholdDb` the room's tail after words is lowered 2:1, by at most 12 dB × `amount`. Speech stays above the threshold.
     */
    dereverb?: {
      amount: number;
      thresholdDb: number;
    };
    /**
     * A second-order high-pass.
     */
    highpassHz?: number;
    eq?: EqBand[];
    /**
     * A slow leveller (FFmpeg's dynaudnorm) that evens out a speaker who moves or turns away: over a sliding `windowSeconds`, the level is brought towards `targetDb` RMS and raised by at most `maxGainDb`. Each moment takes the smallest gain around it, so a pause does not lift the end of the phrase before it.
     */
    level?: {
      targetDb: number;
      windowSeconds: number;
      maxGainDb: number;
    };
    /**
     * An RMS compressor, then `makeupDb` of gain, which also brings every source's speech to one level before the mix.
     */
    compressor?: {
      thresholdDb: number;
      ratio: number;
      attackMs: number;
      releaseMs: number;
      makeupDb: number;
    };
    /**
     * The sound above `frequencyHz` is compressed on its own where it rises over `thresholdDb`, at a ratio of 1 + 5 × `intensity`; the split sums back flat.
     */
    deesser?: {
      frequencyHz: number;
      intensity: number;
      thresholdDb: number;
    };
    /**
     * A peak limiter, last: no sample goes over `ceilingDb`, so the loudness pass can raise the voice with one gain instead of limiting it dynamically itself.
     */
    limiter?: {
      ceilingDb: number;
    };
  };
}
/**
 * One measurement of speech, as media-index.schema.json defines it (`VoiceLevels`); a value the index has as null is absent.
 */
export interface VoiceMeasurement {
  noiseFloorDb?: number;
  loudnessLufs: number;
  loudnessRangeLu: number;
  clippedShare: number;
  reverbRt60Seconds?: number;
  mudDb?: number;
  presenceDb?: number;
}
export interface EqBand {
  type: "peak" | "lowShelf" | "highShelf";
  frequencyHz: number;
  gainDb: number;
  q: number;
}
export interface MusicTrack {
  source: SourceId;
  /**
   * Why this track may be used; it is recorded next to the output.
   */
  license: {
    /**
     * e.g. CC BY 4.0, or the library's licence name.
     */
    name: string;
    url?: string;
    /**
     * The credit line the licence asks for.
     */
    attribution?: string;
  };
  in: Ticks;
  out: Ticks;
  /**
   * A time or length in ticks: 120 000 per second, so every common frame rate has a whole number of ticks per frame.
   */
  start: number;
  gainDb: number;
  fadeIn?: PositiveTicks;
  fadeOut?: PositiveTicks;
  /**
   * Lowers the music while someone speaks; absent leaves it at gainDb.
   */
  ducking?: {
    /**
     * How far the music drops below gainDb while someone speaks as loud as the edit's speech as a whole; the renderer takes it further down, by up to 12 dB more, under speech quieter than that.
     */
    depthDb: number;
    attackMs: number;
    releaseMs: number;
  };
  /**
   * The beat grid cuts were snapped to, from the track's analysis, so the check can verify them.
   */
  beatGrid?: {
    bpm: number;
    /**
     * A time or length in ticks: 120 000 per second, so every common frame rate has a whole number of ticks per frame.
     */
    downbeat: number;
    beatsPerBar: number;
  };
}
/**
 * A short sound, played whole from its start, for at most 2 s.
 */
export interface SoundEffect {
  source: SourceId;
  /**
   * A time or length in ticks: 120 000 per second, so every common frame rate has a whole number of ticks per frame.
   */
  start: number;
  gainDb: number;
}
/**
 * How the planner arrived at this edit, for review; rendering ignores it.
 */
export interface Plan {
  /**
   * The model that planned the edit, e.g. claude-opus-5-5.
   */
  model: string;
  rationale: string;
  /**
   * Source material left out, and why.
   */
  dropped: Dropped[];
  /**
   * How the edit was fitted to the target length.
   */
  fit: {
    /**
     * A time or length in ticks: 120 000 per second, so every common frame rate has a whole number of ticks per frame.
     */
    duration: number;
    /**
     * Rounds of trimming or adding it took to land within the tolerance.
     */
    passes: number;
  };
  /**
   * Moments the planner marks as the edit's strongest beats, in time order, where a punch-in or an effect can land.
   */
  emphasis?: Emphasis[];
}
export interface Dropped {
  source: SourceId;
  in: Ticks;
  out: Ticks;
  kind: "filler" | "pause" | "retake" | "mistake" | "length" | "other";
  reason: string;
}
export interface Emphasis {
  /**
   * A time or length in ticks: 120 000 per second, so every common frame rate has a whole number of ticks per frame.
   */
  start: number;
  end: Ticks;
  /**
   * The words that carry it, as spoken.
   */
  text: string;
  reason: string;
}
/**
 * The brand kit the edit is rendered in; without it, the house look. Applied at render time alone: the plan and the graphics' markup do not depend on it.
 */
export interface Brand {
  name: string;
  /**
   * Primary replaces the amber accent; secondary and accent replace its deeper and lighter tones, which are made from the primary when left out.
   */
  colors: {
    primary: Colour;
    secondary?: Colour;
    accent?: Colour;
  };
  /**
   * The face of the graphics and titles, and of the captions; each left out keeps the house face. A character a face lacks is drawn in Noto Sans TC.
   */
  fonts?: {
    graphics?: BrandFont;
    captions?: BrandFont;
  };
  /**
   * The logo, a PNG or an SVG, and the watermark it is drawn as through the whole video when `show` is true: in a corner, as large as a square whose side is `size` of the frame's shorter side, at `opacity`.
   */
  logo?: {
    file: BrandFile;
    show: boolean;
    corner: "top-left" | "top-right" | "bottom-left" | "bottom-right";
    size: number;
    opacity: number;
  };
  captions?: BrandCaptions;
}
export interface BrandFile {
  path: RelativePath;
  /**
   * SHA-256 of the file, lowercase hex; a render from a changed file fails. An edit fills it in when it copies the kit.
   */
  sha256?: string;
}
/**
 * Custom captions: a drawn caption style with its size, colours, outline or box, place and rows changed. They replace captions.preset's look unless that is none.
 */
export interface BrandCaptions {
  /**
   * The caption style it starts from.
   */
  style: "bold" | "creator" | "minimal" | "pop";
  /**
   * Small, medium (the style's own) or large.
   */
  size: "S" | "M" | "L";
  text: Colour;
  /**
   * `#rrggbb`.
   */
  highlight: string;
  /**
   * A dark outline around the letters, or a dark box behind the caption.
   */
  frame: "outline" | "box";
  position: "bottom" | "middle" | "top";
  /**
   * The most rows a caption holds.
   */
  lines: number;
}
