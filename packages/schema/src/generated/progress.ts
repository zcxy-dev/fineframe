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
  /**
   * A model the analysis is downloading on its first use, while it downloads.
   */
  download?: {
    /**
     * The model, as its repository names it.
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
  claude?: ClaudeCost;
}
/**
 * What Claude cost by stage: planning, and the review after each render with the decisions it escalates. On the done line, and on an error line once a request was made.
 */
export interface ClaudeCost {
  plan: Spend;
  check: Spend;
}
export interface Spend {
  /**
   * US dollars at list price; null when a model's price is unknown.
   */
  dollars: number | null;
  requests: number;
}
export interface DoneProgress {
  stage: "done";
  fraction: 1;
  message: string;
  claude?: ClaudeCost;
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
