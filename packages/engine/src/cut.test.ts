import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { type Project, validateProject, type Word } from "@video-editor/schema";
import { cutEdit } from "./cut.ts";
import { ffmpeg, QUIET, run as runFfmpeg } from "./ffmpeg.ts";
import { MARGIN, type PlaceSource } from "./plan/place.ts";
import { project as projectOf, SECOND, scratch } from "./testing.ts";

const FRAME = 4000;
const s = (seconds: number) => Math.round(seconds * SECOND);

/** Ten words of 0.3 s, one every 0.5 s from 0.1 s: w0 … w9. */
const words: Word[] = Array.from({ length: 10 }, (_, k) => ({
  text: `w${k}`,
  start: k * 0.5 + 0.1,
  end: k * 0.5 + 0.4,
}));
const sources = new Map<string, PlaceSource>(
  ["a", "b"].map((id) => [id, { id, words, duration: 60, frameTicks: FRAME }]),
);

/** Source a for 5 s, then source b for 3 s, captioned word by word, with a title over the
 * opening, a wipe at 1.2 s and at 6 s, and music under all of it. */
function edit(): Project {
  const captionWords = (offset: number, count: number) =>
    words.slice(0, count).map((word) => ({
      text: word.text,
      start: s(offset + word.start),
      end: s(offset + word.end),
    }));
  const line = (offset: number, count: number) => {
    const timed = captionWords(offset, count);
    return {
      start: timed[0]?.start ?? 0,
      end: (timed.at(-1)?.end ?? 0) + s(0.3),
      language: "en" as const,
      text: timed.map((word) => word.text).join(" "),
      words: timed,
    };
  };
  const wipe = (start: number) => ({
    template: "wipe",
    params: {},
    start: s(start),
    duration: s(0.5),
  });
  return projectOf(
    [
      { source: "a", in: 0, out: s(5) },
      { source: "b", in: 0, out: s(3) },
    ],
    {
      sources: [
        ...projectOf([{ source: "a", in: 0, out: s(1) }]).sources,
        {
          id: "m",
          kind: "audio",
          path: "m.wav",
          index: "m.json",
          fingerprint: { bytes: 1, sha256: "0".repeat(64) },
        },
      ],
      captions: { preset: "bold", srt: true, lines: [line(0, 10), line(5, 6)] },
      overlays: [
        { template: "title", params: { text: "T" }, start: 0, duration: s(3) },
        wipe(1.2),
        wipe(6),
      ],
      audio: {
        loudness: { integratedLufs: -14, truePeakDbtp: -1 },
        music: [
          {
            source: "m",
            license: { name: "CC0 1.0" },
            in: s(10),
            out: s(18),
            start: 0,
            gainDb: -20,
            fadeOut: s(1),
          },
        ],
      },
    },
  );
}

test("a cut inside a clip splits it in the pauses beside the words kept", () => {
  const { project, length, notes } = cutEdit(edit(), [[s(1), s(2)]], sources);
  validateProject(project);
  // w2 and w3 go: the first piece ends in the pause after w1, the second starts in the one
  // before w4, and each lasts whole frames.
  const [first, second, third] = project.main;
  assert.deepEqual(first, { source: "a", in: 0, out: s(1) });
  assert.deepEqual(second, { source: "a", in: s(2), out: s(5) });
  assert.deepEqual(third, { source: "b", in: 0, out: s(3) });
  for (const clip of project.main) assert.equal((clip.out - clip.in) % FRAME, 0);
  assert.ok((first?.out ?? 0) >= s((words[1] as Word).end + MARGIN));
  assert.ok((second?.in ?? 0) <= s((words[4] as Word).start - MARGIN));
  assert.equal(length, s(7));
  assert.match(notes[0] ?? "", /w2 w3/);

  const [line, next] = project.captions?.lines ?? [];
  assert.equal(line?.text, "w0 w1 w4 w5 w6 w7 w8 w9");
  assert.deepEqual(
    line?.words?.map((word) => word.start),
    [0.1, 0.6, 1.1, 1.6, 2.1, 2.6, 3.1, 3.6].map(s),
  );
  // The line keeps the 0.3 s it stayed up after its last word.
  assert.equal(line?.end, s(4.9 + 0.3 - 1));
  assert.equal(next?.start, s(4.1));

  // The wipe wholly inside the cut goes; the title and the later one move up with the speech.
  assert.deepEqual(
    project.overlays?.map((overlay) => [overlay.template, overlay.start]),
    [
      ["title", 0],
      ["wipe", s(5)],
    ],
  );
  assert.ok(notes.some((note) => /\/overlays\/1 \(wipe\)/.test(note)));
  // The music plays on without a gap and ends where the edit does, with its fade.
  assert.deepEqual(project.audio.music?.[0], { ...edit().audio.music?.[0], out: s(17) });
});

test("a range that starts inside one word and ends inside the next lands in the pauses", () => {
  // From inside w1 (0.6–0.9 s) to inside w2 (1.1–1.4 s): only w2's middle is in it.
  const { removed, length } = cutEdit(edit(), [[s(0.8), s(1.3)]], sources);
  assert.equal(removed.length, 1);
  const [from, to] = removed[0] as [number, number];
  // Clear of w1 and w3 by the margin the planner leaves, and covering all of w2.
  assert.ok(from >= s((words[1] as Word).end + MARGIN), "not inside w1");
  assert.ok(to <= s((words[3] as Word).start - MARGIN), "not inside w3");
  assert.ok(from <= s((words[2] as Word).start) && to >= s((words[2] as Word).end));
  assert.equal(length, s(8) - (to - from));
});

/** The test words, with w4 said straight after w3 and, with `both`, w5 straight after w4. */
function joinedSources(both: boolean): Map<string, PlaceSource> {
  const joined = words.map((word, k) =>
    k === 4 ? { ...word, start: 1.9 } : both && k === 5 ? { ...word, start: 2.4 } : word,
  );
  return new Map(
    ["a", "b"].map((id) => [id, { id, words: joined, duration: 60, frameTicks: FRAME }]),
  );
}

test("an edge with no pause moves inward, keeping a word asked for rather than taking one more", () => {
  // w4 to w6 asked for; w3 runs straight into w4, so the cut starts in the pause after w4.
  const { notes, removed, outside } = cutEdit(edit(), [[s(2.0), s(3.3)]], joinedSources(false));
  assert.match(notes[0] ?? "", /: w5 w6$/);
  assert.deepEqual(outside, []);
  const [from, to] = removed[0] as [number, number];
  assert.ok(from >= s((words[4] as Word).end + MARGIN), "w4 stays");
  assert.ok(to <= s((words[7] as Word).start - MARGIN));
  // An edge already in a pause stays where it is: w1 alone goes.
  assert.match(cutEdit(edit(), [[s(0.6), s(0.9)]], joinedSources(false)).notes[0] ?? "", /: w1$/);
});

test("a stretch with no pause inside grows out to the nearest ones, and says what it took", () => {
  // Only w4 asked for, said without a pause on either side: w3 and w5 go with it.
  const { notes, removed, outside } = cutEdit(edit(), [[s(2.1), s(2.2)]], joinedSources(true));
  assert.match(notes[0] ?? "", /: w3 w4 w5$/);
  assert.deepEqual(outside, [{ range: 0, words: "w3 … w5" }]);
  assert.match(notes[1] ?? "", /no pause a cut fits in inside it, so it also takes: w3 … w5/);
  const [from, to] = removed[0] as [number, number];
  assert.ok(from >= s((words[2] as Word).end + MARGIN));
  assert.ok(to <= s((words[6] as Word).start - MARGIN));
});

test("a cut over a whole clip drops it and the captions on it", () => {
  const { project, length } = cutEdit(edit(), [[s(4.95), s(8)]], sources);
  validateProject(project);
  assert.deepEqual(project.main, [{ source: "a", in: 0, out: s(5) }]);
  assert.equal(length, s(5));
  assert.equal(project.captions?.lines.length, 1);
  assert.deepEqual(
    project.overlays?.map((overlay) => overlay.template),
    ["title", "wipe"],
  );
});

test("a cut at the opening keeps the title at the start", () => {
  const { project } = cutEdit(edit(), [[0, s(0.5)]], sources);
  validateProject(project);
  // w0 goes; the clip now starts in the pause before w1.
  assert.deepEqual(project.main[0], { source: "a", in: s(0.5), out: s(5) });
  assert.equal(project.main[0]?.transition, undefined);
  assert.equal(project.overlays?.[0]?.start, 0);
  assert.equal(project.captions?.lines[0]?.text, "w1 w2 w3 w4 w5 w6 w7 w8 w9");
  assert.equal(project.captions?.lines[0]?.start, s(0.1));
});

test("a Chinese line loses a cut word and keeps its own spacing", () => {
  const project = edit();
  const [line] = project.captions?.lines ?? [];
  if (!line) throw new Error("no line");
  const texts = ["我們", "今天", "來", "聊", "剪輯", "OK", "好", "的", "嗎", "？"];
  line.words?.forEach((word, k) => {
    word.text = texts[k] as string;
  });
  line.language = "zh-TW";
  line.text = "我們今天來聊剪輯　OK 好的嗎？";
  const cut = cutEdit(project, [[s(2), s(3)]], sources);
  assert.equal(cut.project.captions?.lines[0]?.text, "我們今天來聊好的嗎？");
});

test("music and B-roll keep the length left of them when a dissolve plays inside them", () => {
  const project = edit();
  const second = project.main[1] as Project["main"][number];
  second.transition = { type: "dissolve", duration: s(0.5) };
  project.output.target.duration = s(7.5);
  const music = project.audio.music?.[0] as NonNullable<Project["audio"]["music"]>[number];
  music.out = music.in + s(7.5);
  project.broll = [{ source: "b", in: s(10), out: s(17.5), start: 0 }];
  // w5, said 2.6 to 2.9 s.
  const { project: cut, length } = cutEdit(project, [[s(2.5), s(3)]], sources);
  assert.equal(length, s(7));
  const track = cut.audio.music?.[0];
  assert.equal((track?.out ?? 0) - (track?.in ?? 0), s(7));
  const broll = cut.broll?.[0];
  assert.equal((broll?.out ?? 0) - (broll?.in ?? 0), s(7));
});

test("a cut leaves the pauses it does not reach as they were", () => {
  const spoken: Word[] = [
    { text: "w0", start: 0.1, end: 0.4 },
    { text: "w1", start: 0.6, end: 0.9 },
    { text: "w2", start: 2.0, end: 2.3 },
    { text: "w3", start: 2.5, end: 2.8 },
  ];
  const paused = new Map<string, PlaceSource>([
    ["a", { id: "a", words: spoken, duration: 60, frameTicks: FRAME }],
  ]);
  const project = projectOf([{ source: "a", in: 0, out: s(3) }]);
  const { project: cut } = cutEdit(project, [[s(2.45), s(2.85)]], paused);
  // The 1.1 s pause between w1 and w2 stays inside the one clip left.
  assert.equal(cut.main.length, 1);
  assert.equal(cut.main[0]?.in, 0);
  assert.ok((cut.main[0]?.out ?? 0) > s(2.3));
});

test("a cut that takes out no words fails instead of passing for done", () => {
  assert.throws(
    () => cutEdit(edit(), [[s(0.42), s(0.58)]], sources),
    /0\.42–0\.58 s takes out no words/,
  );
});

const run = promisify(execFile);
const cli = fileURLToPath(new URL("./cli.ts", import.meta.url));

test("pnpm render names each problem of an edited project by its JSON path", async (t) => {
  const dir = await scratch(t, "render-cli-");
  const broken = edit();
  (broken.main[1] as { out: number }).out = -1;
  const path = join(dir, "edit.project.json");
  await writeFile(path, JSON.stringify(broken));
  const failed = await run("node", [cli, path, "-o", join(dir, "out.mp4")]).catch((e) => e);
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /render: error: .*edit\.project\.json:\n.*\/main\/1\/out/s);
});

test("pnpm render --cut says when the cut leaves the planned length", async (t) => {
  const dir = await scratch(t, "render-cli-");
  const path = join(dir, "edit.project.json");
  await writeFile(path, JSON.stringify(edit()));
  // The cut reads each source's words from its media index, and the voice stem it names.
  const example = new URL("../../schema/examples/media-index.example.json", import.meta.url);
  for (const name of ["a.json", "b.json"]) await copyFile(example, join(dir, name));
  const stem = ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo:d=12", "-c:a", "pcm_f32le"];
  await runFfmpeg(await ffmpeg(), [...QUIET, ...stem, join(dir, "talk.voice.wav")]);
  const failed = await run("node", [cli, path, "--cut", "5-8", "-o", join(dir, "v2.mp4")]).catch(
    (e) => e,
  );
  assert.equal(failed.code, 1);
  assert.match(
    failed.stderr,
    /render: error: The cut edit lasts 5\.00 s, outside the 8\.00 s ± 5 %/,
  );
  // --retarget keeps the shorter edit: the cut project is written, then the render reads the
  // footage, which these fakes are not.
  const kept = await run("node", [
    cli,
    path,
    "--cut",
    "5-8",
    "--retarget",
    "-o",
    join(dir, "v2.mp4"),
  ]).catch((e) => e);
  assert.doesNotMatch(kept.stderr, /outside the/);
  const cut = validateProject(JSON.parse(await readFile(join(dir, "v2.project.json"), "utf8")));
  assert.deepEqual(cut.output.target, { duration: s(5), tolerance: 0.05 });
  const twice = await run("node", [cli, path, "--cut", "1-2-3", "-o", join(dir, "v2.mp4")]).catch(
    (e) => e,
  );
  assert.equal(twice.code, 2);
  const bad = await run("node", [cli, path, "--cut", "8-5", "-o", join(dir, "v2.mp4")]).catch(
    (e) => e,
  );
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /--cut 8-5 is not <from>-<to>/);
});

test("the speaker beside a split screen splits with the main track, so it stays in step", () => {
  const project = edit();
  const below = { x: 0, y: 0.5, w: 1, h: 0.5 };
  // In step with a's clip from 1 to 4 s; and b's picture over a, not in step: it moves as B-roll.
  project.broll = [
    { source: "a", in: s(1), out: s(4), start: s(1), rect: below },
    { source: "b", in: s(20), out: s(23), start: s(1), rect: { x: 0, y: 0, w: 1, h: 0.5 } },
  ];
  project.graphics = [{ layout: "panel", html: "<b>3</b>", css: "", start: s(1), duration: s(3) }];
  project.audio.sfx = [
    { source: "m", start: s(1), gainDb: -16 },
    { source: "m", start: s(2.7), gainDb: -16 },
  ];
  // w5, said 2.6 to 2.9 s.
  const { project: cut } = cutEdit(project, [[s(2.5), s(3)]], sources);
  const [first, second, other] = cut.broll ?? [];
  // Each piece shows the source time the main track plays under it.
  const mainAt = (t: number) => {
    let at = 0;
    for (const clip of cut.main) {
      if (t < at + clip.out - clip.in) return clip.in + t - at;
      at += clip.out - clip.in;
    }
    return null;
  };
  for (const piece of [first, second]) {
    assert.ok(piece);
    assert.equal(piece.in, mainAt(piece.start));
    assert.deepEqual(piece.rect, below);
  }
  assert.equal(
    (first?.out ?? 0) + (second?.out ?? 0) - (first?.in ?? 0) - (second?.in ?? 0),
    cut.graphics?.[0]?.duration ?? 0,
  );
  assert.equal(other?.source, "b");
  assert.equal(cut.graphics?.length, 1);
  // The sound on a moment cut out goes with it.
  assert.deepEqual(
    cut.audio.sfx?.map((sfx) => sfx.start),
    [s(1)],
  );
  validateProject(cut);
});

test("a graphic showing a word the cut takes goes with it; one showing words kept moves up", () => {
  const project = edit();
  const graphic = (word: number, start: number) => ({
    layout: "full" as const,
    html: "<b>x</b>",
    css: "",
    words: [{ source: "a", word }],
    start: s(start),
    duration: s(1),
  });
  // w5 is said 2.6 to 2.9 s, w8 4.1 to 4.4 s.
  project.graphics = [graphic(5, 2.4), graphic(8, 4)];
  const { project: cut, notes } = cutEdit(project, [[s(2.5), s(3)]], sources);
  assert.equal(cut.graphics?.length, 1);
  assert.deepEqual(cut.graphics?.[0]?.words, [{ source: "a", word: 8 }]);
  assert.ok((cut.graphics?.[0]?.start ?? 0) < s(4));
  assert.ok(
    notes.some((note) => /\/graphics\/0 \(full\): it shows words the cut took out/.test(note)),
  );
  validateProject(cut);
});
