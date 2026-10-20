// Generated from shorts.schema.json by `pnpm gen`; do not edit.

/**
 * The shorts `pnpm edit --shorts` made from one long video, written beside their folders and again as each one finishes.
 */
export interface Shorts {
  version: 1;
  /**
   * How many shorts were asked for. Fewer are made when the footage holds fewer distinct moments.
   */
  asked: number;
  /**
   * The shortest and longest a short may be, in seconds.
   *
   * @minItems 2
   * @maxItems 2
   */
  range: [number, number];
  /**
   * The shorts made so far, best first.
   */
  shorts: Short[];
}
export interface Short {
  /**
   * Its folder beside this file, holding edit.mp4, edit.project.json and edit.srt as a normal edit writes them: 01, 02, …
   */
  folder: string;
  title: string;
  description: string;
  /**
   * @minItems 3
   * @maxItems 5
   */
  hashtags: [string, string, string] | [string, string, string, string] | [string, string, string, string, string];
  /**
   * The footage file it is cut from, as it was given.
   */
  source: string;
  /**
   * Where its stretch of the file starts, in seconds.
   */
  start: number;
  /**
   * Where its stretch ends, in seconds.
   */
  end: number;
  /**
   * The length Claude chose for it within the range, in seconds: the target its video is cut to within 5 %.
   */
  length: number;
  /**
   * Its video's length, in seconds.
   */
  seconds: number;
}
