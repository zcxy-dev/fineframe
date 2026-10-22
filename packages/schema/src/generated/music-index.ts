// Generated from music-index.schema.json by `pnpm gen`; do not edit.

export type Seconds = number;
/**
 * Loudness units relative to full scale, to 0.1; -70 for silence.
 */
export type Lufs = number;

/**
 * What `vework analyze-music` found in one music track, and the licence it is used under: the facts the planner picks and fits music from. Times are seconds from the file's time zero, the container's start time, as in the media index.
 */
export interface MusicIndex {
  version: 1;
  source: {
    /**
     * The file name, without its folder.
     */
    name: string;
    /**
     * Seconds of decoded sound.
     */
    duration: number;
    /**
     * The first audio stream's own rate; the analysis decodes it at 48 kHz.
     */
    sample_rate: number;
    /**
     * The first audio stream's own.
     */
    channels: number;
  };
  /**
   * Why this track may be used, as the person who supplied it stated it; the project copies it and the renderer writes it next to every output that plays the track.
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
  /**
   * The beat tracker and model that found the beats, e.g. beat_this final0; none when the beat model could not be downloaded, which leaves the beats, the downbeats and the tempo empty and the whole track one section.
   */
  tracker: string;
  tempo: {
    /**
     * Beats per minute from the median time over 8 beats; null with fewer than two beats.
     */
    bpm: number | null;
    /**
     * The most common number of beats from one downbeat to the next; null with fewer than two downbeats.
     */
    beats_per_bar: number | null;
  };
  /**
   * Every beat while the track sounds, in time order, to the tracker's 20 ms frames.
   */
  beats: Seconds[];
  /**
   * The beats that start a bar, in time order.
   */
  downbeats: Seconds[];
  /**
   * Consecutive stretches that sound alike, covering the track from 0 to `end`. Every boundary but the first is a downbeat where the bars before and after differ most in loudness and timbre, so a section starts a phrase.
   */
  sections: Section[];
  /**
   * Short-term EBU R128 loudness of every second, as the media index's `short_term`, but measured at the track's own 48 kHz and with its channels weighed apart, as BS.1770 sums them: the track's energy over time.
   */
  loudness: Lufs[];
  /**
   * Where the track's sound dies away: after this, nothing louder than 50 dB under its peak. An edit that ends on the music's ending ends here.
   */
  end: number;
}
export interface Section {
  start: Seconds;
  end: Seconds;
  /**
   * Integrated loudness of the section, gated as BS.1770 gates a programme.
   */
  loudness: number;
}
