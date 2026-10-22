// Generated from progress.schema.json by `pnpm gen`; do not edit.

/**
 * One line of `pnpm edit` progress.
 */
export type Progress = StageProgress | ShortProgress | DoneProgress | ShortsDoneProgress;
/**
 * How much of the whole run is finished, 0 to 1.
 */
export type Fraction = number;

export interface StageProgress {
  stage: "analyze" | "plan" | "render" | "check" | "error";
  /**
   * The source file the stage is working on, as it was given.
   */
  file?: string;
  fraction: Fraction;
  /**
   * One line for a person to read; on error, what went wrong.
   */
  message: string;
  /**
   * A model or program downloading on its first use, while it downloads: a model the analysis runs, FFmpeg, or Chrome Headless Shell for the effects; or a link's video, named by its title, and yt-dlp, which fetches it.
   */
  download?: {
    /**
     * The model, as its repository names it, the program, or the video's title.
     */
    name: string;
    /**
     * Bytes downloaded so far.
     */
    bytes: number;
    /**
     * Bytes to download in all.
     */
    total: number;
  };
  /**
   * The analysis's step for the file named, in the order vework takes them: reading it, shots, speech (voice activity), loudness, audio events, faces, removing noise from the speech, transcribing, correcting the transcript and timing its words; music for a track's analysis. A step vework has nothing to do for is skipped.
   */
  step?:
    | "probe"
    | "shots"
    | "speech"
    | "loudness"
    | "events"
    | "faces"
    | "denoise"
    | "transcribe"
    | "correct"
    | "align"
    | "music";
  claude?: ClaudeCost;
  short?: ShortNumber;
}
/**
 * What Claude cost by stage: finding the moments of a --shorts run, planning, writing and fixing the motion graphics, and the review after each render with the decisions it escalates. A --shorts run sums its shorts, those given up on included. On the done line, a short's line, and an error line once a request was made.
 */
export interface ClaudeCost {
  find?: Spend;
  plan: Spend;
  graphics?: Spend;
  check: Spend;
}
export interface Spend {
  /**
   * US dollars at list price; null when a model's price is unknown.
   */
  dollars: number | null;
  requests: number;
}
/**
 * With --shorts, the short the line is about: the nth of those to make.
 */
export interface ShortNumber {
  n: number;
  of: number;
}
/**
 * With --shorts, a short finished: shorts.json already lists it.
 */
export interface ShortProgress {
  stage: "short";
  fraction: Fraction;
  message: string;
  short: ShortNumber;
  claude?: ClaudeCost;
}
export interface DoneProgress {
  stage: "done";
  fraction: 1;
  message: string;
  claude?: ClaudeCost;
  /**
   * Why the video plays no music although Claude chose a library track: its audio could not be downloaded or did not match its SHA-256. The edit is otherwise whole.
   */
  musicSkipped?: string;
  /**
   * Which music tracks the person gave were analysed without beats, and why: the beat model could not be downloaded. Their music plays from the track's start, not fitted to its bars, and B-roll is not cut on its beats. The edit is otherwise whole.
   */
  beatsSkipped?: string;
  /**
   * Absolute paths of what the run wrote.
   */
  outputs: {
    video: string;
    project: string;
    /**
     * The SubRip file, when the project asks for one.
     */
    captions?: string;
    /**
     * The licence of each music track the video plays, when it plays music.
     */
    music?: string;
    /**
     * Where each piece of B-roll and each sound effect the video plays came from, when it plays any with a credit.
     */
    broll?: string;
  };
}
/**
 * With --shorts, the last line of a run that made at least one short.
 */
export interface ShortsDoneProgress {
  stage: "done";
  fraction: 1;
  message: string;
  claude?: ClaudeCost;
  outputs: {
    /**
     * The absolute path of shorts.json.
     */
    shorts: string;
  };
}
