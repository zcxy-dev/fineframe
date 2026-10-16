// Generated from progress.schema.json by `pnpm gen`; do not edit.

/**
 * One line of `pnpm edit` progress.
 */
export type Progress = StageProgress | DoneProgress;
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
}
export interface DoneProgress {
  stage: "done";
  fraction: 1;
  message: string;
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
  };
}
