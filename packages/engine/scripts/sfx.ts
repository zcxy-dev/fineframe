// Makes the sound effects the project draws itself, which Kenney's packs have no match for: soft
// air for a move and a short warm tone for a check. They are the project's own, under CC0 like the
// rest of the set (src/broll/sfx.ts):
//
//   node scripts/sfx.ts

import { fileURLToPath } from "node:url";
import { ffmpeg, run } from "../src/ffmpeg.ts";

const dir = fileURLToPath(new URL("../assets/sfx/", import.meta.url));

/** Pink noise through a band, swelling in and dying away: air moving past, not a jet. */
const AIR = [
  { name: "whoosh/air-1.ogg", seconds: 0.45, low: 250, high: 2200, seed: 11 },
  { name: "whoosh/air-2.ogg", seconds: 0.6, low: 180, high: 1800, seed: 23 },
  { name: "whoosh/air-3.ogg", seconds: 0.35, low: 300, high: 2800, seed: 37 },
];

/** A soft sine with two quiet overtones, decaying in about a third of a second. */
const TONES = [
  { name: "tone/warm-1.ogg", hz: 523.25 },
  { name: "tone/warm-2.ogg", hz: 659.25 },
];

const bin = await ffmpeg();
const encode = ["-ac", "1", "-ar", "44100", "-c:a", "libvorbis", "-q:a", "4", "-y"];
for (const { name, seconds, low, high, seed } of AIR) {
  const rise = seconds * 0.6;
  await run(bin, [
    ...["-v", "error", "-f", "lavfi", "-i", `anoisesrc=color=pink:seed=${seed}:d=${seconds}`],
    "-af",
    [
      `highpass=f=${low}`,
      `lowpass=f=${high}`,
      `afade=t=in:d=${rise}:curve=qsin`,
      `afade=t=out:st=${rise}:d=${seconds - rise}:curve=qsin`,
      "volume=6dB",
    ].join(","),
    ...encode,
    `${dir}${name}`,
  ]);
}
for (const { name, hz } of TONES) {
  const wave = `sin(2*PI*${hz}*t)+0.3*sin(4*PI*${hz}*t)+0.1*sin(6*PI*${hz}*t)`;
  await run(bin, [
    ...["-v", "error", "-f", "lavfi"],
    ...["-i", `aevalsrc='0.5*min(1,t/0.005)*exp(-9*t)*(${wave})':s=44100:d=0.4`],
    // Faded to nothing at the end, so it never stops with a click.
    ...["-af", "afade=t=out:st=0.32:d=0.08"],
    ...encode,
    `${dir}${name}`,
  ]);
}
