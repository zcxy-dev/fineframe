// Stands in for `pnpm render` in tests: prints its progress as the engine's command does, then
// writes the video and captions at -o beside the project it was given. With $FAKE_RENDER_FAIL it
// fails as the engine does, naming the problem. With $FAKE_RENDER_LOG it adds its arguments to
// that file, a line a render.
import { appendFile, writeFile } from "node:fs/promises";

const args = process.argv.slice(2);
if (process.env.FAKE_RENDER_LOG) {
  await appendFile(process.env.FAKE_RENDER_LOG, `${JSON.stringify(args)}\n`);
}
const out = args[args.indexOf("-o") + 1] ?? "";
process.stderr.write("10% Checking sources\n");
process.stderr.write("60% Rendering pieces\n");
if (process.env.FAKE_RENDER_FAIL) {
  process.stderr.write("render: error: /captions/lines/0: the caption font cannot draw it\n");
  process.exit(1);
}
await writeFile(out, Buffer.alloc(500, 3));
await writeFile(out.replace(/\.mp4$/, ".srt"), "1\n00:00:00,000 --> 00:00:01,000\n大家好\n");
console.log(JSON.stringify({ video: out, seconds: 30 }, null, 2));
