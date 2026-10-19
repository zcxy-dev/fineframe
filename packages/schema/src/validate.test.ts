import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Project } from "./generated/project.ts";
import {
  loadJson,
  SchemaError,
  validateMediaIndex,
  validateMusicIndex,
  validateProgress,
  validateProject,
} from "./validate.ts";

const example = (name: string) => fileURLToPath(new URL(`../examples/${name}`, import.meta.url));

async function exampleProject(): Promise<Project> {
  return loadJson(example("project.example.json"), validateProject);
}

function at<T>(items: T[] | undefined, i: number): T {
  const item = items?.[i];
  assert.ok(item);
  return item;
}

/** Validating `project` fails with a message that contains `expected`. */
function rejects(project: unknown, expected: string) {
  assert.throws(
    () => validateProject(project),
    (error: unknown) => error instanceof SchemaError && error.message.includes(expected),
    expected,
  );
}

test("the examples validate", async () => {
  const project = await exampleProject();
  assert.equal(project.main.length, 4);
  const index = await loadJson(example("media-index.example.json"), validateMediaIndex);
  assert.equal(index.transcript.words[3]?.text, "Claude");
  const music = await loadJson(example("music-index.example.json"), validateMusicIndex);
  assert.equal(music.downbeats[1], music.beats[4]);
});

test("a project with an unknown field names it", async () => {
  const project = await exampleProject();
  rejects({ ...project, cuts: [] }, "/: must NOT have additional properties (cuts)");
});

test("times must be whole ticks", async () => {
  const project = await exampleProject();
  project.main[0].in = 1.5;
  rejects(project, "/main/0/in: must be integer");
});

test("every source a project names must exist", async () => {
  const project = await exampleProject();
  at(project.main, 1).source = "talk-c";
  at(project.audio.music, 0).source = "song";
  rejects(project, "/main/1/source: no source has the id talk-c");
  rejects(project, "/audio/music/0/source: no source has the id song");
});

test("source ids are unique", async () => {
  const project = await exampleProject();
  at(project.sources, 1).id = "talk-a";
  rejects(project, "/sources/1/id: talk-a is used twice");
});

test("ranges run forward", async () => {
  const project = await exampleProject();
  project.main[0].out = project.main[0].in;
  rejects(project, "/main/0: ends at 144000, not after its start 144000");
  const moment = at(project.plan?.emphasis, 0);
  moment.end = moment.start;
  rejects(project, "/plan/emphasis/0: ends at 1260000, not after its start 1260000");
});

test("the first clip has no transition", async () => {
  const project = await exampleProject();
  project.main[0].transition = { type: "dissolve", duration: 60_000 };
  rejects(project, "/main/0/transition");
});

test("crop keyframes move forward in time", async () => {
  const project = await exampleProject();
  const crop = at(project.main, 2).framing?.crop;
  assert.equal(crop?.type, "path");
  if (crop?.type === "path") at(crop.keyframes, 1).t = crop.keyframes[0].t;
  rejects(project, "/main/2/framing/crop/keyframes/1/t: not after the keyframe before");
});

test("scale keyframes move forward in time", async () => {
  const project = await exampleProject();
  const scale = at(project.main, 3).framing?.scale;
  assert.ok(typeof scale === "object");
  at(scale.keyframes, 1).t = scale.keyframes[0].t;
  rejects(project, "/main/3/framing/scale/keyframes/1/t: not after the keyframe before");
});

test("a dissolve fits in both clips it joins", async () => {
  const project = await exampleProject();
  // The clip before lasts 774 000 ticks.
  at(project.main, 2).transition = { type: "dissolve", duration: 800_000 };
  rejects(project, "/main/1: its transitions need 800000 ticks, but it lasts 774000");
});

test("a clip's incoming and outgoing transitions fit in it together", async () => {
  const project = await exampleProject();
  // Each fits on its own in the 1 032 000-tick clip, but 60 000 + 990 000 do not.
  at(project.main, 3).transition = { type: "dissolve", duration: 990_000 };
  rejects(project, "/main/2: its transitions need 1050000 ticks, but it lasts 1032000");
});

test("a dip's fade in fits in its clip", async () => {
  const project = await exampleProject();
  const clip = at(project.main, 3);
  clip.out = clip.in + 100_000;
  clip.transition = { type: "dip", duration: 200_000, color: "#000000" };
  validateProject(project);
  // An odd duration splits on whole ticks: 100 000 to fade out, then 100 001 to fade in.
  clip.transition.duration = 200_001;
  rejects(project, "/main/3: its transitions need 100001 ticks, but it lasts 100000");
});

test("B-roll rects stay inside the frame", async () => {
  const project = await exampleProject();
  const broll = at(project.broll, 0);
  if (broll.rect) broll.rect.h = 0.95;
  rejects(project, "/broll/0/rect: x + w and y + h may not exceed 1");
});

test("a crop may reach past the picture but not lie wholly off it", async () => {
  const project = await exampleProject();
  const crop = at(project.main, 0).framing?.crop;
  assert.equal(crop?.type, "static");
  if (crop?.type === "static") {
    crop.rect = { x: 0, y: -1.08, w: 1, h: 3.16 };
    crop.below = { x: 0.2, y: 0, w: 0.3, h: 0.5 };
  }
  validateProject(project);
  if (crop?.type === "static") crop.below = { x: 1.2, y: 0, w: 0.3, h: 0.5 };
  rejects(project, "/main/0/framing/crop/below: lies wholly off the picture");
});

test("a crop path changes size or splits the area only at a cut", async () => {
  const project = await exampleProject();
  const path = at(project.main, 2).framing?.crop;
  assert.equal(path?.type, "path");
  if (path?.type !== "path") return;
  const [, second, third] = path.keyframes;
  assert.ok(second && third);
  third.rect = { ...third.rect, w: 0.5, h: 1.58 };
  rejects(
    project,
    "/main/2/framing/crop/keyframes/2: changes size or split more than a tick after the keyframe before",
  );
  third.t = second.t + 1;
  validateProject(project);
  third.rect = { ...second.rect };
  third.below = { ...second.rect };
  validateProject(project);
  third.t = second.t + 2;
  rejects(
    project,
    "/main/2/framing/crop/keyframes/2: changes size or split more than a tick after the keyframe before",
  );
});

test("loudness targets stay within what loudness normalisation can reach", async () => {
  const project = await exampleProject();
  project.audio.loudness = { integratedLufs: -3, truePeakDbtp: -10 };
  rejects(project, "/audio/loudness/integratedLufs: must be <= -5");
  rejects(project, "/audio/loudness/truePeakDbtp: must be >= -9");
});

test("each reference names a source of a kind it can use", async () => {
  const project = await exampleProject();
  at(project.main, 0).source = "music";
  at(project.audio.music, 0).source = "talk-a";
  rejects(project, "/main/0/source: music is audio, not video or image");
  rejects(project, "/audio/music/0/source: talk-a is video, not audio");
});

test("a source has one voice decision", async () => {
  const project = await exampleProject();
  at(project.audio.voice, 1).source = "talk-a";
  rejects(project, "/audio/voice/1/source: talk-a already has a voice decision");
});

test("the denoised speech is a file beside its media index", async () => {
  const index = await loadJson(example("media-index.example.json"), validateMediaIndex);
  assert.ok(index.voice);
  for (const stem of ["/footage/talk.voice.wav", "../talk.voice.wav", "C:\\talk.voice.wav", ".."]) {
    index.voice.stem = stem;
    assert.throws(() => validateMediaIndex(index), /\/voice\/stem: must match pattern/, stem);
  }
});

test("caption words lie within their line", async () => {
  const project = await exampleProject();
  at(at(project.captions?.lines, 0).words, 0).start = 0;
  rejects(project, "/captions/lines/0/words/0: outside its line, 36000 to 252000");
});

test("an image clip starts at 0", async () => {
  const project = await exampleProject();
  project.sources.push({
    id: "card",
    kind: "image",
    path: "footage/card.png",
    fingerprint: { bytes: 1, sha256: "0".repeat(64) },
  });
  project.main[1] = { source: "card", in: 0, out: 120_000 };
  validateProject(project);
  project.main[1].in = 12_000;
  rejects(project, "/main/1/in: an image has no time of its own, so its clips start at 0");
});

test("the output frame rate and size must be usable", async () => {
  const project = await exampleProject();
  project.output.fps = { num: 7, den: 3 };
  rejects(project, "/output/fps: a frame at 7/3 fps is not a whole number of ticks");
  project.output.fps = { num: 30, den: 1 };
  project.output.width = 1920;
  rejects(project, "/output: 1920x1920 is not 9:16");
});

test("progress lines validate, and done carries the outputs", () => {
  validateProgress({ stage: "analyze", file: "a.mp4", fraction: 0.1, message: "Detecting shots" });
  validateProgress({
    stage: "done",
    fraction: 1,
    message: "Finished",
    outputs: { video: "/out/edit.mp4", project: "/out/edit.project.json" },
  });
  assert.throws(() => validateProgress({ stage: "done", fraction: 1, message: "" }), SchemaError);
  assert.throws(
    () => validateProgress({ stage: "render", fraction: 1.2, message: "" }),
    SchemaError,
  );
});

test("loading names the file that failed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "schema-"));
  const broken = join(dir, "broken.json");
  await writeFile(broken, "{");
  await assert.rejects(loadJson(broken, validateProject), (error: Error) =>
    error.message.startsWith(`${broken}:`),
  );
  const wrong = join(dir, "wrong.json");
  await writeFile(wrong, JSON.stringify({ version: 2 }));
  await assert.rejects(loadJson(wrong, validateMediaIndex), SchemaError);
});
