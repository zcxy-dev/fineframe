import assert from "node:assert/strict";
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
  FFMPEG_ENV,
  ffmpeg,
  parseCodecs,
  parseFilters,
  REQUIRED_DECODERS,
  REQUIRED_ENCODERS,
  REQUIRED_FILTERS,
} from "./ffmpeg.ts";
import { scratch } from "./testing.ts";

const FILTERS = `Filters:
  T.. = Timeline support
  .S. = Slice threading
  ..C = Command support
  A = Audio input/output
 ... acrossfade        AA->A      Cross fade two input audio streams.
 T.C afade             A->A       Fade in/out input audio.
 .SC zscale            V->V       Apply resizing, colorspace and bit depth conversion.
 ... anullsrc          |->A       Null audio source, return empty audio frames.
 ... concat            N->N       Concatenate audio and video streams.
`;
const ENCODERS = `Encoders:
 V..... = Video
 ------
 V....D libx264              libx264 H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10 (codec h264)
 A....D aac                  AAC (Advanced Audio Coding)
`;

test("filter and codec names are read from FFmpeg's listings", () => {
  assert.deepEqual(
    [...parseFilters(FILTERS)],
    ["acrossfade", "afade", "zscale", "anullsrc", "concat"],
  );
  assert.deepEqual([...parseCodecs(ENCODERS)], ["libx264", "aac"]);
});

test("an FFmpeg without what the renderer needs fails, naming every missing piece", async (t) => {
  const dir = await scratch(t, "fake-ffmpeg-");
  const fake = join(dir, "ffmpeg");
  await writeFile(
    fake,
    `#!/bin/sh\ncase "$2" in\n  -filters) printf '%s' '${FILTERS}' ;;\n` +
      `  -encoders) printf ' V....D libx264  x\\n' ;;\n` +
      `  -decoders) printf ' V....D vp9  x\\n' ;;\nesac\n`,
  );
  await chmod(fake, 0o755);
  process.env[FFMPEG_ENV] = fake;
  await assert.rejects(ffmpeg(), (error: Error) => {
    assert.ok(error.message.startsWith(`${fake} lacks `), error.message);
    for (const name of [
      "filter ass",
      "filter tonemap",
      "filter loudnorm",
      "filter settb",
      "encoder aac",
      "decoder libvpx-vp9",
    ]) {
      assert.ok(error.message.includes(name), name);
    }
    for (const name of ["filter afade", "filter zscale", "encoder libx264"]) {
      assert.ok(!error.message.includes(name), name);
    }
    assert.match(error.message, /needs an FFmpeg built with libass, libx264, libvpx and zimg/);
    return true;
  });
});

test("an FFmpeg that cannot read a filter graph from a file fails before any render", async (t) => {
  const dir = await scratch(t, "old-ffmpeg-");
  // Every filter and codec the renderer needs, as FFmpeg 6 lists them; only 7.0 and later
  // read an option's value from a file.
  await writeFile(
    join(dir, "filters"),
    REQUIRED_FILTERS.map((name) => ` ... ${name}  V->V  x`).join("\n"),
  );
  await writeFile(
    join(dir, "encoders"),
    REQUIRED_ENCODERS.map((name) => ` V....D ${name}  x`).join("\n"),
  );
  await writeFile(
    join(dir, "decoders"),
    REQUIRED_DECODERS.map((name) => ` V....D ${name}  x`).join("\n"),
  );
  const fake = join(dir, "ffmpeg");
  await writeFile(
    fake,
    `#!/bin/sh\ncase "$2" in\n  -filters) cat "${dir}/filters" ;;\n` +
      `  -encoders) cat "${dir}/encoders" ;;\n  -decoders) cat "${dir}/decoders" ;;\nesac\n` +
      `for arg; do\n  if [ "$arg" = -/filter_complex ]; then\n` +
      `    echo "Unrecognized option '/filter_complex'." >&2\n    exit 1\n  fi\ndone\n`,
  );
  await chmod(fake, 0o755);
  process.env[FFMPEG_ENV] = fake;
  await assert.rejects(ffmpeg(), (error: Error) => {
    assert.ok(error.message.startsWith(`${fake} lacks `), error.message);
    assert.match(error.message, /-\/filter_complex \(FFmpeg 7\.0 or later\)/);
    assert.ok(!error.message.includes("filter crop"), error.message);
    return true;
  });
});
