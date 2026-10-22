// Writes the music index of every track in the built-in library (assets/music/library.json)
// beside it, from the audio as the library publishes it: downloaded and checked like an edit's,
// then analysed with vework analyze-music. Run it after adding a track or changing the music
// analysis:
//
//   node scripts/music-library.ts

import { fileURLToPath } from "node:url";
import { analyzeMusic, localWorker } from "../src/edit/analyze.ts";
import { catalogTracks, fetchTrack, libraryLicense } from "../src/library.ts";

const folder = fileURLToPath(new URL("../assets/music/", import.meta.url));
const worker = await localWorker();
for (const track of catalogTracks()) {
  const path = await fetchTrack(track);
  process.stderr.write(`${track.id}: analysing\n`);
  await analyzeMusic(
    worker,
    { given: path, path, kind: "audio" },
    `${folder}${track.id}.music.json`,
    libraryLicense(),
    () => {},
    (line) => process.stderr.write(`${line}\n`),
  );
}
