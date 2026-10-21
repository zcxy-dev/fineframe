// Where each caption goes so that it does not cover a face, or a visual drawn over the picture.

/** Faces on screen over output frames [start, end), as boxes in output pixels. */
export interface FaceZone {
  start: number;
  end: number;
  boxes: { x0: number; y0: number; x1: number; y1: number }[];
  /** A visual rather than a face: a caption covers a face before it covers this. */
  hard?: boolean;
}

/** A caption's drawn extent in output pixels, when it shows, and the main-track clip it starts
 * in. */
export interface Block {
  start: number;
  end: number;
  shot: number;
  left: number;
  right: number;
  height: number;
}

// Room a face keeps around it: some to the sides, more above (hair) than below (chin), and a gap
// between it and a caption, as fractions of the face's size and in pixels.
const FACE_PAD_X = 0.15;
const FACE_PAD_TOP = 0.25;
const FACE_PAD_BOTTOM = 0.12;
const MAX_FACE_PAD_BOTTOM = 40;
const FACE_GAP = 12;

/**
 * The bottom edge of each caption. A caption sits at `bottom`, or where `bottom` puts a caption of
 * its height, unless that covers a face on screen
 * while it shows; then it moves just below or above the faces, whichever is nearer, inside
 * `band` (top and bottom edges in pixels). A caption keeps the bottom edge of the one before it
 * in the same shot while that stays clear, so captions do not hop between phrases. If no spot is
 * clear, the one covering the least face wins, among those that cover no visual if any does not.
 */
export function placeBlocks(
  blocks: Block[],
  bottom: number | ((height: number) => number),
  band: [number, number],
  faces: FaceZone[],
): number[] {
  let last: { shot: number; bottom: number } | null = null;
  return blocks.map((block) => {
    const half = block.height / 2;
    const anchor = (typeof bottom === "number" ? bottom : bottom(block.height)) - half;
    const covered: [number, number][] = [];
    const clear: [number, number][] = [];
    const blocked: [number, number][] = [];
    for (const zone of faces) {
      if (zone.end <= block.start || zone.start >= block.end) continue;
      for (const { x0, y0, x1, y1 } of zone.boxes) {
        const w = x1 - x0;
        const h = y1 - y0;
        if (zone.hard) {
          if (x1 <= block.left || x0 >= block.right) continue;
          blocked.push([y0 - FACE_GAP, y1 + FACE_GAP]);
          continue;
        }
        if (x1 + w * FACE_PAD_X <= block.left || x0 - w * FACE_PAD_X >= block.right) continue;
        covered.push([y0, y1]);
        clear.push([
          y0 - h * FACE_PAD_TOP - FACE_GAP,
          y1 + Math.min(h * FACE_PAD_BOTTOM, MAX_FACE_PAD_BOTTOM) + FACE_GAP,
        ]);
      }
    }
    let top = band[0] + half;
    let low = band[1] - half;
    if (top > low) top = low = (band[0] + band[1]) / 2;
    const inBand = (centre: number) => Math.min(Math.max(centre, top), low);
    const overlap = (centre: number, spans: [number, number][]) =>
      spans.reduce(
        (sum, [a, b]) => sum + Math.max(0, Math.min(centre + half, b) - Math.max(centre - half, a)),
        0,
      );
    // [centre, tier]: the previous spot beats the anchor, which beats the rest.
    const candidates: [number, number][] = [[anchor, 1]];
    // The previous caption's bottom edge, so a caption of one row under one of two lines up with
    // its last row.
    if (last?.shot === block.shot) candidates.push([inBand(last.bottom - half), 0]);
    for (const [a, b] of [...clear, ...blocked]) {
      candidates.push([inBand(b + half), 2], [inBand(a - half), 2]);
    }
    candidates.push([top, 2], [low, 2]);
    const score = ([centre, tier]: [number, number]) => [
      overlap(centre, blocked),
      4 * overlap(centre, covered) + overlap(centre, clear),
      tier,
      Math.abs(centre - anchor),
    ];
    let best = candidates[0] as [number, number];
    for (const candidate of candidates.slice(1)) {
      const [a, b] = [score(candidate), score(best)];
      const better = a.findIndex((value, i) => value !== b[i]);
      if (better >= 0 && (a[better] as number) < (b[better] as number)) best = candidate;
    }
    last = { shot: block.shot, bottom: best[0] + half };
    return best[0] + half;
  });
}
