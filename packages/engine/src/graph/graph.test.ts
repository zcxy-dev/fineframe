import assert from "node:assert/strict";
import { test } from "node:test";
import type { CropPath, Project, ScalePath } from "@video-editor/schema";
import { cutPieces, type Piece } from "../pieces.ts";
import { facts, project, SECOND, sources } from "../testing.ts";
import { buildTimeline } from "../timeline.ts";
import { fades, silence, soundClock } from "./audio.ts";
import { placement } from "./broll.ts";
import { alignToAacFrames, encoderArgs } from "./encode.ts";
import { decimal, openSource } from "./inputs.ts";
import { linearReach, masterAudio, parseMeasurement } from "./master.ts";
import {
  addBed,
  duckDepth,
  duckGains,
  ENVELOPE_RATE,
  envelopeOf,
  MAX_RIDE_DB,
  MIN_RISE,
  musicBed,
  parseMomentary,
  rides,
} from "./music.ts";
import { pieceAudio, pieceVideo } from "./piece.ts";
import { crossfade, dissolve } from "./transitions.ts";
import { along, clock, colour, dips, fill, filterValue, push, toneMap } from "./video.ts";
import { stages, voiceSound } from "./voice.ts";

const fps = { num: 30, den: 1 };
const graphOf = (args: string[]) => args[args.indexOf("-filter_complex") + 1] ?? "";

test("a seek lands half a second early from the index's time zero and keeps earlier frames; images loop", () => {
  const input = openSource(facts("a", { zero: 1.4 }), 1.25 * SECOND, fps);
  const seek = ["-noaccurate_seek", "-seek_timestamp", "1", "-ss", "2.150000"];
  assert.deepEqual(input.args, [...seek, "-i", "/footage/a.mp4"]);
  assert.equal(decimal(input.offset), "0.5");
  const start = openSource(facts("a"), 0.2 * SECOND, fps);
  assert.equal(start.args[4], "0.000000");
  assert.equal(decimal(start.offset), "0.2");
  const still = openSource(facts("p", { kind: "image" }), 0, { num: 30000, den: 1001 });
  assert.deepEqual(still.args, ["-loop", "1", "-framerate", "30000/1001", "-i", "/footage/p.mp4"]);
});

test("numbers are written in plain decimals", () => {
  assert.equal(decimal(0.1 + 0.2), "0.3");
  assert.equal(decimal(1 / 3), "0.333333333");
  assert.equal(decimal(2), "2");
  assert.equal(decimal(-0.0000000001), "0");
  assert.equal(decimal(1e-7), "0.0000001");
});

test("the clock retimes a span to exactly its frames, holding the last frame if the source ends", () => {
  assert.deepEqual(clock(0.5, { num: 30000, den: 1001 }, 42), [
    "tpad=stop=-1:stop_mode=clone",
    "setpts=PTS-0.501/TB",
    "fps=30000/1001:start_time=0:round=up",
    "trim=end_frame=42",
  ]);
});

test("only PQ and HLG footage is tone-mapped", () => {
  assert.deepEqual(toneMap(null), []);
  for (const hdr of ["pq", "hlg"] as const) {
    const chain = toneMap(hdr).join(",");
    assert.match(chain, /zscale=t=linear.*tonemap=tonemap=hable.*zscale=t=bt709:m=bt709:r=tv/);
  }
});

test("framing crops to the box's shape in displayed pixels, then fills the box", () => {
  const box = { width: 1080, height: 1920 };
  assert.deepEqual(fill(undefined, box, { hdr: null, matrix: null }), [
    "crop=w='min(1*iw,1*ih*1080/1920/sar)/1':h='min(1*ih,1*iw*sar/(1080/1920))/1':x='0.5*iw-ow/2':y='0.5*ih-oh/2'",
    "scale=1080:1920:flags=lanczos:out_color_matrix=bt709:out_range=tv",
    "setsar=1",
  ]);
  // An untagged source is read with the matrix assumed for it, instead of FFmpeg's BT.601.
  assert.equal(
    fill(undefined, box, { hdr: null, matrix: "bt709" })[1],
    "scale=1080:1920:flags=lanczos:in_color_matrix=bt709:out_color_matrix=bt709:out_range=tv",
  );
  const framed = fill(
    { crop: { type: "static", rect: { x: 0.2, y: 0, w: 0.5, h: 1 } }, scale: 1.25 },
    box,
    { hdr: "pq", matrix: null },
  );
  assert.equal(
    framed[0],
    "crop=w='min(0.5*iw,1*ih*1080/1920/sar)/1.25':h='min(1*ih,0.5*iw*sar/(1080/1920))/1.25':x='0.45*iw-ow/2':y='0.5*ih-oh/2'",
  );
  // HDR keeps its colours through the scale and is tone-mapped at the box's size.
  assert.equal(framed[1], "scale=1080:1920:flags=lanczos");
  assert.match(framed.slice(2).join(","), /^zscale=t=linear.*format=yuv420p,setsar=1$/);
});

test("a crop path becomes the crop's centre as an expression of the span's frame number", () => {
  const rect = (x: number) => ({ x, y: 0, w: 0.25, h: 1 });
  const centre = (r: { x: number; w: number }) => r.x + r.w / 2;
  const path: CropPath = {
    type: "path",
    keyframes: [
      { t: 0, rect: rect(0) },
      { t: 40_000, rect: rect(0.5) },
      { t: 80_000, rect: rect(0.5) },
      { t: 400_000, rect: rect(0.75) },
    ],
  };
  // A span from source tick 20 000 at 4000 ticks a frame, read a millisecond (120 ticks) late
  // as the clock reads the picture: keyframes at frames -5.03, 4.97, 14.97 and 94.97; its 10
  // frames need only the first three.
  const span = { start: 20_000, frames: 10, frameTicks: 4000 };
  assert.equal(
    along(path, span, centre),
    "if(lt(n,4.97),0.125+(0.05)*(n-(-5.03)),if(lt(n,14.97),0.625+(0)*(n-(4.97)),0.625))",
  );
  // Before the first keyframe the crop holds it; a span that needs one keyframe is constant.
  const later: CropPath = {
    type: "path",
    keyframes: [
      { t: 8000, rect: rect(0) },
      { t: 48_000, rect: rect(0.5) },
    ],
  };
  assert.equal(
    along(later, { start: 0, frames: 5, frameTicks: 4000 }, centre),
    "if(lt(n,1.97),0.125,if(lt(n,11.97),0.125+(0.05)*(n-(1.97)),0.625))",
  );
  assert.equal(along(later, { start: 0, frames: 2, frameTicks: 4000 }, centre), "0.125");
  const [crop] = fill({ crop: path }, { width: 36, height: 64 }, { hdr: null, matrix: null }, span);
  assert.equal(
    crop,
    "crop=w='min(0.25*iw,1*ih*36/64/sar)/1':h='min(1*ih,0.25*iw*sar/(36/64))/1':" +
      `x='(${along(path, span, centre)})*iw-ow/2':y='(0.5)*ih-oh/2':exact=1`,
  );
});

/** An FFmpeg expression of `n`, evaluated in JavaScript. */
function evaluate(expression: string, n: number): number {
  const code = expression.replaceAll("if(", "IF(").replaceAll("lt(", "LT(");
  const run = new Function("n", "IF", "LT", `return ${code}`);
  return run(
    n,
    (c: boolean, x: number, y: number) => (c ? x : y),
    (x: number, y: number) => x < y,
  );
}

test("a cut in a crop path lands on the frame whose picture it belongs to", () => {
  const rect = (x: number) => ({ x, y: 0, w: 0.25, h: 1 });
  // The new shot starts half a millisecond after frame 5's time, as Matroska's whole
  // milliseconds put it; the clock shows that picture at frame 5, so the crop moves there too.
  const cut = 5 * 4000 + 60;
  const path: CropPath = {
    type: "path",
    keyframes: [
      { t: 0, rect: rect(0) },
      { t: cut - 1, rect: rect(0) },
      { t: cut, rect: rect(0.5) },
      { t: 80_000, rect: rect(0.5) },
    ],
  };
  const expression = along(path, { start: 0, frames: 10, frameTicks: 4000 }, (r) => r.x);
  assert.deepEqual(
    [4, 5, 6].map((n) => evaluate(expression, n)),
    [0, 0.5, 0.5],
  );
});

test("a long crop path is a shallow expression that still follows every keyframe", () => {
  let seed = 3;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const keyframes = Array.from({ length: 200 }, (_, k) => ({
    t: 10_000 + k * 1700 + Math.floor(random() * 1000),
    rect: { x: random() * 0.7, y: 0, w: 0.3, h: 1 },
  }));
  const [first, second, ...rest] = keyframes;
  assert.ok(first && second);
  const path: CropPath = { type: "path", keyframes: [first, second, ...rest] };
  const span = { start: 4000, frames: 100, frameTicks: 4000 };
  const expression = along(path, span, (r) => r.x);
  for (let n = 0; n < span.frames; n++) {
    // Read a millisecond late, as the clock reads the picture.
    const t = span.start + n * span.frameTicks + 120;
    const i = keyframes.findIndex((key) => key.t > t);
    const a = keyframes[i < 0 ? keyframes.length - 1 : i - 1];
    const b = i < 0 ? undefined : keyframes[i];
    let want = first.rect.x;
    if (a && b) want = a.rect.x + ((b.rect.x - a.rect.x) * (t - a.t)) / (b.t - a.t);
    else if (a) want = a.rect.x;
    const got = evaluate(expression, n);
    assert.ok(Math.abs(got - want) < 1e-6, `frame ${n}: ${got} for ${want}`);
  }
  // How many ifs are open at once, at most: halving 200 keyframes takes 8 levels.
  const open: boolean[] = [];
  let depth = 0;
  for (let i = 0; i < expression.length; i++) {
    if (expression[i] === "(") open.push(expression.slice(i - 2, i) === "if");
    if (expression[i] === ")") open.pop();
    depth = Math.max(depth, open.filter(Boolean).length);
  }
  assert.equal(depth, 8);
});

test("a push-in zooms by perspective from the crop's smallest scale, eased frame by frame", () => {
  const box = { width: 1280, height: 720 };
  const facts = { hdr: null, matrix: null } as const;
  const span = { start: 0, frames: 30, frameTicks: 4000 };
  assert.deepEqual(push(undefined, span, box), []);
  assert.deepEqual(push({ scale: 1.12 }, span, box), []);
  const path: ScalePath = {
    type: "path",
    keyframes: [
      { t: 20_000, scale: 1.1 },
      { t: 60_000, scale: 1.21 },
    ],
  };
  // fill() crops at 1.1 and fills a box 10 % larger than the output, so the push, which zooms a
  // further 10 % on frames 5 to 15, takes the footage's own pixels rather than enlarging the
  // output's; push() then brings it back to the output's size.
  const filled = fill({ scale: path }, box, facts);
  assert.match(filled[0] ?? "", /\/1\.1':h=.*\/1\.1':/);
  assert.match(filled[1] ?? "", /^scale=1408:792:/);
  const [filter, size] = push({ scale: path }, span, box);
  const zoom = "if(lt((in-1),5),1,if(lt((in-1),15),1+(0.1)*(1-cos(PI*((in-1)-(5))/10))/2,1.1))";
  assert.equal(
    filter,
    `perspective=x0='(W/2-0.5)*(1-1/(${zoom}))':y0='(H/2-0.5)*(1-1/(${zoom}))'` +
      `:x1='(W/2-0.5)*(1-1/(${zoom}))+W/(${zoom})':y1='(H/2-0.5)*(1-1/(${zoom}))'` +
      `:x2='(W/2-0.5)*(1-1/(${zoom}))':y2='(H/2-0.5)*(1-1/(${zoom}))+H/(${zoom})'` +
      `:x3='(W/2-0.5)*(1-1/(${zoom}))+W/(${zoom})':y3='(H/2-0.5)*(1-1/(${zoom}))+H/(${zoom})'` +
      ":interpolation=cubic:eval=frame:enable='gte(n,5)'",
  );
  assert.equal(size, "scale=1280:720:flags=lanczos");
  // A span wholly after the push holds its end; one wholly before it only comes back to size.
  assert.match(
    push({ scale: path }, { ...span, start: 80_000 }, box)[0] ?? "",
    /^perspective=x0='\(W\/2-0\.5\)\*\(1-1\/\(1\.1\)\)'/,
  );
  assert.deepEqual(push({ scale: path }, { ...span, start: 0, frames: 4 }, box), [
    "scale=1280:720:flags=lanczos",
  ]);
});

test("a punch-in and a push-in zoom about the anchor, which stays where it is on screen", () => {
  const box = { width: 1280, height: 720 };
  const facts = { hdr: null, matrix: null } as const;
  const anchor = { x: 0.25, y: 0.4 };
  // The crop, 1/1.2 of the frame, moves from the centre towards the anchor by (0.25 - 0.5) and
  // (0.4 - 0.5) of the 0.2 frames it gives up.
  const [crop] = fill({ scale: 1.2, anchor }, box, facts);
  assert.match(
    crop ?? "",
    /:x='0\.5\*iw-ow\/2\+\(-0\.25\)\*ow\*0\.2':y='0\.5\*ih-oh\/2\+\(-0\.1\)\*oh\*0\.2'$/,
  );
  const path: ScalePath = {
    type: "path",
    keyframes: [
      { t: 0, scale: 1 },
      { t: 40_000, scale: 1.1 },
    ],
  };
  const [filter] = push({ scale: path, anchor }, { start: 0, frames: 30, frameTicks: 4000 }, box);
  assert.match(
    filter ?? "",
    /^perspective=x0='\(W\*0\.25-0\.5\)\*\(1-1\/\(.*:y0='\(H\*0\.4-0\.5\)\*/,
  );
});

test("the auto grade becomes an eq filter, a match and look a LUT in float RGB", () => {
  assert.deepEqual(colour(undefined), []);
  assert.deepEqual(colour({ auto: { contrast: 1.03, gamma: 1.04, saturation: 0.98 } }), [
    "eq=contrast=1.03:gamma=1.04:saturation=0.98",
  ]);
  assert.deepEqual(colour({ look: { id: "warm", intensity: 1 } }, "/work/grade-0.cube"), [
    "scale=in_color_matrix=bt709:in_range=tv:out_range=pc:flags=accurate_rnd+full_chroma_int",
    "format=gbrpf32le",
    "lut3d=file=/work/grade-0.cube:interp=tetrahedral",
    "scale=in_range=pc:out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int",
  ]);
  assert.equal(filterValue("/a b/c:d,e[f];g'h\\i"), "/a b/c\\\\:d\\,e\\[f\\]\\;g\\\\\\'h\\\\\\\\i");
});

test("dips fade from and to their colour", () => {
  assert.deepEqual(dips({ frames: 8, color: "#ff8800" }, { frames: 7, color: "#000000" }, 60), [
    "fade=t=in:s=0:n=8:c=0xff8800",
    "fade=t=out:s=53:n=7:c=0x000000",
  ]);
  assert.deepEqual(dips(null, { frames: 0, color: "#000000" }, 60), []);
});

test("sound is placed by its timestamps, made exactly as long as its span, and faded", () => {
  assert.equal(
    soundClock("[0:a:0]", 0.5, 1600, 4800),
    "[0:a:0]asetpts=PTS-0.5/TB,aresample=48000:async=1:first_pts=0:min_hard_comp=0.02," +
      "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo," +
      "atrim=start_sample=1600:end_sample=6400,asetpts=PTS-STARTPTS,apad=whole_len=4800",
  );
  assert.match(silence(4800), /^anullsrc=r=48000:cl=stereo,.*atrim=end_sample=4800$/);
  assert.deepEqual(fades(240, 480, 4800), [
    "afade=t=in:ss=0:ns=240:curve=hsin",
    "afade=t=out:ss=4320:ns=480:curve=hsin",
  ]);
  assert.deepEqual(fades(0, 0, 4800), []);
});

test("a dissolve blends picture and sound over the whole piece", () => {
  assert.equal(dissolve(15, fps), "xfade=transition=fade:duration=0.5:offset=0");
  assert.equal(crossfade(24000), "acrossfade=ns=24000:c1=qsin:c2=qsin");
});

test("B-roll rects become even pixel sizes in the output frame", () => {
  const output = project([{ source: "a", in: 0, out: SECOND }]).output;
  assert.deepEqual(placement(undefined, output), { x: 0, y: 0, width: 1280, height: 720 });
  assert.deepEqual(placement({ x: 0.6, y: 0.05, w: 0.35, h: 0.35 }, output), {
    x: 768,
    y: 36,
    width: 448,
    height: 252,
  });
});

test("loudness: silence passes through, sound gets the measured linear gain, length is exact", () => {
  const target = { integratedLufs: -14, truePeakDbtp: -1 };
  const silent = parseMeasurement(
    'blah\n{\n "input_i" : "-inf", "input_tp" : "-inf", "input_lra" : "0.00", ' +
      '"input_thresh" : "-inf", "target_offset" : "inf" }\n',
  );
  assert.equal(silent.input_i, Number.NEGATIVE_INFINITY);
  assert.equal(
    masterAudio("", silent, target, 1000),
    "anull,asettb=1/48000,asetpts=N,atrim=end_sample=1000,apad=whole_len=1000",
  );
  const measured = {
    input_i: -24.5,
    input_tp: -9.2,
    input_lra: 14.3,
    input_thresh: -35,
    target_offset: 0.3,
  };
  assert.equal(
    masterAudio("", measured, target, 1000),
    "loudnorm=I=-14:TP=-1:LRA=15:measured_I=-24.5:measured_TP=-9.2:measured_LRA=14.3" +
      ":measured_thresh=-35:offset=0.3:linear=true,aresample=48000,asettb=1/48000,asetpts=N," +
      "atrim=end_sample=1000,apad=whole_len=1000",
  );
  // A ceiling limits the true peak after loudnorm, oversampled 4×.
  assert.match(
    masterAudio("", measured, target, 1000, -2),
    /:linear=true,aresample=48000,aresample=192000,alimiter=limit=0\.794328235:attack=1:release=50:level=0:latency=1,aresample=48000,asettb/,
  );
  // A mix above 0 LUFS is turned down to -1 LUFS first, as loudnorm takes no hotter measurement.
  assert.match(
    masterAudio("", { ...measured, input_i: 2.95, input_tp: 2.06, input_thresh: -7.05 }, target, 1),
    /^volume=-3\.95dB,loudnorm=.*:measured_I=-1:measured_TP=-1\.89:.*:measured_thresh=-11:/,
  );
  assert.equal(linearReach(measured, target), false);
  assert.equal(linearReach({ ...measured, input_tp: -12 }, target), true);
  assert.throws(() => parseMeasurement("no json here"), /printed no measurement/);
});

test("the encoder fills whole AAC frames, then writes H.264 High and AAC for streaming", () => {
  assert.equal(alignToAacFrames(2048), "anull");
  assert.equal(alignToAacFrames(48000), "adelay=delays=128S:all=1,asetpts=PTS-128");
  const args = encoderArgs(
    project([{ source: "a", in: 0, out: SECOND }]).output,
    "/tmp/mix.f32",
    48000,
    "/out.mp4",
  );
  const joined = args.join(" ");
  assert.match(
    joined,
    /-f rawvideo -pix_fmt yuv420p -video_size 1280x720 -framerate 30\/1 -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -i pipe:0/,
  );
  assert.match(
    joined,
    /-f f32le -ar 48000 -ac 2 -i \/tmp\/mix\.f32 -filter_complex \[1:a\]adelay=delays=128S/,
  );
  assert.match(joined, /-c:v libx264 -profile:v high .* -pix_fmt yuv420p -colorspace bt709/);
  assert.match(
    joined,
    /-c:a aac -b:a 192k -ar 48000 -movflags \+faststart -progress pipe:1 \/out\.mp4$/,
  );
});

const timeline = (main: Project["main"], extra: Partial<Project> = {}) =>
  buildTimeline(
    project(main, extra),
    sources(facts("a"), facts("b", { audio: false, hdr: "hlg" })),
  );
const clip = (source: string, start: number, seconds: number) => ({
  source,
  in: start * SECOND,
  out: (start + seconds) * SECOND,
});

test("a piece's picture chains clock, tone map, framing, grade and fades into raw frames", () => {
  const edit = timeline([clip("a", 0, 1), clip("b", 2, 1)]);
  const [first, second] = cutPieces(edit).map((p) => pieceVideo(p, edit));
  assert.ok(first && second);
  assert.match(
    graphOf(first),
    /^\[0:v\]tpad=stop=-1:stop_mode=clone,setpts=PTS-0\.001\/TB,fps=30\/1.*crop=.*scale=1280:720.*format=yuv420p\[m0\];\[m0\]format=yuv420p\[v\]$/,
  );
  assert.doesNotMatch(graphOf(first), /tonemap/);
  assert.match(graphOf(second), /tonemap/);
  assert.deepEqual(first.slice(-7), [
    "-map",
    "[v]",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "yuv420p",
    "pipe:1",
  ]);
});

test("a dissolve piece blends two inputs; B-roll is overlaid at its rect", () => {
  const edit = timeline(
    [
      clip("a", 0, 2),
      { ...clip("a", 5, 2), transition: { type: "dissolve", duration: SECOND / 2 } },
    ],
    {
      broll: [
        {
          source: "b",
          in: 0,
          out: SECOND,
          start: SECOND,
          rect: { x: 0.5, y: 0, w: 0.5, h: 0.5 },
          fade: SECOND / 10,
        },
      ],
    },
  );
  const blend = cutPieces(edit)[1];
  assert.ok(blend);
  const graph = graphOf(pieceVideo(blend, edit));
  assert.match(graph, /\[m0\]\[m1\]xfade=transition=fade:duration=0\.5:offset=0\[dissolved\]/);
  assert.match(
    graph,
    /\[2:v\].*scale=640:360.*fade=t=in:alpha=1:st=0:d=0\.1.*setpts=PTS-STARTPTS\+0\/TB\[b0\]/,
  );
  assert.match(
    graph,
    /\[dissolved\]\[b0\]overlay=x=640:y=0:eof_action=pass:repeatlast=0\[o0\];\[o0\]format=yuv420p\[v\]$/,
  );
});

test("overlays go over the B-roll, each frame counted onto the piece's own frame times", () => {
  const edit = timeline([clip("a", 0, 2), clip("a", 5, 2)], {
    broll: [{ source: "b", in: 0, out: SECOND, start: 1.5 * SECOND }],
    overlays: [
      { template: "keyword", params: { text: "x" }, start: SECOND, duration: 2 * SECOND },
      { template: "wipe", params: {}, start: 1.75 * SECOND, duration: SECOND / 2 },
    ],
  });
  const files = ["/cache/keyword.webm", "/cache/wipe.webm"];
  const [first, second] = cutPieces(edit).map((p) => pieceVideo(p, edit, files));
  assert.ok(first && second);
  // Frames 30-90 of the keyword and 53-68 of the wipe: in the second piece, the keyword's
  // frames 30-59 start at its frame 0, and the wipe's frames 7-14.
  assert.deepEqual(second.slice(second.indexOf("/cache/keyword.webm") - 3).slice(0, 8), [
    "-c:v",
    "libvpx-vp9",
    "-i",
    "/cache/keyword.webm",
    "-c:v",
    "libvpx-vp9",
    "-i",
    "/cache/wipe.webm",
  ]);
  const graph = graphOf(second);
  assert.match(
    graph,
    /\[2:v\]trim=start_frame=30:end_frame=60,settb=expr=1\/30,setpts=N\+0,format=yuva420p\[e0\];\[o0\]\[e0\]overlay=x=0:y=0:eof_action=pass:repeatlast=0\[f0\]/,
  );
  assert.match(
    graph,
    /\[3:v\]trim=start_frame=7:end_frame=15,settb=expr=1\/30,setpts=N\+0,format=yuva420p\[e1\];\[f0\]\[e1\]overlay=x=0:y=0:eof_action=pass:repeatlast=0\[f1\];\[f1\]format=yuv420p\[v\]$/,
  );
  assert.match(graphOf(first), /\[2:v\]trim=start_frame=0:end_frame=30,.*setpts=N\+30,/);
  assert.match(graphOf(first), /\[3:v\]trim=start_frame=0:end_frame=7,.*setpts=N\+53,/);
  assert.throws(
    () => pieceVideo(cutPieces(edit)[0] as Piece, edit),
    /overlays\/0: has no rendered file/,
  );
});

test("a piece's sound: silence for a source without any, cross-fades and B-roll mixed in", () => {
  const edit = timeline(
    [
      clip("b", 0, 2),
      { ...clip("a", 5, 2), transition: { type: "dissolve", duration: SECOND / 2 } },
    ],
    {
      broll: [
        { source: "a", in: 0, out: SECOND, start: SECOND, gainDb: -6 },
        { source: "a", in: 0, out: SECOND, start: SECOND },
      ],
    },
  );
  const blend = cutPieces(edit)[1];
  assert.ok(blend);
  const args = pieceAudio(blend, edit);
  const graph = graphOf(args);
  // b has no sound: no input is opened for it, and its span is silence.
  assert.match(graph, /^anullsrc=r=48000:cl=stereo,.*\[m0\];\[0:a:0\]/);
  assert.match(graph, /\[m0\]\[m1\]acrossfade=ns=24000:c1=qsin:c2=qsin\[dissolved\]/);
  // Only the B-roll with a gain is heard. Each sound is opened where its clip starts and cut
  // from there, so the B-roll's second half here follows its first half sample for sample.
  assert.deepEqual(
    args.filter((_, i) => args[i - 1] === "-ss"),
    ["4.500000", "0.000000"],
  );
  assert.match(graph, /\[1:a:0\]asetpts=PTS-0\/TB,.*,atrim=start_sample=24000:end_sample=48000,/);
  assert.match(graph, /\[1:a:0\].*volume=-6dB,asetpts=PTS-STARTPTS,adelay=delays=0S:all=1\[b0\]/);
  assert.match(
    graph,
    /\[dissolved\]\[b0\]amix=inputs=2:duration=first:dropout_transition=0:normalize=0\[a\]$/,
  );
  assert.deepEqual(args.slice(-11), [
    "-map",
    "[a]",
    "-c:a",
    "pcm_f32le",
    "-f",
    "f32le",
    "-ar",
    "48000",
    "-ac",
    "2",
    "pipe:1",
  ]);
  assert.equal(args.filter((arg) => arg === "-i").length, 2);
});

test("ducking starts down before speech, comes back up after it, and bridges short pauses", () => {
  const at = (curve: Float32Array, seconds: number) => curve[Math.round(seconds * ENVELOPE_RATE)];
  // Speech 1-2 s and 2.8-3 s: the 0.8 s pause is shorter than 0.2 + 0.3 + MIN_RISE.
  const depth = duckDepth(
    [
      [1, 2],
      [2.8, 3],
      [5, 6],
    ],
    0,
    7,
    0.2,
    0.3,
  );
  assert.equal(depth.length, 7001);
  assert.equal(at(depth, 0.7), 0);
  assert.ok(Math.abs((at(depth, 0.9) ?? 0) - 0.5) < 1e-6, "halfway down half the attack early");
  assert.equal(at(depth, 1), 1);
  assert.equal(at(depth, 2.4), 1);
  assert.ok(Math.abs((at(depth, 3.15) ?? 0) - 0.5) < 1e-6, "halfway up half the release late");
  assert.equal(at(depth, 3.4), 0);
  assert.equal(at(depth, 4.7), 0);
  assert.equal(MIN_RISE, 0.5);
  // A curve that starts at 4 s reads speech at 5 s one second in.
  assert.equal(duckDepth([[5, 6]], 4, 3, 0.2, 0.3)[Math.round(1.5 * ENVELOPE_RATE)], 1);
  const gains = duckGains(new Float32Array([0, 0.5, 1]), -12);
  assert.deepEqual(
    [...gains].map((g) => Number((20 * Math.log10(g)).toFixed(3))),
    [0, -6, -12],
  );
});

test("music rides further down under speech quieter than the edit's own", () => {
  // Momentary loudness every 100 ms, value k over [0.1k - 0.3, 0.1k + 0.1] s, as FFmpeg prints
  // it: speech at -20 LUFS from 1 to 3 s, at -30 from 3.2 to 5 s, and at -20 from 7 to 8 s.
  const level = (k: number) => {
    const c = 0.1 * k - 0.1;
    return (c > 1.1 && c < 2.9) || (c > 7.1 && c < 7.9) ? -20 : c > 3.3 && c < 4.9 ? -30 : -120;
  };
  const text = Array.from({ length: 90 }, (_, k) => `frame:${k} pts:${k * 4800} pts_time:${k / 10}\nlavfi.r128.M=${level(k).toFixed(3)}\n`).join(""); // biome-ignore format: one line
  const momentary = parseMomentary(text);
  assert.equal(momentary.length, 90);
  const speech: [number, number][] = [
    [1, 3],
    [3.2, 5],
    [7, 8],
  ];
  const ride = rides(speech, momentary);
  // The edit's speech: the power mean of the windows that lie inside a stretch, 17 and 7 of them
  // at -20 and 15 at -30.
  const edit = 10 * Math.log10((24 * 10 ** -2 + 15 * 10 ** -3) / 39);
  assert.deepEqual(ride.map((r) => Number(r.toFixed(6))), [0, Number((edit + 30).toFixed(6)), 0]); // biome-ignore format: one line
  const silent = rides(
    speech,
    momentary.map((v) => (v === -30 ? -60 : v)),
  );
  assert.equal(silent[1], MAX_RIDE_DB);

  const edits = project([clip("a", 0, 9)]);
  const music: Project["audio"]["music"] = [
    { source: "m", license: { name: "CC0 1.0" }, in: 0, out: 9 * SECOND, start: 0, gainDb: -6, ducking: { depthDb: -12, attackMs: 250, releaseMs: 750 } }, // biome-ignore format: one line
  ];
  const timeline = buildTimeline(
    { ...edits, audio: { ...edits.audio, music } },
    sources(facts("a"), facts("m", { kind: "audio", frameTicks: null })),
  );
  const track = timeline.music[0];
  assert.ok(track);
  const gains = envelopeOf(track, speech, ride);
  assert.ok(gains);
  const db = (seconds: number) => 20 * Math.log10(gains[Math.round(seconds * ENVELOPE_RATE)] ?? 0);
  const deeper = -12 - (ride[1] ?? 0);
  const near = (actual: number, expected: number, what: string) =>
    assert.ok(Math.abs(actual - expected) < 1e-3, `${what}: ${actual} dB, not ${expected}`);
  near(db(2), -12, "under the loud speech");
  near(db(2.74), -12, "until the attack before the quiet speech");
  near(db(3.2), deeper, "down already as the quiet speech starts");
  near(db(4.5), deeper, "under the quiet speech");
  near(db(5.375), deeper / 2, "halfway back up halfway through the release");
  near(db(6.5), 0, "up in the pause");
  near(db(7.5), -12, "under the loud speech again");
  // No step in the gain: the ride comes in over the attack, as the ducking does, whose raised
  // cosine down 20 dB in 250 ms is steepest at 0.13 dB a millisecond.
  let steepest = 0;
  for (let i = 1; i < gains.length; i++) {
    const step = Math.abs(20 * Math.log10((gains[i] ?? 1) / (gains[i - 1] ?? 1)));
    steepest = Math.max(steepest, step);
  }
  assert.ok(steepest < 0.14, `${steepest} dB in a millisecond`);
});

test("the music bed: each range clocked, faded, at its gain, ducked, placed and mixed", () => {
  const license = { name: "CC0 1.0" };
  const music: Project["audio"]["music"] = [
    {
      source: "m",
      license,
      in: 10 * SECOND,
      out: 12 * SECOND,
      start: 0,
      gainDb: -9,
      fadeIn: SECOND,
      ducking: { depthDb: -12, attackMs: 250, releaseMs: 750 },
    },
    { source: "m", license, in: 3 * SECOND, out: 5 * SECOND, start: 2 * SECOND, gainDb: -9 },
  ];
  const edit = project([clip("a", 0, 4)]);
  const withMusic = buildTimeline(
    { ...edit, audio: { ...edit.audio, music } },
    sources(facts("a"), facts("b"), facts("m", { kind: "audio", frameTicks: null })),
  );
  const args = musicBed(withMusic, ["/work/duck-0.f32", null], "/work/music.f32");
  const graph = graphOf(args);
  // Each track is decoded from its start, not sought, and cut where its range starts.
  assert.ok(!args.includes("-ss"));
  assert.deepEqual(
    args.filter((_, i) => args[i - 1] === "-i"),
    ["/footage/m.mp4", "/work/duck-0.f32", "/footage/m.mp4"],
  );
  assert.match(graph, /^\[0:a:0\]asetpts=PTS-0\/TB,.*atrim=start_sample=480000:end_sample=576000,/);
  assert.match(
    graph,
    /afade=t=in:ss=0:ns=48000:curve=qsin,afade=t=out:ss=95760:ns=240:curve=hsin,volume=-9dB\[s0\]/,
  );
  assert.match(graph, /\[1:a\]aresample=48000,pan=stereo\|c0=c0\|c1=c0,aformat=sample_fmts=fltp,apad=whole_len=96000,atrim=end_sample=96000\[g0\]/); // biome-ignore format: one line
  assert.match(graph, /\[s0\]\[g0\]amultiply,adelay=delays=0S:all=1\[m0\]/);
  assert.match(graph, /\[2:a:0\].*volume=-9dB,adelay=delays=96000S:all=1\[m1\]/);
  assert.match(
    graph,
    /\[m0\]\[m1\]amix=inputs=2:duration=longest:dropout_transition=0:normalize=0,apad=whole_len=192000,atrim=end_sample=192000\[a\]$/,
  );
  assert.equal(args.at(-1), "/work/music.f32");
  assert.match(graphOf(addBed("/v.f32", "/m.f32", "/o.f32")), /amix=inputs=2:duration=first/);
});

test("a voice chain mixes the stem's recording back under its denoised speech, then plays in both channels", () => {
  const sound = { input: "[0:a:0]", offset: 0.5 };
  const clocked =
    "[0:a:0]asetpts=PTS-0.5/TB,aresample=48000:async=1:first_pts=0:min_hard_comp=0.02";
  const mono = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=mono";
  const sum = "amix=inputs=2:duration=longest:dropout_transition=0:normalize=0";
  const { lines, out } = voiceSound(sound, { denoise: { attenuationLimitDb: 20 } }, "v0");
  assert.equal(out, "[v0v]");
  assert.deepEqual(lines, [
    `${clocked},pan=mono|c0=0.1*c0+0.9*c1,${mono}[v0c]`,
    "[v0c]pan=stereo|c0=c0|c1=c0[v0v]",
  ]);
  // Without denoising, the source's sound; the de-esser splits the sound at its frequency.
  const plain = voiceSound(
    sound,
    {
      deesser: { frequencyHz: 6000, intensity: 0.4, thresholdDb: -40 },
      limiter: { ceilingDb: -9 },
    },
    "v1",
  );
  assert.deepEqual(plain.lines, [
    `${clocked},${mono}[v1c]`,
    "[v1c]acrossover=split=6000:order=4th[v1lo][v1hi]",
    "[v1hi]acompressor=threshold=0.01:ratio=3:attack=1:release=50:detection=rms[v1hc]",
    `[v1lo][v1hc]${sum},alimiter=limit=0.354813389:attack=5:release=50:level=0:latency=1,` +
      "pan=stereo|c0=c0|c1=c0[v1v]",
  ]);
});

test("each voice stage becomes its filter, in the chain's order", () => {
  assert.deepEqual(
    stages({
      compressor: { thresholdDb: -20, ratio: 3, attackMs: 10, releaseMs: 120, makeupDb: -2.5 },
      eq: [
        { type: "peak", frequencyHz: 300, gainDb: -3, q: 1 },
        { type: "highShelf", frequencyHz: 8000, gainDb: 1.5, q: 0.7 },
      ],
      highpassHz: 80,
      dereverb: { amount: 0.5, thresholdDb: -40 },
      level: { targetDb: -20, windowSeconds: 3, maxGainDb: 12 },
    }),
    [
      "agate=threshold=0.01:ratio=2:range=0.501187234:attack=5:release=80:detection=rms",
      "highpass=f=80",
      "equalizer=f=300:t=q:w=1:g=-3",
      "highshelf=f=8000:t=q:w=0.7:g=1.5",
      "dynaudnorm=f=200:g=15:p=0.95:m=3.981071706:r=0.1",
      "acompressor=threshold=0.1:ratio=3:attack=10:release=120:detection=rms",
      "volume=-2.5dB",
    ],
  );
  assert.deepEqual(stages({}), []);
});

test("a clip whose source's chain denoises plays from its stem, opened a second early", () => {
  const voice = { chain: { denoise: { attenuationLimitDb: 20 } }, stem: "/footage/a.voice.wav" };
  // The stem starts at the source's time zero, so its own timestamps start at 0 whatever the
  // source's zero is.
  const timeline = buildTimeline(
    project([{ source: "a", in: 2 * SECOND, out: 3 * SECOND }]),
    sources(facts("a", { voice, zero: 1.4 })),
  );
  const [piece] = cutPieces(timeline);
  assert.ok(piece);
  const args = pieceAudio(piece, timeline);
  assert.deepEqual(
    args.filter((arg) => arg.endsWith(".mp4") || arg.endsWith(".wav")),
    ["/footage/a.voice.wav"],
  );
  // It opens half a second before the chain's start, 1 s into the source; the clip is the
  // chain's second second.
  assert.deepEqual(
    args.filter((_, i) => args[i - 1] === "-ss"),
    ["0.500000"],
  );
  const graph = graphOf(args);
  assert.equal(graph.match(/asetpts=PTS-0\.5\/TB/g)?.length, 1);
  assert.match(
    graph,
    /\[v0v\]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,atrim=start_sample=48000:end_sample=96000,/,
  );
});
