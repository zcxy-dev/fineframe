import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  type FaceFraming,
  type FrameRate,
  loadJson,
  type MediaIndex,
  type Project,
  type Source,
  ticksPerFrame,
  type VoiceDecision,
  validateMediaIndex,
} from "@video-editor/schema";
import { displayAspect } from "./framing.ts";

/** What the renderer needs to know about one source file. */
export interface SourceFacts {
  id: string;
  kind: Source["kind"];
  /** Absolute. */
  path: string;
  /** Whether the file has an audio stream; the first one is the source's sound. */
  audio: boolean;
  /** PQ or HLG footage, which is tone-mapped to BT.709. */
  hdr: "pq" | "hlg" | null;
  /** The matrix an SDR stream that does not name its own is read with: BT.709 at HD sizes and
   * BT.601 below, as players assume. Null when the stream names it, and for images. */
  matrix: "bt709" | "bt601" | null;
  /** How many ticks one source frame lasts, when its frame rate is one whose frames are whole
   * ticks; null for images and for other or variable rates, which have no grid to snap to. */
  frameTicks: number | null;
  /** Seconds, as the media index states it; 0 when unknown. */
  duration: number;
  /** The container timestamp, in seconds, that source time counts from: the media index's time
   * zero. 0 for images and music, which are not seeked by it. */
  zero: number;
  /** The faces the media index found, which captions keep clear of, with the picture's displayed
   * width over its height; null for images and indexes without faces. */
  faces: { framing: FaceFraming; aspect: number } | null;
  /** Where someone speaks, as [start, end] seconds of source time from the media index's speech
   * detection; empty for images and music. */
  speech: [number, number][];
  /** The source's voice chain, and its stem (absolute), the recording beside its denoised speech,
   * when the chain denoises; null without a voice decision. */
  voice: { chain: VoiceDecision["chain"]; stem: string | null } | null;
}

// ITU-T H.273 transfer characteristics, as the media index records them.
const PQ = 16;
const HLG = 18;

/** The facts a media index gives about its source. */
export function factsFromIndex(source: Source, path: string, index: MediaIndex): SourceFacts {
  const video = index.source.video;
  if (!video) throw new Error(`${source.id}: its media index lists no video stream`);
  if (video.transfer === undefined || video.matrix === undefined) {
    throw new Error(
      `${source.id}: its media index predates colour information; run vework analyze again`,
    );
  }
  if (video.sample_aspect === undefined) {
    throw new Error(
      `${source.id}: its media index predates its pixel shape; run vework analyze again`,
    );
  }
  if (index.source.start === undefined) {
    throw new Error(
      `${source.id}: its media index predates its time zero; run vework analyze again`,
    );
  }
  // The size as stored, before the display matrix turns it, which is what players judge by.
  const [width, height] =
    video.rotation % 180 === 0 ? [video.width, video.height] : [video.height, video.width];
  return {
    id: source.id,
    kind: source.kind,
    path,
    audio: index.source.audio.length > 0,
    hdr: video.transfer === PQ ? "pq" : video.transfer === HLG ? "hlg" : null,
    // mpv's rule for footage that does not say.
    matrix: video.matrix !== null ? null : width >= 1280 || height > 576 ? "bt709" : "bt601",
    frameTicks: gridTicks(video.fps),
    duration: index.source.duration,
    zero: index.source.start,
    faces:
      index.framing && video.height > 0
        ? {
            framing: index.framing,
            aspect: displayAspect(video.width, video.height, video.sample_aspect),
          }
        : null,
    speech: index.speech.map((segment) => [segment.start, segment.end]),
    voice: null,
  };
}

/** The frame length in ticks of a measured average rate, if it is a whole-tick rate such as
 * 30000/1001; a variable rate's average rarely is, and then there is no grid. */
export function gridTicks(fps: number): number | null {
  for (const den of [1, 1001]) {
    const rate: FrameRate = { num: Math.round(fps * den), den };
    if (rate.num < 1 || Math.abs(rate.num / den - fps) > 0.005) continue;
    try {
      return ticksPerFrame(rate);
    } catch {}
  }
  return null;
}

/** Reads the facts of every source the main track, B-roll and music use, after checking that
 * each file is the one the edit was planned on. A voice decision applies to the source's sound on
 * the main track. */
export async function loadSources(
  project: Project,
  projectPath: string,
): Promise<Map<string, SourceFacts>> {
  const base = dirname(resolve(projectPath));
  const used = new Set(
    [...project.main, ...(project.broll ?? []), ...(project.audio.music ?? [])].map(
      (clip) => clip.source,
    ),
  );
  const decisions = new Map((project.audio.voice ?? []).map((voice) => [voice.source, voice]));
  const facts = await Promise.all(
    project.sources
      .filter((source) => used.has(source.id))
      .map(async (source) => {
        const path = resolve(base, source.path);
        await checkFingerprint(source, path);
        if (source.kind !== "video") {
          // Images have no sound, and music only its sound: neither needs an index to render.
          const { id, kind } = source;
          return {
            ...{ id, kind, path, audio: kind === "audio", hdr: null, matrix: null },
            ...{ frameTicks: null, duration: 0, zero: 0, faces: null, speech: [], voice: null },
          };
        }
        if (!source.index) {
          throw new Error(
            `${source.id}: no media index; the renderer reads a video's audio, colour and ` +
              `frame rate from it (vework analyze ${source.path})`,
          );
        }
        const indexPath = resolve(base, source.index);
        const index = await loadJson(indexPath, validateMediaIndex);
        const facts = factsFromIndex(source, path, index);
        const decision = decisions.get(source.id);
        if (decision && facts.audio) facts.voice = await voiceOf(decision, index, indexPath);
        return facts;
      }),
  );
  return new Map(facts.map((fact) => [fact.id, fact]));
}

/** The size and SHA-256 that identify a file, as a project's sources record them. */
export async function fingerprintOf(path: string): Promise<Source["fingerprint"]> {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    bytes += (chunk as Buffer).length;
  }
  return { bytes, sha256: hash.digest("hex") };
}

async function voiceOf(
  decision: VoiceDecision,
  index: MediaIndex,
  indexPath: string,
): Promise<SourceFacts["voice"]> {
  const { chain } = decision;
  if (!chain.denoise) return { chain, stem: null };
  const name = `${decision.source}: its voice chain denoises`;
  if (!index.voice) {
    throw new Error(
      `${name}, but its media index has no denoised speech; run vework analyze again`,
    );
  }
  const stem = resolve(dirname(indexPath), index.voice.stem);
  await access(stem).catch(() => {
    throw new Error(
      `${name}, but ${stem}, its denoised speech, is missing; run vework analyze again`,
    );
  });
  return { chain, stem };
}

async function checkFingerprint(source: Source, path: string): Promise<void> {
  const { bytes, sha256 } = source.fingerprint;
  const size = (await stat(path)).size;
  if (size !== bytes) {
    throw new Error(`${source.id}: ${source.path} is ${size} bytes, not the ${bytes} planned on`);
  }
  if ((await fingerprintOf(path)).sha256 !== sha256) {
    throw new Error(`${source.id}: ${source.path} changed since the edit was planned`);
  }
}
