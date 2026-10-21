// What an editing app reads from each file the edit plays: its size, rate, length and sound.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type FrameRate, secondsToTicks, TICKS_PER_SECOND } from "@video-editor/schema";
import type { SourceFacts } from "../sources.ts";

/** A file as the timeline files describe it. */
export interface Media {
  /** The source's id. */
  id: string;
  kind: SourceFacts["kind"];
  /** Absolute, where the file is on this computer. */
  path: string;
  /** The picture's size as displayed: rotated upright, with square pixels; 0 for sound alone. */
  width: number;
  height: number;
  /** The picture's frame rate; null for an image and for sound alone. */
  rate: FrameRate | null;
  /** Ticks; 0 for an image. */
  duration: number;
  /** Source ticks at the file's first frame, as an editing app counts from: the container's
   * start against the media index's time zero. */
  start: number;
  /** The time its start timecode stands for, in ticks, on its frame grid: an editing app counts
   * the file's time from it. 0 without one. */
  timecode: number;
  /** Sound channels, 0 without sound, and its sample rate. */
  channels: number;
  sampleRate: number;
}

interface Probe {
  streams: {
    codec_type: string;
    width?: number;
    height?: number;
    sample_aspect_ratio?: string;
    r_frame_rate?: string;
    start_time?: string;
    channels?: number;
    sample_rate?: string;
    side_data_list?: { rotation?: number }[];
    tags?: { rotate?: string; timecode?: string };
  }[];
  format: { duration?: string; tags?: { timecode?: string } };
}

/** The media facts of a source, read with ffprobe at `probe`. */
export async function readMedia(source: SourceFacts, probe: string): Promise<Media> {
  const { stdout } = await promisify(execFile)(
    probe,
    ["-v", "error", "-show_streams", "-show_format", "-of", "json", source.path],
    { maxBuffer: 16 * 1024 * 1024 },
  );
  return mediaOf(source, JSON.parse(stdout) as Probe);
}

/** The media facts ffprobe's JSON gives. */
function mediaOf(source: Pick<SourceFacts, "id" | "kind" | "path" | "zero">, probe: Probe): Media {
  const video =
    source.kind === "audio" ? undefined : probe.streams.find((s) => s.codec_type === "video");
  const audio = probe.streams.find((s) => s.codec_type === "audio");
  let width = 0;
  let height = 0;
  if (video?.width && video.height) {
    const [n, d] = (video.sample_aspect_ratio ?? "1:1").split(":").map(Number);
    const aspect = n && d ? n / d : 1;
    const rotation =
      video.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ??
      Number(video.tags?.rotate ?? 0);
    width = Math.round(video.width * aspect);
    height = video.height;
    if (Math.abs(rotation) % 180 === 90) [width, height] = [height, width];
  }
  const rate = source.kind === "video" && video?.r_frame_rate ? fraction(video.r_frame_rate) : null;
  const seconds = Number(probe.format.duration ?? 0);
  const first = Number(video?.start_time ?? audio?.start_time ?? 0);
  return {
    id: source.id,
    kind: source.kind,
    path: source.path,
    width,
    height,
    rate,
    duration: source.kind === "image" || !Number.isFinite(seconds) ? 0 : secondsToTicks(seconds),
    start: source.kind === "video" ? secondsToTicks(first - source.zero) : 0,
    timecode: rate ? timecodeTicks(timecodeOf(probe) ?? "", rate) : 0,
    channels: audio?.channels ?? 0,
    sampleRate: Number(audio?.sample_rate ?? 48_000),
  };
}

function fraction(text: string): FrameRate | null {
  const [num, den] = text.split("/").map(Number);
  return num && den ? { num, den } : null;
}

/** The file's start timecode, as its video stream, a timecode track or its container tags it. */
function timecodeOf(probe: Probe): string | undefined {
  return probe.streams.find((s) => s.tags?.timecode)?.tags?.timecode ?? probe.format.tags?.timecode;
}

/**
 * The ticks a timecode such as `01:00:00:00` stands for at `rate`: its frame count, the frame
 * rate's whole frames a second per second, then each frame at the real rate. Drop-frame
 * timecode (`;` before the frames) at 29.97 and 59.94 skips 2 or 4 frame numbers each minute
 * but every tenth. 0 for anything else.
 */
export function timecodeTicks(text: string, rate: FrameRate): number {
  const match = text.match(/^(\d+):(\d\d):(\d\d)([:;.,])(\d\d)$/);
  if (!match) return 0;
  const [h, m, s, , f] = [1, 2, 3, 4, 5].map((i) => Number(match[i]));
  const base = Math.round(rate.num / rate.den);
  const drop = (match[4] === ";" || match[4] === ",") && rate.den === 1001 ? (base / 30) * 2 : 0;
  const minutes = (h ?? 0) * 60 + (m ?? 0);
  const count =
    (minutes * 60 + (s ?? 0)) * base + (f ?? 0) - drop * (minutes - Math.floor(minutes / 10));
  const grid = (TICKS_PER_SECOND * rate.den) / rate.num;
  return Number.isInteger(grid)
    ? count * grid
    : Math.round((count * TICKS_PER_SECOND * rate.den) / rate.num);
}
