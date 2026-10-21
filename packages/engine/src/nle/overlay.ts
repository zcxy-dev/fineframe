// The edit's graphics, effect overlays and watermark alone, over transparency, as one video the
// length of the edit, for an editing app to lay over the footage.

import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ResolvedBrand } from "../brand/kit.ts";
import { QUIET, run } from "../ffmpeg.ts";
import { BT709 } from "../graph/encode.ts";
import { pieceOverlay, RAW_OVERLAY } from "../graph/piece.ts";
import { cutPieces } from "../pieces.ts";
import { encode } from "../render.ts";
import type { Timeline } from "../timeline.ts";

/** Whether the edit draws anything over its footage but captions: a graphic, an effect overlay
 * or a watermark. */
export function hasOverlay(timeline: Timeline, brand: ResolvedBrand | null): boolean {
  return timeline.graphics.length + timeline.overlays.length > 0 || !!brand?.watermark;
}

/**
 * FFmpeg's arguments for ProRes 4444 with its alpha in a QuickTime file, which Final Cut,
 * Resolve and Premiere read with their transparency, from raw frames on stdin.
 */
function overlayEncoderArgs(output: Timeline["output"], out: string): string[] {
  const { width, height, fps } = output;
  return [
    ...QUIET,
    "-y",
    ...RAW_OVERLAY,
    "-video_size",
    `${width}x${height}`,
    "-framerate",
    `${fps.num}/${fps.den}`,
    ...BT709,
    "-i",
    "pipe:0",
    "-c:v",
    "prores_ks",
    "-profile:v",
    "4444",
    "-pix_fmt",
    "yuva444p10le",
    "-alpha_bits",
    "16",
    "-vendor",
    "apl0",
    ...BT709,
    "-progress",
    "pipe:1",
    out,
  ];
}

/** Writes the overlay video to `out`, piece by piece as the render draws them, from the
 * rendered files of `timeline.overlays` and `timeline.graphics`. */
export async function renderOverlay(
  timeline: Timeline,
  files: { overlays: string[]; graphics: string[] },
  brand: ResolvedBrand | null,
  bin: string,
  out: string,
  onProgress: (fraction: number, message: string) => void = () => {},
): Promise<void> {
  const pieces = cutPieces(timeline);
  const work = await mkdtemp(join(dirname(out), ".overlay-"));
  try {
    const partial = join(work, "overlay.mov");
    const frames = await encode(
      bin,
      overlayEncoderArgs(timeline.output, partial),
      { cwd: work, env: process.env },
      async (stdin) => {
        for (const [i, piece] of pieces.entries()) {
          onProgress(i / pieces.length, `Drawing the overlay ${i + 1}/${pieces.length}`);
          const args = pieceOverlay(
            piece,
            timeline,
            files.overlays,
            files.graphics,
            brand?.watermark ?? null,
          );
          const at = args.indexOf("-filter_complex");
          const graph = join(work, "graph.txt");
          await writeFile(graph, args[at + 1] ?? "");
          args.splice(at, 2, "-/filter_complex", graph);
          await run(bin, args, stdin);
        }
      },
    );
    if (frames !== timeline.frames) {
      throw new Error(`The overlay has ${frames} frames, expected ${timeline.frames}`);
    }
    await rename(partial, out);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
