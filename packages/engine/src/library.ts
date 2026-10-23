// The built-in music library: CC0 tracks an edit plays when the user gives none. The repository
// keeps each track's tags and its music index (assets/music/), so Claude picks a track and the
// planner fits it without the audio; the audio is downloaded on its first use, from the
// fineframe-music repository's release, and checked against its SHA-256.

import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadJson,
  type MusicIndex,
  type Project,
  secondsToTicks,
  TICKS_PER_SECOND,
  ticksPerFrame,
  validateMediaIndex,
  validateMusicIndex,
} from "@video-editor/schema";
import { cacheDir, type DownloadProgress, exists, pinnedFile } from "./download.ts";
import {
  fitMusic,
  loudestSection,
  type MusicInput,
  onBeats,
  outputBeats,
  speechLoudness,
} from "./plan/music.ts";
import { editLength } from "./revise.ts";

/** The moods the library is tagged with, each with 8 tracks. */
export const MOODS = ["calm", "upbeat", "emotional", "corporate", "energetic"] as const;
export type Mood = (typeof MOODS)[number];

/** A track as the catalogue lists it. */
export interface CatalogTrack {
  /** Unique; the audio is `<id>.mp3` and its index `<id>.music.json`. */
  id: string;
  title: string;
  artist: string;
  mood: Mood;
  bytes: number;
  sha256: string;
  /** Where the file came from, as published by its author. */
  source: string;
  /** Where it downloads from. */
  url: string;
  /** Its music index, an absolute path. */
  index: string;
}

/** A track with what its music index says of it. */
export interface LibraryTrack extends CatalogTrack {
  /** Seconds, and beats per minute (null without a steady beat). */
  seconds: number;
  bpm: number | null;
}

interface Catalog {
  license: { name: string; url: string };
  download: string;
  tracks: Omit<CatalogTrack, "url" | "index">[];
}

// Joined rather than a URL of the folder, which the page's bundler would try to bundle.
const FOLDER = join(dirname(fileURLToPath(import.meta.url)), "..", "assets", "music");

/** What a track's credit says beside the licence, in English and Taiwan Chinese: the library's
 * answer to a platform that claims a track. */
export const CLAIM_NOTE = [
  "If a platform claims this track, it is CC0 public domain; dispute the claim with that licence.",
  "若平台對這首曲子提出版權主張：它是 CC0 公眾領域作品，請以這個授權提出申訴。",
] as const;

let catalog: Catalog | null = null;
let tracks: LibraryTrack[] | null = null;

function read(): Catalog {
  catalog ??= JSON.parse(readFileSync(join(FOLDER, "library.json"), "utf8")) as Catalog;
  return catalog;
}

/** Every track as the catalogue lists it, by mood and then title. */
export function catalogTracks(): CatalogTrack[] {
  const { download, tracks } = read();
  return tracks.map((track) => ({
    ...track,
    url: `${download}${track.id}.mp3`,
    index: join(FOLDER, `${track.id}.music.json`),
  }));
}

/** Every track with its length and tempo, by mood and then title. */
export function libraryTracks(): LibraryTrack[] {
  tracks ??= catalogTracks().map((track) => {
    const music = validateMusicIndex(JSON.parse(readFileSync(track.index, "utf8"))) as MusicIndex;
    return { ...track, seconds: music.end, bpm: music.tempo.bpm };
  });
  return tracks;
}

/** The licence every track is under. */
export function libraryLicense(): { name: string; url: string } {
  return read().license;
}

/** Where a track's audio is kept once downloaded. */
export function libraryFile(track: CatalogTrack): string {
  return join(cacheDir(), "music", `${track.id}.mp3`);
}

/** The track whose audio has this SHA-256, if it is the library's. */
export function libraryTrackOf(sha256: string): CatalogTrack | undefined {
  return catalogTracks().find((track) => track.sha256 === sha256);
}

/** A track's audio, downloaded and checked against its SHA-256 if it is not kept yet. */
export function fetchTrack(track: CatalogTrack, onProgress?: DownloadProgress): Promise<string> {
  return pinnedFile(
    track.url,
    track.sha256,
    libraryFile(track),
    `"${track.title}"`,
    0o644,
    onProgress,
  );
}

/** The library as music for the planner: each track's index with where its audio will be, which
 * need not be there yet, its tags, and its download, which `onDownload` hears by the track's
 * title. */
export function libraryMusic(
  onDownload?: (name: string, bytes: number, total: number) => void,
): MusicInput[] {
  return catalogTracks().map((track) => ({
    index: track.index,
    source: libraryFile(track),
    fingerprint: { bytes: track.bytes, sha256: track.sha256 },
    about: `"${track.title}" by ${track.artist}, ${track.mood}`,
    fetch: () =>
      fetchTrack(
        track,
        onDownload ? (bytes, total) => onDownload(track.title, bytes, total) : undefined,
      ),
  }));
}

/** Downloads the library tracks `project` plays that are not kept yet, before it renders. A
 * track not where the library keeps it is left for the render to report. */
export async function fetchLibraryMusic(
  project: Project,
  projectPath: string,
  onDownload?: (name: string, bytes: number, total: number) => void,
): Promise<void> {
  const used = new Set((project.audio.music ?? []).map((track) => track.source));
  const base = dirname(resolve(projectPath));
  for (const source of project.sources) {
    if (!used.has(source.id)) continue;
    const track = libraryTrackOf(source.fingerprint.sha256);
    const path = resolve(base, source.path);
    if (!track || path !== libraryFile(track) || (await exists(path))) continue;
    await fetchTrack(
      track,
      onDownload ? (bytes, total) => onDownload(track.title, bytes, total) : undefined,
    );
  }
}

/**
 * `project`, read from `projectPath`, with its music replaced by the library track `id`, fitted
 * to the edit as the planner fits it: from its loudest section, at the level the speech calls
 * for, ducked under it, with the B-roll's edges moved onto its beats. Null takes the music out
 * and leaves the B-roll where it is. Nothing else changes, so it only renders again.
 */
export async function swapMusic(
  project: Project,
  projectPath: string,
  id: string | null,
): Promise<Project> {
  const out: Project = structuredClone(project);
  const old = new Set((out.audio.music ?? []).map((track) => track.source));
  const kept = new Set(
    [...out.main, ...(out.broll ?? []), ...(out.audio.sfx ?? [])].map((clip) => clip.source),
  );
  out.sources = out.sources.filter(
    (source) => !old.has(source.id) || kept.has(source.id),
  ) as Project["sources"];
  delete out.audio.music;
  if (id === null) return out;
  const track = catalogTracks().find((each) => each.id === id);
  if (!track) throw new Error(`No library track ${JSON.stringify(id)}`);
  const base = dirname(resolve(projectPath));
  const clips = [];
  for (const clip of out.main) {
    const source = out.sources.find((each) => each.id === clip.source);
    if (!source?.index) continue;
    const index = await loadJson(resolve(base, source.index), validateMediaIndex);
    clips.push({ index, in: clip.in, out: clip.out });
  }
  const taken = new Set(out.sources.map((source) => source.id));
  let sourceId = `music-${track.id}`;
  for (let n = 2; taken.has(sourceId); n++) sourceId = `music-${track.id}-${n}`;
  const index = await loadJson(track.index, validateMusicIndex);
  const music = fitMusic(
    {
      id: sourceId,
      path: libraryFile(track),
      indexPath: track.index,
      index,
      fingerprint: { bytes: track.bytes, sha256: track.sha256 },
    },
    loudestSection(index),
    editLength(out) / TICKS_PER_SECOND,
    speechLoudness(clips),
  );
  if (music.length === 0) return out;
  const path = (file: string) => relative(base, file).split(sep).join("/");
  out.sources.push({
    id: sourceId,
    kind: "audio",
    path: path(libraryFile(track)),
    index: path(track.index),
    fingerprint: { bytes: track.bytes, sha256: track.sha256 },
  });
  out.audio.music = music;
  if (out.broll) out.broll = brollOnBeats(out, outputBeats(music, index));
  return out;
}

/** The B-roll of `project` on `beats`, as the planner places it: each shot's start on the
 * nearest beat within reach and its end on the last its length allows, never past its end nor
 * over a picture it was clear of. A shot that would show for under a second stays as it was. */
function brollOnBeats(project: Project, beats: readonly number[]): Project["broll"] {
  const frame = ticksPerFrame(project.output.fps);
  const pictures = [
    ...(project.broll ?? []).map((clip) => ({ start: clip.start, duration: clip.out - clip.in })),
    ...(project.overlays ?? []),
    ...(project.graphics ?? []),
  ].map((picture) => picture.start + picture.duration);
  return project.broll?.map((clip) => {
    const end = clip.start + clip.out - clip.in;
    const free = Math.max(0, ...pictures.filter((before) => before <= clip.start));
    const shot = onBeats(
      { start: clip.start, free, longest: clip.out - clip.in, end },
      beats,
      frame,
    );
    if (shot.length < secondsToTicks(1)) return clip;
    return { ...clip, start: shot.start, out: clip.in + shot.length };
  });
}
