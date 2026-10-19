import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ffmpeg, QUIET, run } from "../ffmpeg.ts";
import { PEAK_BLOCK } from "./place.ts";
import { readStem } from "./stem.ts";

/** A voice stem as vework writes it, the recording beside its denoised speech: a tone said from
 * 1.0 to 1.4 s and from 2.0 to 2.4 s over faint noise, with a jump in the recording at 3 s. */
async function stem(dir: string): Promise<string> {
  const path = join(dir, "talk.voice.wav");
  const said = "0.3*sin(2*PI*220*t)*(between(t,1,1.4)+between(t,2,2.4))+0.0001*(2*random(0)-1)";
  const jump = "0.5*between(t,3,3.0001)";
  await run(await ffmpeg(), [
    ...QUIET,
    "-f",
    "lavfi",
    "-i",
    `aevalsrc='${said}+${jump}|${said}':s=48000:d=4`,
    "-c:a",
    "pcm_f32le",
    path,
  ]);
  return path;
}

test("speech no word covers is unheard, and the recording's jumps stand out", async () => {
  const dir = await mkdtemp(join(tmpdir(), "stem-"));
  try {
    // The transcript heard the first stretch and ended its word 0.1 s early.
    const words = [{ text: "w0", start: 1, end: 1.3 }];
    const { unheard, peaks } = await readStem(await stem(dir), words);
    const near = (a: number, b: number) => Math.abs(a - b) <= 0.011;
    assert.equal(unheard.length, 2, JSON.stringify(unheard));
    const [tail, missed] = unheard as [[number, number], [number, number]];
    assert.ok(near(tail[0], 1.3) && near(tail[1], 1.4), `tail ${tail}`);
    assert.ok(near(missed[0], 2) && near(missed[1], 2.4), `missed ${missed}`);
    assert.equal(peaks.length, Math.round(4 / PEAK_BLOCK));
    const at = Math.floor(3 / PEAK_BLOCK);
    const quiet = Math.max(...peaks.subarray(at + 2, at + 40));
    assert.ok((peaks[at] as number) > 100 * quiet, `${peaks[at]} against ${quiet}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
