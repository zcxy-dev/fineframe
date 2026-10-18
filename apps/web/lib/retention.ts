// How much of each edit stays on disk, which the page also tells its owner.

/** Finished projects whose footage is kept, newest first, so they can be edited again. */
export const FOOTAGE_KEPT = 5;

/** Versions of an edit whose video is kept, newest first; every version keeps its record, from
 * which an older one renders again. */
export const VIDEOS_KEPT = 3;
