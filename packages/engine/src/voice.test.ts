import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { type MediaIndex, validateProject } from "@video-editor/schema";
import { project, SECOND, scratch } from "./testing.ts";
import { decideVoice, loudnessFor, planVoice } from "./voice.ts";

type Measured = NonNullable<MediaIndex["voice"]>;
type Levels = Measured["recorded"];

const levels = (overrides: Partial<Levels>): Levels => ({
  noise_floor_db: -80,
  speech_lufs: -20,
  loudness_range_lu: 3,
  clipped_share: 0,
  rt60: 0.15,
  mud_db: -1.5,
  presence_db: -10.8,
  ...overrides,
});
const measured = (recorded: Partial<Levels>, denoised: Partial<Levels> = {}): Measured => ({
  stem: "a.voice.wav",
  model: "DeepFilterNet3",
  recorded: levels(recorded),
  denoised: levels({ ...recorded, noise_floor_db: -90, ...denoised }),
});

test("a clean, dry voice is only filtered, compressed and brought to the common level", () => {
  assert.deepEqual(decideVoice("a", measured({})), {
    source: "a",
    measurements: {
      recorded: {
        noiseFloorDb: -80,
        loudnessLufs: -20,
        loudnessRangeLu: 3,
        clippedShare: 0,
        reverbRt60Seconds: 0.15,
        mudDb: -1.5,
        presenceDb: -10.8,
      },
    },
    chain: {
      highpassHz: 80,
      // 2 dB over the speech's level, 2:1; 2.8 dB brings back what compression takes off.
      compressor: { thresholdDb: -18, ratio: 2, attackMs: 10, releaseMs: 120, makeupDb: 2.8 },
      deesser: { frequencyHz: 6000, intensity: 0.3, thresholdDb: -38 },
      limiter: { ceilingDb: -9 },
    },
  });
});

test("a noisy phone voice is denoised and its later stages follow the denoised speech", () => {
  const phone = measured(
    { noise_floor_db: -42, speech_lufs: -24, loudness_range_lu: 9, rt60: null, mud_db: 3 },
    { speech_lufs: -25, loudness_range_lu: 10, rt60: 0.2, mud_db: 2.5, presence_db: -16 },
  );
  const decision = decideVoice("a", phone);
  // 18 dB between speech and room: as hard as the denoiser goes.
  assert.deepEqual(decision.chain.denoise, { attenuationLimitDb: 30 });
  assert.equal(decision.chain.dereverb, undefined);
  assert.deepEqual(decision.chain.eq, [
    { type: "peak", frequencyHz: 300, gainDb: -1.5, q: 1 },
    { type: "peak", frequencyHz: 3500, gainDb: 4, q: 0.8 },
  ]);
  // 10 LU of loudness range: levelled first, then compressed 2:1 with makeup from the denoised
  // level to -20 LUFS.
  assert.deepEqual(decision.chain.level, {
    ...{ targetDb: -20.5, windowSeconds: 3, maxGainDb: 12 },
  });
  assert.deepEqual(decision.chain.compressor, {
    ...{ thresholdDb: -23, ratio: 2, attackMs: 10, releaseMs: 120 },
    makeupDb: 7.8,
  });
  // The presence lift is matched by firmer de-essing.
  assert.equal(decision.chain.deesser?.intensity, 0.7);
  assert.equal(decision.measurements.denoised?.loudnessLufs, -25);
  assert.equal(decision.measurements.recorded.reverbRt60Seconds, undefined);
});

test("the denoiser works harder the closer the room is to the speech", () => {
  const limit = (floor: number | null) =>
    decideVoice("a", measured({ noise_floor_db: floor, speech_lufs: -20 })).chain.denoise
      ?.attenuationLimitDb;
  assert.equal(limit(-80), undefined);
  assert.equal(limit(-72), 6);
  assert.equal(limit(-60), 15);
  assert.equal(limit(-30), 30);
  // No second of pause to measure the room in, as in crosstalk: no guess at a room, but as hard
  // as the denoiser goes, which takes little from speech it finds clean.
  assert.equal(limit(null), 30);
});

test("a reverberant room is denoised even when quiet, and expanded if the tail is still heard", () => {
  const room = measured(
    { noise_floor_db: -78, speech_lufs: -22, rt60: 0.8 },
    { speech_lufs: -24, rt60: 0.45 },
  );
  const { chain } = decideVoice("a", room);
  assert.deepEqual(chain.denoise, { attenuationLimitDb: 20 });
  assert.deepEqual(chain.dereverb, { amount: 0.15, thresholdDb: -49 });
  const cleared = decideVoice("a", measured({ rt60: 0.8 }, { rt60: 0.2 })).chain;
  assert.equal(cleared.dereverb, undefined);
});

test("a room too noisy to time is judged by what the denoiser leaves of it", () => {
  // 42 dB between speech and room asks for 13 dB of denoising; the recording's reverberation
  // cannot be read through the noise.
  const limit = (denoisedRt60: number) =>
    decideVoice("a", measured({ noise_floor_db: -62, rt60: null }, { rt60: denoisedRt60 })).chain
      .denoise?.attenuationLimitDb;
  // DeepFilterNet leaves rooms of 0.5 to 0.7 s at about 0.25 s, and a dry voice at 0.1 to 0.2 s.
  assert.equal(limit(0.24), 20);
  assert.equal(limit(0.12), 13);
});

test("presence is never lifted on a clipped recording, but a harsh one is still tamed", () => {
  const eq = (presence: number, clipped: number) =>
    decideVoice("a", measured({ presence_db: presence, clipped_share: clipped })).chain.eq;
  assert.deepEqual(eq(-16, 0), [{ type: "peak", frequencyHz: 3500, gainDb: 4, q: 0.8 }]);
  assert.equal(eq(-16, 0.01), undefined);
  assert.deepEqual(eq(-6, 0.01), [{ type: "peak", frequencyHz: 3500, gainDb: -3, q: 0.8 }]);
});

test("the loudness range sets the compression ratio, and a wide one is levelled first", () => {
  const chain = (range: number) => decideVoice("a", measured({ loudness_range_lu: range })).chain;
  const ranges = [2, 4, 6, 7.9, 8, 20];
  assert.deepEqual(
    ranges.map((range) => chain(range).compressor?.ratio),
    [2, 2, 2.5, 3, 2, 2],
  );
  assert.deepEqual(
    ranges.map((range) => chain(range).level !== undefined),
    [false, false, false, false, true, true],
  );
});

test("social shapes are normalised to -14 LUFS and landscape long-form to -16", () => {
  assert.deepEqual(loudnessFor("9:16"), { integratedLufs: -14, truePeakDbtp: -1 });
  assert.deepEqual(loudnessFor("1:1"), { integratedLufs: -14, truePeakDbtp: -1 });
  assert.deepEqual(loudnessFor("16:9"), { integratedLufs: -16, truePeakDbtp: -1 });
});

test("planning decides every main-track source with measured speech and replaces old decisions", async (t) => {
  const dir = await scratch(t, "voice-");
  const index = (voice?: Measured): MediaIndex => ({
    version: 1,
    source: { name: "x.mp4", duration: 60, video: null, audio: [] },
    transitions: [],
    speech: [],
    transcript: { language: null, text: "", words: [] },
    ...(voice ? { voice } : {}),
  });
  await writeFile(join(dir, "a.json"), JSON.stringify(index(measured({ noise_floor_db: -40 }))));
  await writeFile(join(dir, "b.json"), JSON.stringify(index()));
  const edit = project(
    [
      { source: "a", in: 0, out: SECOND },
      { source: "b", in: 0, out: SECOND },
    ],
    {},
  );
  const old = decideVoice("b", measured({}));
  edit.audio.voice = [old];
  const planned = await planVoice(edit, join(dir, "project.json"));
  assert.deepEqual(
    planned.audio.voice?.map((decision) => decision.source),
    ["a"],
  );
  assert.ok(planned.audio.voice?.[0]?.chain.denoise);
  validateProject(planned);
  // A source with nothing measured leaves no empty list behind.
  const none = await planVoice(
    { ...edit, main: [{ source: "b", in: 0, out: SECOND }] },
    join(dir, "p.json"),
  );
  assert.equal(none.audio.voice, undefined);
});
