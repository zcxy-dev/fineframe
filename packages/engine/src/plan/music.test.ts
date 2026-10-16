import assert from "node:assert/strict";
import { test } from "node:test";
import type { MediaIndex, MusicIndex, MusicTrack } from "@video-editor/schema";
import { gatedMean } from "../graph/music.ts";
import { SECOND } from "../testing.ts";
import { SPEECH_LUFS } from "../voice.ts";
import {
  fitMusic,
  lastBeat,
  type MusicSource,
  outputBeats,
  PHRASE,
  snapToBeat,
  speechLoudness,
  UNDER_PAUSES,
  UNDER_SPEECH,
} from "./music.ts";

const BEAT = 60 / 112;
const BAR = 4 * BEAT;

/** A 112 BPM track like the synthetic corpus's: two beats of pickup from 0.5 s, then 32 bars in
 * sections of 8, 16 and 8 bars, ringing on for 0.6 s after the last. */
function track(beats = Array.from({ length: 2 + 32 * 4 }, (_, i) => 0.5 + i * BEAT)): MusicSource {
  const downbeats = beats.slice(2).filter((_, i) => i % 4 === 0);
  const end = (downbeats.at(-1) as number) + BAR + 0.6;
  const at = (bar: number) => downbeats[bar] as number;
  const index: MusicIndex = {
    version: 1,
    source: { name: "beat-112.wav", duration: end + 0.4, sample_rate: 48000, channels: 2 },
    license: { name: "CC0 1.0" },
    tracker: "beat_this final0",
    tempo: { bpm: 112, beats_per_bar: 4 },
    beats,
    downbeats,
    sections: [
      { start: 0, end: at(8), loudness: -25 },
      { start: at(8), end: at(24), loudness: -14 },
      { start: at(24), end, loudness: -20 },
    ],
    loudness: Array.from({ length: Math.ceil(end) }, () => -15),
    end,
  };
  return { id: "music-beat-112", path: "/music/beat-112.wav", indexPath: "", index, fingerprint: { bytes: 1, sha256: "0".repeat(64) } }; // biome-ignore format: one line
}

const seconds = (ticks: number) => ticks / SECOND;
const ends = (music: MusicTrack[]) => {
  const last = music.at(-1) as MusicTrack;
  return seconds(last.start + last.out - last.in);
};

/** Each beat of the music on the output timeline is one beat after the one before: joins keep
 * the grid. */
function assertOneGrid(music: MusicTrack[], index: MusicIndex) {
  const beats = outputBeats(music, index);
  for (const [i, b] of beats.slice(1).entries()) {
    const step = b - (beats[i] as number);
    assert.ok(Math.abs(step - BEAT) < 0.002, `beat ${i + 1} at ${b} s is ${step} s after the last`);
  }
}

test("music ends on the track's ending as the edit ends, entering on a phrase within a bar", () => {
  const source = track();
  // From the main section's first phrase to the end is 52.0 s.
  const music = fitMusic(source, 2, 53, -20);
  assert.equal(music.length, 1);
  assert.ok(Math.abs(ends(music) - 53) < 1e-3, `ends at ${ends(music)} s`);
  assert.ok(Math.abs(seconds((music.at(-1) as MusicTrack).out) - source.index.end) < 1e-5);
  const first = music[0] as MusicTrack;
  assert.ok(seconds(first.start) <= BAR, `enters ${seconds(first.start)} s in`);
  // It enters on a phrase of the chosen section, and the phrases it skips are whole.
  const phrases = source.index.downbeats.filter((_, i) => i % PHRASE === 0);
  assert.ok(phrases.some((p) => Math.abs(p - seconds(first.in)) < 1e-3));
  assert.ok(seconds(first.in) >= (source.index.sections[1]?.start ?? 0) - 1e-3);
  assertOneGrid(music, source.index);
});

test("music enters a bar or more into a phrase when no path through whole phrases fits", () => {
  const source = track();
  // Whole phrases from the main section give 52.0 or 60.6 s; 60 s enters a bar into one.
  const music = fitMusic(source, 2, 60, -20);
  assert.ok(Math.abs(ends(music) - 60) < 1e-3);
  assert.ok(Math.abs(seconds((music.at(-1) as MusicTrack).out) - source.index.end) < 1e-5);
  const first = music[0] as MusicTrack;
  const entry = seconds(first.in);
  const next = source.index.downbeats.filter((_, i) => i % PHRASE === 0).find((p) => p > entry);
  assert.ok(next !== undefined && next - entry <= 3 * BAR + 1e-3);
  // It fades in until the next phrase starts.
  assert.ok(Math.abs(seconds(first.fadeIn ?? 0) - (next - entry)) < 1e-3);
  assertOneGrid(music, source.index);
});

test("a long edit loops whole phrases of the chosen section, then plays the ending", () => {
  const source = track();
  const music = fitMusic(source, 2, 300, -20);
  assert.ok(music.length > 4, `${music.length} ranges`);
  assert.ok(Math.abs(ends(music) - 300) < 1e-3);
  assertOneGrid(music, source.index);
  const main = source.index.sections[1];
  for (const range of music.slice(1, -1)) {
    assert.ok(
      seconds(range.in) >= (main?.start ?? 0) - 0.1 && seconds(range.out) <= (main?.end ?? 0) + 0.1,
    );
  }
});

test("a short edit skips to the last phrase; one too short for that fades out from a bar line", () => {
  const source = track();
  // Two bars of the main section, then the last phrase: 13.5 s, 1.5 s into a 15 s edit.
  const short = fitMusic(source, 2, 15, -20);
  assert.equal(short.length, 2);
  assert.ok(Math.abs(seconds((short.at(-1) as MusicTrack).out) - source.index.end) < 1e-5);
  assertOneGrid(short, source.index);
  // The join cross-fades for 40 ms, centred 50 ms before the downbeat it joins.
  const [before, after] = short as [MusicTrack, MusicTrack];
  assert.equal(before.fadeOut, 0.04 * SECOND);
  assert.equal(after.fadeIn, 0.04 * SECOND);
  const downbeat = seconds(after.start) + 0.07;
  assert.ok(Math.abs(seconds(before.start + before.out - before.in) - (downbeat - 0.03)) < 1e-4);
  // Entering two bars into a phrase, it fades in until the cross-fade into the next one.
  assert.equal(before.fadeIn, before.out - before.in - (before.fadeOut ?? 0));

  const music = fitMusic(source, 2, 10, -20);
  assert.equal(music.length, 1);
  const [only] = music;
  assert.ok(only);
  assert.equal(only.start, 0);
  assert.equal(seconds(only.out - only.in), 10);
  const fade = seconds(only.fadeOut ?? 0);
  assert.ok(fade >= 2 && fade < 2 + BAR, `fades over ${fade} s`);
  // The fade starts on a downbeat.
  const startsAt = seconds(only.in) + 10 - fade;
  assert.ok(source.index.downbeats.some((d) => Math.abs(d - startsAt) < 1e-3));
  // It enters on the main section's first phrase, mid-track, so it fades in over a beat.
  assert.ok(Math.abs(seconds(only.in) - (source.index.sections[1]?.start ?? 0)) < 1e-5);
  assert.ok(Math.abs(seconds(only.fadeIn ?? 0) - BEAT) < 1e-3);
});

test("a long edit opening on a one-phrase intro loops back to it through the sections after it", () => {
  // Intro, main and outro of 4, 16 and 8 bars: the loop runs from the intro to the outro, which
  // plays once at the end, instead of repeating the intro's 8.6 s on its own.
  const source = shaped(0.5, 0, [4, 16, 8], 0.6);
  const music = fitMusic(source, 1, 300, -20);
  assert.ok(Math.abs(ends(music) - 300) < 1e-3, `ends at ${ends(music)} s`);
  assertOneGrid(music, source.index);
  const first = source.index.downbeats[0] as number;
  const outro = (source.index.sections[2]?.start ?? 0) as number;
  const loops = music.slice(1, -1);
  assert.ok(loops.length > 0 && loops.length <= 6, `${loops.length} loops`);
  // Each loop starts 70 ms before its downbeat and ends 30 ms before the next, as joins do.
  for (const range of loops) {
    assert.ok(Math.abs(seconds(range.in) - (first - 0.07)) < 1e-3, `in ${seconds(range.in)}`);
    assert.ok(Math.abs(seconds(range.out) - (outro - 0.03)) < 1e-3, `out ${seconds(range.out)}`);
  }
  assert.ok(seconds((music.at(-1) as MusicTrack).in) < outro);
});

test("a chosen section too short to loop for a long edit gives way to the one before it", () => {
  // A 4-bar outro: looping it would leave no ending to play after the loops.
  const source = shaped(0.5, 2, [8, 16, 4], 0.6);
  const music = fitMusic(source, 3, 60, -20);
  assert.ok(Math.abs(ends(music) - 60) < 1e-3, `ends at ${ends(music)} s`);
  const entry = seconds((music[0] as MusicTrack).in);
  const main = source.index.sections[1];
  assert.ok(main && entry >= main.start - 1e-3 && entry < main.end, `enters at ${entry} s`);
  assertOneGrid(music, source.index);
});

test("a track with no sound left in it gives no music rather than an empty range", () => {
  const source = track();
  const silent = { ...source, index: { ...source.index, beats: [], downbeats: [], end: 0 } };
  assert.deepEqual(fitMusic(silent, 1, 30, -20), []);
});

test("the music sits under the speech's loudness, ducked further while someone speaks", () => {
  const [music] = fitMusic(track(), 1, 60, -20);
  assert.ok(music);
  // -20 LUFS speech, music measured at -15: -6 LU under in pauses, -18 under while talking.
  assert.equal(music.gainDb, -20 - UNDER_PAUSES + 15);
  assert.deepEqual(music.ducking, { depthDb: UNDER_PAUSES - UNDER_SPEECH, attackMs: 250, releaseMs: 750 }); // biome-ignore format: one line
  assert.deepEqual(music.license, { name: "CC0 1.0" });
  assert.equal(music.source, "music-beat-112");
  assert.deepEqual(music.beatGrid, { bpm: 112, downbeat: Math.round((0.5 + 2 * BEAT) * SECOND), beatsPerBar: 4 }); // biome-ignore format: one line
});

test("beats that drift from one tempo give no beat grid to check against", () => {
  const beats = Array.from({ length: 130 }, (_, i) => 0.5 + i * BEAT + (i % 2 ? 0.05 : 0));
  assert.equal(fitMusic(track(beats), 1, 60, -20)[0]?.beatGrid, undefined);
});

test("a cut moves to the nearest beat within 150 ms, and stays put farther from one", () => {
  const beats = [1, 1.5, 2, 2.5];
  assert.equal(snapToBeat(1.62, beats), 1.5);
  assert.equal(snapToBeat(1.88, beats), 2);
  assert.equal(snapToBeat(1.75, beats), 1.75);
  assert.equal(snapToBeat(3.2, beats), 3.2);
});

test("a shot's end comes back to the last beat less than a beat before it, and no further", () => {
  const beats = Array.from({ length: 20 }, (_, i) => 0.5 * i); // 0 to 9.5 s
  assert.equal(lastBeat(7.3, 1, beats), 7);
  assert.equal(lastBeat(7, 1, beats), 7);
  // The music has ended: no beat within a beat of the end, so the shot keeps its length.
  assert.equal(lastBeat(12, 1, beats), 12);
  assert.equal(lastBeat(1.2, 1.1, beats), 1.2);
});

test("the speech's loudness is the gated mean of the seconds its clips play", () => {
  const index = { source: { name: "a.mp4", audio: [{ channels: 1 }] }, loudness: { momentary: [], short_term: [-70, -20, -20, -40, -20, -70] } } as unknown as MediaIndex; // biome-ignore format: one line
  // Seconds 1-4: the -40 one is more than 10 LU under the rest and gated out.
  assert.ok(Math.abs(speechLoudness([{ index, in: SECOND, out: 4.5 * SECOND }]) + 20) < 1e-9);
  // The index of a stereo source already reads as loud as its two channels together.
  const stereo = { ...index, source: { name: "b.mp4", audio: [{ channels: 2 }] } } as MediaIndex;
  const both = speechLoudness([{ index: stereo, in: SECOND, out: 4.5 * SECOND }]);
  assert.ok(Math.abs(both + 20) < 1e-9, `${both}`);
  assert.equal(gatedMean([-70, -80]), -70);
  // A source with measured speech gets a voice chain, which plays its speech at SPEECH_LUFS:
  // the music is set under that, not under the recording's level.
  // Its speech measured 6 LU louder than these seconds read: they are raised as it is.
  const quiet = { ...index, voice: { recorded: { speech_lufs: -26 } } } as unknown as MediaIndex;
  const chained = speechLoudness([{ index: quiet, in: SECOND, out: 4.5 * SECOND }]);
  assert.ok(Math.abs(chained - (-20 + SPEECH_LUFS + 26)) < 1e-9, `${chained}`);
  const old = { source: { name: "old.mp4", audio: [] } } as unknown as MediaIndex;
  assert.throws(
    () => speechLoudness([{ index: old, in: 0, out: SECOND }]),
    /run vework analyze again/,
  );
});

/** A track at `bpm` whose first beat is `lead` seconds in, `pickup` beats before the first
 * downbeat, then sections of `bars` bars each, ringing on for `ring` seconds after the last. */
function shaped(lead: number, pickup: number, bars: number[], ring: number, bpm = 112) {
  const beat = 60 / bpm;
  const count = pickup + 4 * bars.reduce((a, b) => a + b, 0);
  const beats = Array.from(
    { length: count },
    (_, i) => Math.round((lead + i * beat) * 1000) / 1000,
  );
  const downbeats = beats.slice(pickup).filter((_, i) => i % 4 === 0);
  const end = Math.round(((downbeats.at(-1) as number) + 4 * beat + ring) * 1000) / 1000;
  const starts = bars.map((_, k) => bars.slice(0, k).reduce((a, b) => a + b, 0));
  const sections = starts.map((bar, k) => ({
    start: k === 0 ? 0 : (downbeats[bar] as number),
    end: k === bars.length - 1 ? end : (downbeats[starts[k + 1] as number] as number),
    loudness: -15,
  }));
  const source = track(beats);
  source.index = { ...source.index, beats, downbeats, sections, end, tempo: { bpm, beats_per_bar: 4 }, loudness: Array.from({ length: Math.ceil(end) }, () => -15) }; // biome-ignore format: one line
  return source;
}

test("every fit is playable: ranges forward, fades inside them, joins on one grid, the edit filled", () => {
  const problems: string[] = [];
  const crossfade = 0.04 * SECOND;
  for (const lead of [0, 0.02, 0.03, 0.05, 0.5]) {
    for (const pickup of [0, 2]) {
      for (const bars of [
        [8, 16, 8],
        [8, 16, 4],
        [4, 16, 8],
      ]) {
        for (const ring of [0, 0.6]) {
          const source = shaped(lead, pickup, bars, ring);
          const { index } = source;
          const bar = (index.downbeats[1] as number) - (index.downbeats[0] as number);
          for (const section of [1, 2, 3]) {
            for (let length = 15; length <= 130; length += 1.37) {
              const music = fitMusic(source, section, length, -20);
              const where = `lead ${lead}, pickup ${pickup}, bars ${bars}, ring ${ring}, section ${section}, ${length.toFixed(2)} s`; // biome-ignore format: one line
              const fail = (what: string) => problems.push(`${where}: ${what}`);
              for (const [k, range] of music.entries()) {
                if (!(range.in >= 0 && range.out > range.in && range.start >= 0)) fail(`range ${k} is ${JSON.stringify(range)}`); // biome-ignore format: one line
                for (const fade of [range.fadeIn, range.fadeOut]) if (fade !== undefined && fade <= 0) fail(`range ${k} has a fade of ${fade}`); // biome-ignore format: one line
                if ((range.fadeIn ?? 0) + (range.fadeOut ?? 0) > range.out - range.in) fail(`range ${k}'s fades outlast it`); // biome-ignore format: one line
                if (music.length > 1 && seconds(range.out - range.in) < bar - 0.1) fail(`range ${k} lasts ${seconds(range.out - range.in)} s`); // biome-ignore format: one line
                const next = music[k + 1];
                if (next && Math.abs(next.start - (range.start + range.out - range.in - crossfade)) > 2) fail(`join ${k} leaves ${seconds(next.start - range.start - range.out + range.in)} s`); // biome-ignore format: one line
              }
              const first = music[0] as MusicTrack;
              if (seconds(first.start) > bar + 1e-3) fail(`enters ${seconds(first.start)} s in`);
              if (Math.abs(ends(music) - length) > 1e-3) fail(`ends at ${ends(music)} s`);
              const last = music.at(-1) as MusicTrack;
              const ownEnding = Math.abs(seconds(last.out) - index.end) < 1e-3;
              const fadeStart = seconds(last.out - (last.fadeOut ?? 0));
              const onBar = index.downbeats.some((d) => Math.abs(d - fadeStart) < 1e-3);
              if (!ownEnding && !(seconds(last.fadeOut ?? 0) >= 2 && onBar)) fail(`stops at ${seconds(last.out)} s of the track without its ending or a fade from a bar line`); // biome-ignore format: one line
              try {
                assertOneGrid(music, index);
              } catch (error) {
                fail((error as Error).message);
              }
            }
          }
        }
      }
    }
  }
  const kinds = new Map<string, string>();
  for (const p of problems) {
    const k = p
      .split(": ")
      .slice(1)
      .join(": ")
      .replace(/[-\d.]+/g, "#");
    if (!kinds.has(k)) kinds.set(k, p);
  }
  assert.deepEqual([...kinds.values()], [], `${problems.length} problems`);
});
