// The encoder: one process, fed the pieces' frames on stdin and the finished mix from a PCM file.
// Burned-in captions go in its video graph, on the finished picture. Effect overlays are drawn in
// the pieces (piece.ts): each piece opens only the overlays it spans, so memory stays bounded
// however many an edit has.

import type { Project } from "@video-editor/schema";
import { FONTS } from "../captions/index.ts";
import { QUIET } from "../ffmpeg.ts";
import { SAMPLE_RATE } from "../timeline.ts";

/** Raw frames as the pieces write them and the encoder reads them. */
export const RAW_VIDEO = ["-f", "rawvideo", "-pix_fmt", "yuv420p"];
/** Raw samples as the pieces write them and the encoder reads them. */
export const RAW_AUDIO = ["-f", "f32le", "-ar", String(SAMPLE_RATE), "-ac", "2"];

/** BT.709 colour tags, limited range. The encoder reads them on its raw input too: FFmpeg 7.1
 * and later take primaries and transfer from the frames, not from output options, and convert
 * untagged frames, read as BT.601, to an output matrix that differs. */
export const BT709 = [
  "-colorspace",
  "bt709",
  "-color_primaries",
  "bt709",
  "-color_trc",
  "bt709",
  "-color_range",
  "tv",
];

/** The sound's encoding in every output. */
export const AAC = ["-c:a", "aac", "-b:a", "192k", "-ar", String(SAMPLE_RATE)];

/** Samples per AAC-LC frame. */
const AAC_FRAME = 1024;

/**
 * Leads the mix with silence that the MP4 edit list then skips, so that the samples encoded fill
 * whole AAC frames. FFmpeg's MP4 reader honours the edit list's start but not its end, so an
 * encoder's padding at the end would otherwise decode as up to 21 ms of extra sound after the
 * picture ends. The silence carries negative timestamps; the edit list starts at the real audio.
 * The muxer keeps them only if the sound reaches it as soon as the picture does, which is why the
 * mix is finished before encoding.
 */
export function alignToAacFrames(samples: number): string {
  const lead = (AAC_FRAME - (samples % AAC_FRAME)) % AAC_FRAME;
  return lead > 0 ? `adelay=delays=${lead}S:all=1,asetpts=PTS-${lead}` : "anull";
}

/** libass drawing the ASS script `script` over the picture, in the faces stageFonts put in its
 * working folder. libass turns the script's colours into YUV with BT.601 when the matrix is
 * unspecified, so the frames are tagged BT.709 first, as the output is, even if they come
 * untagged. */
export function captionFilter(script: string): string {
  return `setparams=colorspace=bt709:range=tv,ass=filename=${script}:fontsdir=${FONTS}`;
}

/** An image laid over the captions, such as a caption's emoji: a PNG, relative to the encoder's
 * working folder, scaled to `width` × `height` with its top-left corner at (x, y), in output
 * pixels, over output frames [start, end). */
export interface ImageOverlay {
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
  start: number;
  end: number;
}

/** The video graph over the picture: the captions' script, then each image over it on its own
 * frames. Each file at each size is read and scaled once, as an input after the sound. */
function pictureGraph(captions: string | undefined, images: readonly ImageOverlay[]): string[] {
  if (!captions && images.length === 0) return [];
  const graph: string[] = [];
  let picture = "[0:v]";
  if (captions) {
    graph.push(`[0:v]${captionFilter(captions)}${images.length > 0 ? "[c0]" : "[v]"}`);
    picture = "[c0]";
  }
  const sources = [...new Set(images.map(imageSource))];
  for (const [i, source] of sources.entries()) {
    const uses = images.filter((image) => imageSource(image) === source);
    const { width, height } = uses[0] as ImageOverlay;
    const outputs = uses.map((_, k) => `[i${i}u${k}]`).join("");
    // Converted as the picture is tagged, BT.709 limited range, rather than BT.601.
    graph.push(
      `[${2 + i}:v]scale=${width}:${height}:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuva420p,split=${uses.length}${outputs}`,
    );
  }
  const used = sources.map(() => 0);
  for (const [k, image] of images.entries()) {
    const i = sources.indexOf(imageSource(image));
    const over = `[i${i}u${used[i]}]`;
    used[i] = (used[i] as number) + 1;
    const out = k === images.length - 1 ? "[v]" : `[c${k + 1}]`;
    graph.push(
      `${picture}${over}overlay=x=${image.x}:y=${image.y}:enable='between(n,${image.start},${image.end - 1})'${out}`,
    );
    picture = out;
  }
  return graph;
}

const imageSource = (image: ImageOverlay) => `${image.file}@${image.width}x${image.height}`;

/**
 * H.264 High at a CRF that is visually transparent for edited footage, 4:2:0 and tagged BT.709,
 * which every pipeline reshapes to; AAC at 48 kHz; the index at the front for streaming.
 * `captions` names an ASS script, relative to the encoder's working folder, drawn over the
 * picture by libass, and `images` are laid over it.
 */
export function encoderArgs(
  output: Project["output"],
  pcm: string,
  samples: number,
  out: string,
  captions?: string,
  images: readonly ImageOverlay[] = [],
): string[] {
  const { width, height, fps } = output;
  const picture = pictureGraph(captions, images);
  const files = [...new Map(images.map((image) => [imageSource(image), image.file])).values()];
  return [
    ...QUIET,
    "-y",
    ...RAW_VIDEO,
    "-video_size",
    `${width}x${height}`,
    "-framerate",
    `${fps.num}/${fps.den}`,
    ...BT709,
    "-i",
    "pipe:0",
    ...RAW_AUDIO,
    "-i",
    pcm,
    // One frame each, which overlay repeats once it ends: a looped image would be read far ahead
    // of the picture and held in memory until the picture catches up.
    ...files.flatMap((file) => ["-i", file]),
    "-filter_complex",
    [`[1:a]${alignToAacFrames(samples)}[a]`, ...picture].join(";"),
    "-map",
    picture.length > 0 ? "[v]" : "0:v",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    ...BT709,
    ...AAC,
    "-movflags",
    "+faststart",
    // Counts on stdout, ending with the frames encoded, which the render checks.
    "-progress",
    "pipe:1",
    out,
  ];
}
