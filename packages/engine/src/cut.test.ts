import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { type Project, validateProject, type Word } from "@video-editor/schema";
import { cutEdit } from "./cut.ts";
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
 * opening, a keyword at 1.2 s and at 6 s, and music under all of it. */
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
  const keyword = (start: number) => ({
    template: "keyword",
    params: { text: "w", position: "upper" },
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
      captions: { preset: "clean", srt: true, lines: [line(0, 10), line(5, 6)] },
      overlays: [
        { template: "title", params: { text: "T" }, start: 0, duration: s(3) },
        keyword(1.2),
        keyword(6),
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

  // The keyword wholly inside the cut goes; the title and the later one move up with the speech.
  assert.deepEqual(
    project.overlays?.map((overlay) => [overlay.template, overlay.start]),
    [
      ["title", 0],
      ["keyword", s(5)],
    ],
  );
  assert.ok(notes.some((note) => /\/overlays\/1 \(keyword\)/.test(note)));
  // The music plays on without a gap and ends where the edit does, with its fade.
  assert.deepEqual(project.audio.music?.[0], { ...edit().audio.music?.[0], out: s(17) });
});

test("a cut over a whole clip drops it and the captions on it", () => {
  const { project, length } = cutEdit(edit(), [[s(4.95), s(8)]], sources);
  validateProject(project);
  assert.deepEqual(project.main, [{ source: "a", in: 0, out: s(5) }]);
  assert.equal(length, s(5));
  assert.equal(project.captions?.lines.length, 1);
  assert.deepEqual(
    project.overlays?.map((overlay) => overlay.template),
    ["title", "keyword"],
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

const run = promisify(execFile);
const cli = new URL("./cli.ts", import.meta.url).pathname;

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
  // The cut reads each source's words from its media index.
  const example = new URL("../../schema/examples/media-index.example.json", import.meta.url);
  for (const name of ["a.json", "b.json"]) await copyFile(example, join(dir, name));
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
  const bad = await run("node", [cli, path, "--cut", "8-5", "-o", join(dir, "v2.mp4")]).catch(
    (e) => e,
  );
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /--cut 8-5 is not <from>-<to>/);
});
