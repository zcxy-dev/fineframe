// Stands in for `vework analyze` in tests: prints progress as vework does, a model's download
// among it, then writes the media
// index found next to the source (<name>.index.json) and a stand-in for the denoised speech
// beside it, as vework names it, or fails as vework does on a file it cannot read. For
// `vework analyze-music` it writes the music index next to the track (<name>.music.json) with
// the licence it was given. Each call's arguments are appended to $FAKE_VEWORK_LOG.
import { existsSync } from "node:fs";
import { appendFile, copyFile, readFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
const [command, source = "", , out = ""] = args;
if (process.env.FAKE_VEWORK_LOG) {
  await appendFile(process.env.FAKE_VEWORK_LOG, `${JSON.stringify(args)}\n`);
}
if (command === "analyze-music") {
  for (const step of ["decoding", "finding beats", "measuring loudness"]) {
    process.stderr.write(`vework: ${step}\n`);
  }
  const index = JSON.parse(await readFile(source.replace(/\.[^.]+$/, ".music.json"), "utf8"));
  const option = (name: string) => {
    const at = args.indexOf(name);
    return at < 0 ? undefined : args[at + 1];
  };
  index.license = {
    name: option("--license"),
    ...(option("--license-url") ? { url: option("--license-url") } : {}),
    ...(option("--attribution") ? { attribution: option("--attribution") } : {}),
  };
  await writeFile(out, JSON.stringify(index));
  process.exit(0);
}
const steps = ["probing", "detecting shots", "finding speech", "measuring loudness"];
steps.push("finding audio events", "finding faces", "removing noise from speech");
steps.push("downloading Qwen/Qwen3-ASR-0.6B-hf: 0 of 4000 bytes");
steps.push("downloading Qwen/Qwen3-ASR-0.6B-hf: 4000 of 4000 bytes");
steps.push("transcribing 1/2", "transcribing 2/2");
for (const step of [...steps, "aligning 1/1"]) {
  process.stderr.write(`vework: ${step}\n`);
}
process.stdout.write("A line a library printed\n");
const index = source.replace(/\.[^.]+$/, ".index.json");
if (!existsSync(index)) {
  process.stderr.write(`vework: error: ${source}: Invalid data found when processing input\n`);
  process.exit(1);
}
await writeFile(`${out.replace(/(\.index)?\.json$/, "")}.voice.wav`, "");
await copyFile(index, out);
