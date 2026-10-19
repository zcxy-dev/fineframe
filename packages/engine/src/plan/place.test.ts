import assert from "node:assert/strict";
import { test } from "node:test";
import { type Project, secondsToTicks, type Word } from "@video-editor/schema";
import { project as projectOf, facts as sourceFacts, sources as sourceMap } from "../testing.ts";
import { buildTimeline } from "../timeline.ts";
import {
  CUT_GAP,
  cuttableAfter,
  LEAD,
  lengthOf,
  MARGIN,
  PAUSE_MAX,
  PEAK_BLOCK,
  type PlacedClip,
  type PlaceSource,
  placeClips,
  ROOM,
  TAIL,
} from "./place.ts";

const FRAME_30 = 4000;
const FRAME_25 = 4800;
const s = (ticks: number) => ticks / 120_000;

/** Words of 0.2 s each, starting at `start`, with the given gaps after each but the last. */
function spoken(start: number, gaps: number[]): Word[] {
  const words: Word[] = [];
  let t = start;
  for (let i = 0; i <= gaps.length; i++) {
    words.push({ text: `w${i}`, start: t, end: t + 0.2 });
    t += 0.2 + (gaps[i] ?? 0);
  }
  return words;
}

const source = (words: Word[], frameTicks: number | null = FRAME_25): PlaceSource => ({
  id: "a",
  words,
  duration: 60,
  frameTicks,
});
const map = (...list: PlaceSource[]) => new Map(list.map((x) => [x.id, x]));
const all = (words: Word[]) => words.map((_, i) => i);

/** Every cut is at least MARGIN away from every word of its source. */
function assertClear(clips: ReturnType<typeof placeClips>, words: Word[]) {
  for (const clip of clips) {
    for (const edge of [clip.in, clip.out]) {
      for (const word of words) {
        const inside =
          edge > secondsToTicks(word.start - MARGIN) && edge < secondsToTicks(word.end + MARGIN);
        assert.ok(!inside, `cut at ${s(edge)} s is within ${MARGIN} s of ${word.text}`);
      }
    }
  }
}

test("words that run on stay in one clip, with a breath before and after", () => {
  const words = spoken(2, [0.05, 0.3, 0.6]);
  const clips = placeClips([{ source: "a", words: all(words) }], map(source(words)), FRAME_30);
  assert.equal(clips.length, 1);
  const [clip] = clips;
  assert.ok(clip);
  assert.ok(Math.abs(s(clip.in) - (2 - LEAD)) <= 0.02, `in at ${s(clip.in)}`);
  const end = (words.at(-1) as Word).end;
  assert.ok(Math.abs(s(clip.out) - (end + TAIL)) <= 0.02, `out at ${s(clip.out)}`);
});

test("a pause longer than PAUSE_MAX is cut down to a breath", () => {
  const words = spoken(1, [0.1, PAUSE_MAX + 1.5, 0.1]);
  const clips = placeClips([{ source: "a", words: all(words) }], map(source(words)), FRAME_30);
  assert.equal(clips.length, 2);
  const [a, b] = clips as [(typeof clips)[0], (typeof clips)[0]];
  const kept = s(a.out) - (words[1] as Word).end + ((words[2] as Word).start - s(b.in));
  assert.ok(Math.abs(kept - (LEAD + TAIL)) <= 0.04, `${kept} s of the pause kept`);
  assertClear(clips, words);
});

test("left-out words are cut around in the gaps beside them, clear of every word", () => {
  // Words 2 and 5 are fillers, with gaps of exactly CUT_GAP around them.
  const words = spoken(0.5, [0.03, CUT_GAP, CUT_GAP, 0.03, CUT_GAP, CUT_GAP]);
  const kept = [0, 1, 3, 4, 6];
  const clips = placeClips([{ source: "a", words: kept }], map(source(words)), FRAME_30);
  assert.deepEqual(
    clips.map((c) => [c.first, c.last]),
    [
      [0, 1],
      [3, 4],
      [6, 6],
    ],
  );
  assertClear(clips, words);
});

test("clips land on the frame grids, so the renderer moves no cut", () => {
  const words = spoken(0.37, [0.02, 0.2, 0.9, 0.15, 0.02, 0.4, 2]);
  const kept = [0, 1, 3, 4, 5, 7];
  const clips = placeClips([{ source: "a", words: kept }], map(source(words)), FRAME_30);
  for (const clip of clips) {
    assert.equal(clip.in % FRAME_25, 0, "starts on a source frame");
    assert.equal((clip.out - clip.in) % FRAME_30, 0, "lasts whole output frames");
  }
  const main = clips.map((c) => ({ source: "a", in: c.in, out: c.out })) as Project["main"];
  const timeline = buildTimeline(
    projectOf(main),
    sourceMap(sourceFacts("a", { frameTicks: FRAME_25 })),
  );
  let position = 0;
  for (const [i, clip] of timeline.main.entries()) {
    const planned = clips[i] as (typeof clips)[0];
    assert.equal(clip.in, planned.in);
    assert.equal(clip.start * FRAME_30, position);
    position += planned.out - planned.in;
    assert.equal(clip.end * FRAME_30, position);
  }
  assert.equal(timeline.frames * FRAME_30, lengthOf(clips));
});

test("no cut falls inside a word, whatever the timing and the source's frame rate", () => {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  // No grid, 25, 60, 20, 15, 10 and 5 fps sources: screen recordings run as slow as 5.
  const grids = [null, FRAME_25, 2000, 6000, 8000, 12_000, 24_000];
  for (let run = 0; run < 350; run++) {
    const gaps = Array.from({ length: 30 }, () =>
      random() < 0.5 ? random() * 0.05 : CUT_GAP + random() * 0.4,
    );
    const words = spoken(MARGIN + random() * 0.3, gaps);
    const grid = grids[run % grids.length] as number | null;
    const placed = source(words, grid);
    const output = run % 2 ? FRAME_30 : FRAME_25;
    // Leave out single words with room to cut on both sides, as the planner does.
    const kept = all(words).filter(
      (i) => !(i % 4 === 2 && cuttableAfter(placed, i - 1) && cuttableAfter(placed, i)),
    );
    const clips = placeClips([{ source: "a", words: kept }], map(placed), output, 0.6 + random());
    assertClear(clips, words);
    // On both grids, the renderer moves neither end, so the cuts stay clear when rendered.
    for (const clip of clips) {
      assert.ok(clip.out > clip.in);
      if (grid) assert.equal(clip.in % grid, 0, `in at ${s(clip.in)} s, off the ${grid} grid`);
      assert.equal((clip.out - clip.in) % output, 0);
    }
  }
});

test("stretches play in the order given, from any source", () => {
  const a = spoken(1, [0.6, 0.6]);
  const b = { ...source(spoken(3, [0.6])), id: "b" };
  const clips = placeClips(
    [
      { source: "b", words: [1] },
      { source: "a", words: [0, 1] },
    ],
    map(source(a), b),
    FRAME_30,
  );
  assert.deepEqual(
    clips.map((c) => [c.source, c.first, c.last]),
    [
      ["b", 1, 1],
      ["a", 0, 1],
    ],
  );
});

test("a word a review found clipped keeps up to ROOM of the pause beside it", () => {
  const words = spoken(1, [2, 2]);
  const plain = placeClips([{ source: "a", words: [0, 2] }], map(source(words)), FRAME_30);
  const roomy = { ...source(words), roomy: new Set([0, 2]) };
  const spacious = placeClips([{ source: "a", words: [0, 2] }], map(roomy), FRAME_30);
  const [a, b] = plain as [(typeof plain)[0], (typeof plain)[0]];
  const [c, d] = spacious as [(typeof spacious)[0], (typeof spacious)[0]];
  assert.ok(s(c.in) < s(a.in) && Math.abs(1 - s(c.in) - ROOM) <= 0.025, `in at ${s(c.in)}`);
  assert.ok(s(c.out) > s(a.out) && Math.abs(s(c.out) - 1.2 - ROOM) <= 0.04, `out at ${s(c.out)}`);
  assert.ok(s(d.in) < s(b.in));
});

test("a clip starts before speech the transcript missed, never inside it", () => {
  // Speech from 2.4 s to 2.95 s that no word covers runs into w1.
  const words = [
    { text: "w0", start: 1, end: 1.2 },
    { text: "w1", start: 3, end: 3.2 },
  ];
  const missed = { ...source(words), unheard: [[2.4, 2.95]] as const };
  const [clip] = placeClips([{ source: "a", words: [1] }], map(missed), FRAME_30);
  assert.ok(clip);
  assert.ok(s(clip.in) <= 2.4 - MARGIN && s(clip.in) >= 1.2 + MARGIN, `in at ${s(clip.in)} s`);
});

test("a clip ends after speech the transcript missed, never inside it", () => {
  const words = [
    { text: "w0", start: 1, end: 1.2 },
    { text: "w1", start: 3, end: 3.2 },
  ];
  const missed = { ...source(words), unheard: [[1.22, 1.6]] as const };
  const [clip] = placeClips([{ source: "a", words: [0] }], map(missed), FRAME_30);
  assert.ok(clip);
  assert.ok(s(clip.out) >= 1.6 + MARGIN && s(clip.out) <= 3 - MARGIN, `out at ${s(clip.out)} s`);
});

test("a pause is cut down in its silence, around the speech the transcript missed", () => {
  // The words heard are 2.4 s apart, but the speaker said more right after w0 and right before
  // w1, leaving 1.4 s of silence between.
  const words = [
    { text: "w0", start: 1, end: 1.2 },
    { text: "w1", start: 3.6, end: 3.8 },
  ];
  const missed = { ...source(words), unheard: [[1.25, 1.7] as const, [3.1, 3.55] as const] };
  const clips = placeClips([{ source: "a", words: [0, 1] }], map(missed), FRAME_30);
  assert.equal(clips.length, 2);
  const [a, b] = clips as [(typeof clips)[0], (typeof clips)[0]];
  assert.ok(s(a.out) >= 1.7 + MARGIN && s(a.out) <= 3.1 - MARGIN, `out at ${s(a.out)} s`);
  assert.ok(s(b.in) >= 1.7 + MARGIN && s(b.in) <= 3.1 - MARGIN, `in at ${s(b.in)} s`);
});

test("a pause the transcript missed speech in plays on when no silence in it is dead air", () => {
  const words = [
    { text: "w0", start: 1, end: 1.2 },
    { text: "w1", start: 2.6, end: 2.8 },
  ];
  const missed = { ...source(words), unheard: [[1.5, 2.2]] as const };
  const clips = placeClips([{ source: "a", words: [0, 1] }], map(missed), FRAME_30);
  assert.equal(clips.length, 1);
});

test("no cut fits where the transcript missed speech that leaves no room", () => {
  const words = [
    { text: "w0", start: 1, end: 1.2 },
    { text: "w1", start: 1.6, end: 1.8 },
  ];
  assert.ok(cuttableAfter(source(words), 0));
  assert.ok(!cuttableAfter({ ...source(words), unheard: [[1.3, 1.5]] }, 0));
});

/** A source's sound as placeClips reads it: one second-difference peak per PEAK_BLOCK, all
 * alike, but for a jump at each of `jumps` (seconds). */
function peaks(seconds: number, jumps: number[]): Float32Array {
  const blocks = new Float32Array(Math.round(seconds / PEAK_BLOCK)).fill(0.01);
  for (const t of jumps) blocks[Math.floor(t / PEAK_BLOCK)] = 0.3;
  return blocks;
}

test("a clip that would start on a jump in the source's sound starts after it", () => {
  const words = spoken(2, [2]);
  const plain = placeClips([{ source: "a", words: [1] }], map(source(words)), FRAME_30);
  const at = s((plain[0] as PlacedClip).in) + 0.003;
  const spliced = { ...source(words), peaks: peaks(60, [at]) };
  const [clip] = placeClips([{ source: "a", words: [1] }], map(spliced), FRAME_30);
  assert.ok(clip);
  assert.ok(s(clip.in) > at, `in at ${s(clip.in)} s, on the jump at ${at} s`);
  assert.ok(s(clip.in) <= (words[1] as Word).start - MARGIN);
  assert.equal(clip.in % FRAME_25, 0);
});

test("a clip that would end on a jump in the source's sound ends before it", () => {
  const words = spoken(2, [2]);
  const plain = placeClips([{ source: "a", words: [0] }], map(source(words)), FRAME_30);
  const at = s((plain[0] as PlacedClip).out) - 0.003;
  const spliced = { ...source(words), peaks: peaks(60, [at]) };
  const [clip] = placeClips([{ source: "a", words: [0] }], map(spliced), FRAME_30);
  assert.ok(clip);
  assert.ok(s(clip.out) < at, `out at ${s(clip.out)} s, on the jump at ${at} s`);
  assert.ok(s(clip.out) >= (words[0] as Word).end + MARGIN);
  assert.equal((clip.out - clip.in) % FRAME_30, 0);
});

test("a clip whose first word follows missed speech from the source's start starts there", () => {
  // Speech from 0.03 s runs into w0 with only dips of a few milliseconds.
  const words = [{ text: "w0", start: 0.642, end: 0.8 }];
  const missed = { ...source(words), unheard: [[0.03, 0.52] as const, [0.55, 0.64] as const] };
  const [clip] = placeClips([{ source: "a", words: [0] }], map(missed), FRAME_30);
  assert.equal(clip?.in, 0);
});

test("with no silence a cut fits in, a clip starts in the widest one before its words", () => {
  const words = [
    { text: "w0", start: 1, end: 1.2 },
    { text: "w1", start: 2, end: 2.2 },
  ];
  const missed = { ...source(words), unheard: [[1.21, 1.5] as const, [1.6, 1.99] as const] };
  const [clip] = placeClips([{ source: "a", words: [1] }], map(missed), FRAME_30);
  assert.ok(clip);
  assert.ok(s(clip.in) >= 1.5 && s(clip.in) <= 1.6, `in at ${s(clip.in)} s`);
});
