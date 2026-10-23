import assert from "node:assert/strict";
import { copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadJson, type Project, validateMusicIndex } from "@video-editor/schema";
import {
  catalogTracks,
  libraryFile,
  libraryLicense,
  libraryMusic,
  libraryTrackOf,
  libraryTracks,
  MOODS,
  swapMusic,
} from "./library.ts";
import { describeMusic, loadMusic, outputBeats } from "./plan/music.ts";
import { project, SECOND, scratch } from "./testing.ts";

test("the library has 8 tracks of each mood, each with its music index", async () => {
  const tracks = catalogTracks();
  assert.equal(new Set(tracks.map((track) => track.id)).size, tracks.length);
  for (const mood of MOODS) {
    assert.equal(tracks.filter((track) => track.mood === mood).length, 8, mood);
  }
  assert.deepEqual(libraryLicense(), {
    name: "CC0 1.0",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
  });
  for (const track of tracks) {
    assert.match(track.id, /^[a-z0-9]+(-[a-z0-9]+)*$/);
    assert.match(track.sha256, /^[0-9a-f]{64}$/);
    assert.match(
      track.source,
      /^https:\/\/web\.archive\.org\/web\/\d{14}\/https:\/\/freepd\.com\//,
    );
    const index = await loadJson(track.index, validateMusicIndex);
    assert.equal(index.source.name, `${track.id}.mp3`, track.id);
    assert.deepEqual(index.license, libraryLicense(), track.id);
  }
  assert.ok(libraryTracks().every((track) => track.seconds >= 90));
});

test("the planner reads the library without its audio, by its tags", async () => {
  const music = await loadMusic(libraryMusic(), new Set());
  assert.equal(music.size, catalogTracks().length);
  const [first] = catalogTracks();
  const source = music.get(`music-${first?.id}`);
  assert.equal(source?.path, first && libraryFile(first));
  assert.equal(source?.fingerprint.sha256, first?.sha256);
  const listing = describeMusic(music.values());
  assert.match(listing, /^Music from the built-in library/);
  assert.ok(listing.includes(`"${first?.title}" by ${first?.artist}, ${first?.mood}`));
});

test("a track is known by its SHA-256", () => {
  const [first] = catalogTracks();
  assert.equal(libraryTrackOf(first?.sha256 as string)?.id, first?.id);
  assert.equal(libraryTrackOf("0".repeat(64)), undefined);
});

test("a swap fits a library track to the edit, or takes the music out", async (t) => {
  const dir = await scratch(t, "library-");
  const example = fileURLToPath(
    new URL("../../schema/examples/media-index.example.json", import.meta.url),
  );
  await copyFile(example, join(dir, "a.json"));
  const path = join(dir, "project.json");
  const edit = project([{ source: "a", in: 0, out: 10 * SECOND }], {
    audio: {
      loudness: { integratedLufs: -14, truePeakDbtp: -1 },
      music: [
        {
          source: "music-own",
          license: { name: "CC BY 4.0" },
          in: 0,
          out: 10 * SECOND,
          start: 0,
          gainDb: -3,
        },
      ],
    },
  });
  edit.sources.push({
    id: "music-own",
    kind: "audio",
    path: "own.mp3",
    fingerprint: { bytes: 1, sha256: "1".repeat(64) },
  });
  const track = catalogTracks().find((each) => each.mood === "calm");
  assert.ok(track);

  const swapped = await swapMusic(edit, path, track.id);
  assert.ok(!swapped.sources.some((source) => source.id === "music-own"));
  const source = swapped.sources.find((each) => each.id === `music-${track.id}`);
  assert.equal(source && resolve(dir, source.path), libraryFile(track));
  assert.equal(source && resolve(dir, source.index as string), track.index);
  assert.deepEqual(source?.fingerprint, { bytes: track.bytes, sha256: track.sha256 });
  const music = swapped.audio.music ?? [];
  assert.ok(music.length > 0);
  assert.ok(music.every((range) => range.source === source?.id && range.ducking));
  assert.deepEqual(music[0]?.license, libraryLicense());
  // The music lasts the edit, and the rest of it is as it was.
  const end = Math.max(...music.map((range) => range.start + range.out - range.in));
  assert.ok(Math.abs(end - 10 * SECOND) <= SECOND / 100, `ends at ${end}`);
  assert.deepEqual(swapped.main, edit.main);

  const none = await swapMusic(edit, path, null);
  assert.equal(none.audio.music, undefined);
  assert.ok(!none.sources.some((each) => each.id === "music-own"));
  await assert.rejects(swapMusic(edit, path, "no-such-track"), /No library track/);
});

test("a swap opens on the track's loudest section and moves B-roll edges onto its beats", async (t) => {
  const dir = await scratch(t, "library-");
  const example = fileURLToPath(
    new URL("../../schema/examples/media-index.example.json", import.meta.url),
  );
  await copyFile(example, join(dir, "a.json"));
  const path = join(dir, "project.json");
  const frame = SECOND / 30;
  const onFrame = (seconds: number) => Math.round((seconds * SECOND) / frame) * frame;
  // A track that opens quieter than it gets, with a steady beat.
  const track = catalogTracks().find((each) => each.id === "energizing");
  assert.ok(track);
  const index = await loadJson(track.index, validateMusicIndex);
  const loudest = index.sections.reduce((a, b) => (b.loudness > a.loudness ? b : a));
  assert.notEqual(loudest, index.sections[0]);

  const plain = project([{ source: "a", in: 0, out: 10 * SECOND }]);
  const music = (await swapMusic(plain, path, track.id)).audio.music ?? [];
  const entry = (music[0]?.in ?? 0) / SECOND;
  assert.ok(entry >= loudest.start - 0.1 && entry < loudest.end, `enters at ${entry} s`);

  // B-roll planned on another track's beats: 0.1 s after one of this track's, and ending off
  // them, where this track's beats still play.
  const beats = outputBeats(music, index);
  const beat = beats[1] as number;
  const start = onFrame(beat) + 3 * frame;
  const still = { source: "still", in: 0, out: 2 * SECOND + 2 * frame, start };
  assert.ok((beats.at(-1) as number) * SECOND > start + still.out);
  const edit = project(plain.main, { broll: [still] });
  edit.sources.push({
    id: "still",
    kind: "image",
    path: "still.png",
    fingerprint: { bytes: 1, sha256: "2".repeat(64) },
  });
  const [moved] = (await swapMusic(edit, path, track.id)).broll ?? [];
  assert.ok(moved);
  const onBeat = (ticks: number) => beats.some((b) => Math.abs(onFrame(b) - ticks) < frame / 2);
  assert.equal(moved.start, onFrame(beat));
  assert.ok(onBeat(moved.start + moved.out - moved.in), "ends on a beat");
  // It stays inside the span it had, showing no more than it did.
  assert.ok(moved.start + moved.out - moved.in <= start + still.out);
  assert.equal(moved.in, 0);

  // An overlay that ends where the B-roll starts keeps it from moving under the overlay.
  const card = { template: "keyword", params: { text: "x" }, start: 0, duration: start };
  const [kept] =
    (await swapMusic({ ...edit, overlays: [card] } as Project, path, track.id)).broll ?? [];
  assert.equal(kept?.start, start);
  // Taking the music out leaves the B-roll where it was.
  assert.deepEqual((await swapMusic(edit, path, null)).broll, [still]);
});
