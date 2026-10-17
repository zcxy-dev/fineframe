// Packs a media index into the compact transcript the planner reads.

import type { MediaIndex, Word } from "@video-editor/schema";
import type { FillerCandidate } from "./fillers.ts";
import { endsSentence, joinWords } from "./text.ts";

/** A silence this long ends a phrase. */
const PHRASE_SILENCE = 0.5;
/** Pauses at least this long are listed in a file's summary. */
const LONG_PAUSE = 2;
/** Momentary loudness this far above a file's median marks an energy peak. */
const PEAK_LU = 6;
const MAX_LISTED = 12;

/** One numbered transcript line: words of one source between two places code can cut. */
export interface Line {
  source: string;
  /** 1-based, in time order within its source. */
  n: number;
  /** Word indices, inclusive. */
  first: number;
  last: number;
}

/**
 * Groups a transcript into lines: a new line starts after a silence of PHRASE_SILENCE or more,
 * and also after a sentence's last word when the pause after it is at least `cutGap`, long
 * enough to cut in, so a short edit can start or stop at any sentence.
 */
export function splitLines(source: string, words: readonly Word[], cutGap: number): Line[] {
  const lines: Line[] = [];
  let first = 0;
  for (let i = 0; i < words.length; i++) {
    const word = words[i] as Word;
    const next = words[i + 1];
    const gap = next ? next.start - word.end : Number.POSITIVE_INFINITY;
    if (gap >= PHRASE_SILENCE || (gap >= cutGap && endsSentence(word.text))) {
      lines.push({ source, n: lines.length + 1, first, last: i });
      first = i + 1;
    }
  }
  return lines;
}

/** Seconds, fixed width so lines align: 004.20. */
export function formatTime(seconds: number): string {
  return seconds.toFixed(2).padStart(6, "0");
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} m ${(seconds - minutes * 60).toFixed(1).padStart(4, "0")} s`;
}

/** Seconds of speech the transcript covers: the sum of its lines. */
export function speechSeconds(words: readonly Word[], lines: readonly Line[]): number {
  return lines.reduce(
    (sum, line) => sum + (words[line.last] as Word).end - (words[line.first] as Word).start,
    0,
  );
}

/**
 * One file as the planner reads it: a header with its picture, sound, loudness and audio
 * events, then its numbered lines, `12 [034.20-038.95] text`, with each filler candidate marked
 * `⟨f3 那個⟩`. A file without speech is listed as B-roll, without lines. The header names the
 * file when its id could not keep the name, so the model still reads 訪談 where the id is file-1.
 */
export function packSource(
  id: string,
  index: MediaIndex,
  lines: readonly Line[],
  fillers: readonly FillerCandidate[],
  name = id,
): string {
  const words = index.transcript.words;
  const { source } = index;
  const out: string[] = [];
  const named = name === id ? "" : `${name}, `;
  const kind = lines.length === 0 ? ", no speech: B-roll" : "";
  out.push(`## ${id} (${named}${formatDuration(source.duration)}${kind})`);
  if (source.video) {
    const { width, height, fps } = source.video;
    out.push(`Picture: ${width}x${height}, ${Math.round(fps * 100) / 100} fps; ${shots(index)}`);
    const screens = screenSpans(index);
    if (screens.length > 0) {
      const listed = screens.map(([a, b]) => `${a.toFixed(1)}-${b.toFixed(1)}`).join(", ");
      out.push(`Screen recording: ${listed} s`);
    }
  } else {
    out.push("Picture: none (audio only)");
  }
  if (lines.length > 0) {
    const share = Math.round((100 * speechSeconds(words, lines)) / Math.max(source.duration, 1));
    out.push(`Speech: ${share} % of the file; ${pauses(index)}`);
  }
  const loud = loudness(index);
  if (loud) out.push(`Loudness: ${loud}`);
  const events = index.audio_events ?? [];
  if (events.length > 0) {
    const listed = events
      .slice(0, MAX_LISTED)
      .map((e) => `${e.kind} ${e.start.toFixed(1)}-${e.end.toFixed(1)} s (${e.confidence})`);
    out.push(`Audio events: ${listed.join(", ")}`);
  }
  if (lines.length === 0) return out.join("\n");

  const marked = new Map(fillers.map((filler) => [filler.first, filler]));
  out.push("Lines:");
  for (const line of lines) {
    const texts: string[] = [];
    for (let i = line.first; i <= line.last; i++) {
      const filler = marked.get(i);
      if (filler && filler.last <= line.last) {
        texts.push(
          `⟨${filler.id} ${joinWords(words.slice(i, filler.last + 1).map((w) => w.text))}⟩`,
        );
        i = filler.last;
      } else {
        texts.push((words[i] as Word).text);
      }
    }
    const start = (words[line.first] as Word).start;
    const end = (words[line.last] as Word).end;
    out.push(`${line.n} [${formatTime(start)}-${formatTime(end)}] ${joinWords(texts)}`);
  }
  return out.join("\n");
}

/** A still image as the planner reads it: B-roll that holds for as long as it is shown. */
export function packStill(id: string, name: string, seconds: number): string {
  const named = name === id ? "" : `${name}, `;
  return `## ${id} (${named}a still image: B-roll for up to ${seconds} s)`;
}

/** Where a file shows a screen recording, with or without a webcam in a corner, by the shots its
 * framing found, in seconds; next to each other, they are one stretch. */
export function screenSpans(index: MediaIndex): [number, number][] {
  const spans: [number, number][] = [];
  for (const shot of index.framing?.shots ?? []) {
    if (shot.layout !== "screen" && shot.layout !== "screen_cam") continue;
    const last = spans.at(-1);
    if (last && shot.start - last[1] < 1e-6) last[1] = shot.end;
    else spans.push([shot.start, shot.end]);
  }
  return spans;
}

function shots(index: MediaIndex): string {
  const cuts = index.transitions;
  if (cuts.length === 0) return "one unbroken shot";
  const listed = cuts
    .slice(0, MAX_LISTED * 2)
    .map((t) =>
      t.end > t.start ? `${t.start.toFixed(1)}-${t.end.toFixed(1)} (gradual)` : t.start.toFixed(1),
    );
  const more = cuts.length > listed.length ? ` and ${cuts.length - listed.length} more` : "";
  return `shot changes at ${listed.join(", ")} s${more}`;
}

function pauses(index: MediaIndex): string {
  const { speech, source } = index;
  const gaps: string[] = [];
  let previous = 0;
  for (const segment of [...speech, { start: source.duration, end: source.duration }]) {
    if (segment.start - previous >= LONG_PAUSE) {
      gaps.push(`${previous.toFixed(1)}-${segment.start.toFixed(1)}`);
    }
    previous = Math.max(previous, segment.end);
  }
  if (gaps.length === 0) return `no pause of ${LONG_PAUSE} s or more`;
  return `pauses of ${LONG_PAUSE} s or more at ${gaps.slice(0, MAX_LISTED).join(", ")} s`;
}

function loudness(index: MediaIndex): string | null {
  const short = index.loudness?.short_term ?? [];
  const momentary = index.loudness?.momentary ?? [];
  const audible = short.filter((value) => value > -70).sort((a, b) => a - b);
  if (audible.length === 0) return null;
  const median = audible[Math.floor(audible.length / 2)] as number;
  const peaks = momentary
    .map((value, second) => ({ value, second }))
    .filter((p) => p.value >= median + PEAK_LU)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_LISTED)
    .sort((a, b) => a.second - b.second)
    .map((p) => `${p.second} s (${p.value})`);
  const listed = peaks.length > 0 ? `; peaks at ${peaks.join(", ")}` : "";
  return `median ${median} LUFS short-term${listed}`;
}
