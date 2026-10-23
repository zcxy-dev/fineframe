import assert from "node:assert/strict";
import { test } from "node:test";
import { catalog } from "@video-editor/effects";
import { type Project, projectSchema, validateProject, type Word } from "@video-editor/schema";
import { CAPTION_STYLES, PRESETS } from "./captions/presets.ts";
import type { PlaceSource } from "./plan/place.ts";
import { fixWord, OVERLAY_TEXT, removables, revise } from "./revise.ts";
import { project as projectOf, SECOND } from "./testing.ts";

const s = (seconds: number) => Math.round(seconds * SECOND);
const fingerprint = { bytes: 1, sha256: "0".repeat(64) };

/** Ten words of 0.3 s, one every 0.5 s from 0.1 s. */
const words: Word[] = Array.from({ length: 10 }, (_, k) => ({
  text: `w${k}`,
  start: k * 0.5 + 0.1,
  end: k * 0.5 + 0.4,
}));
const sources = new Map<string, PlaceSource>([
  ["a", { id: "a", words, duration: 60, frameTicks: 4000 }],
]);

/** 5 s of source a, captioned, with a chapter and its wipe, a second chapter, a panel graphic with
 * the speaker below it and its sound, full-frame B-roll, and music. */
function edit(): Project {
  const timed = words.map((word) => ({ text: word.text, start: s(word.start), end: s(word.end) }));
  return projectOf(
    [{ source: "a", in: 0, out: s(5), grade: { look: { id: "clean", intensity: 0.5 } } }],
    {
      sources: [
        { id: "a", kind: "video", path: "a.mp4", index: "a.json", fingerprint },
        { id: "visual-1", kind: "video", path: "broll/clip.mp4", fingerprint },
        { id: "sfx", kind: "audio", path: "whoosh.wav", fingerprint },
        { id: "m", kind: "audio", path: "m.wav", index: "m.json", fingerprint },
      ],
      captions: {
        preset: "bold",
        srt: true,
        lines: [
          {
            start: timed[0]?.start ?? 0,
            end: (timed[9]?.end ?? 0) + s(0.3),
            language: "en",
            text: `${timed.map((word) => word.text).join(" ")}.`,
            words: timed,
          },
        ],
      },
      overlays: [
        { template: "title", params: { text: "Hello", subtitle: "Sub" }, start: 0, duration: s(1) },
        { template: "wipe", params: {}, start: s(1.4), duration: s(0.4) },
        {
          template: "chapter",
          params: { title: "One", index: 1, total: 2 },
          start: s(1.6),
          duration: s(1),
        },
        {
          template: "chapter",
          params: { title: "Two", index: 2, total: 2 },
          start: s(3.5),
          duration: s(1),
        },
      ],
      graphics: [
        {
          layout: "panel",
          html: '<div class="ff-stage"></div><b>Up</b> &amp; <i>away</i>',
          css: "",
          start: s(1),
          duration: s(1),
        },
      ],
      broll: [
        { source: "a", in: s(1), out: s(2), start: s(1), rect: { x: 0, y: 0.5, w: 1, h: 0.5 } },
        { source: "visual-1", in: 0, out: s(1), start: s(3) },
      ],
      audio: {
        loudness: { integratedLufs: -14, truePeakDbtp: -1 },
        music: [
          { source: "m", license: { name: "CC0 1.0" }, in: 0, out: s(5), start: 0, gainDb: -20 },
        ],
        sfx: [
          { source: "sfx", start: s(1), gainDb: -12 },
          { source: "sfx", start: s(3), gainDb: -12 },
        ],
      },
    },
  );
}

test("the caption styles are the schema's, and the text limits the catalog's", () => {
  const schema = projectSchema as unknown as {
    $defs: { Captions: { properties: { preset: { enum: string[] } } } };
  };
  assert.deepEqual(
    [...CAPTION_STYLES].sort(),
    [...schema.$defs.Captions.properties.preset.enum].sort(),
  );
  assert.deepEqual(
    CAPTION_STYLES.filter((style) => style !== "none").sort(),
    Object.keys(PRESETS).sort(),
  );
  for (const [template, limits] of Object.entries(OVERLAY_TEXT)) {
    const params = (
      catalog as unknown as Record<
        string,
        { params: { properties: Record<string, { maxLength?: number }> } }
      >
    )[template]?.params.properties;
    for (const [name, limit] of Object.entries(limits)) {
      assert.equal(params?.[name]?.maxLength, limit, `${template}.${name}`);
    }
  }
});

test("a fixed caption word changes in its entry and in the line's text, times kept", () => {
  const line = edit().captions?.lines[0];
  assert.ok(line);
  const fixed = fixWord(line, 9, "nine");
  assert.equal(fixed.text, "w0 w1 w2 w3 w4 w5 w6 w7 w8 nine.");
  assert.deepEqual(fixed.words?.[9], { ...line.words?.[9], text: "nine" });
  // A text that no longer holds its words is rebuilt from them.
  assert.equal(
    fixWord({ ...line, text: "hand edited" }, 0, "zero").text.startsWith("zero w1"),
    true,
  );
  assert.throws(() => fixWord(line, 0, "  "), /needs some text/);
});

test("one revision restyles, retitles, relevels the music and changes the look", () => {
  const { project, removed } = revise(
    edit(),
    {
      captions: "creator",
      words: [{ line: 0, word: 1, text: "one" }],
      overlays: [{ index: 0, params: { text: "Hi there", subtitle: "" } }],
      music: { gainDb: -3 },
      look: "warm",
    },
    sources,
  );
  validateProject(project);
  assert.equal(project.captions?.preset, "creator");
  assert.match(project.captions?.lines[0]?.text ?? "", /^w0 one w2/);
  assert.deepEqual(project.overlays?.[0]?.params, { text: "Hi there" });
  assert.equal(project.audio.music?.[0]?.gainDb, -23);
  // The intensity stays; the speaker beside the split takes the look too, only it has a grade.
  assert.deepEqual(project.main[0]?.grade?.look, { id: "warm", intensity: 0.5 });
  assert.deepEqual(removed, []);
  // Nothing of the original changes.
  assert.equal(edit().captions?.preset, "bold");

  const none = revise(edit(), { look: "none", music: "remove" }, sources).project;
  assert.equal(none.main[0]?.grade, undefined);
  assert.equal(none.audio.music, undefined);
  assert.throws(
    () => revise(edit(), { overlays: [{ index: 0, params: { text: "x".repeat(25) } }] }, sources),
    /at most 24/,
  );
  assert.throws(() => revise(edit(), { overlays: [{ index: 1, params: { text: "x" } }] }, sources));
});

test("the captions' emoji turn on and off with nothing else changed", () => {
  const on = revise(edit(), { emoji: true }, sources).project;
  assert.deepEqual(on.captions, { ...edit().captions, emoji: true });
  validateProject(on);
  const off = revise(on, { emoji: false }, sources).project;
  assert.deepEqual(off, edit());
  const { captions: _, ...silent } = edit();
  assert.throws(() => revise(silent, { emoji: true }, sources), /no captions/);
});

test("a graphic's label is its text as drawn, every entity decoded", () => {
  const project = edit();
  const [graphic] = project.graphics ?? [];
  assert.ok(graphic);
  graphic.html = "<p>Fast&nbsp;&nbsp;cuts &mdash; <b>no&#160;clicks</b> &#x2713; &lt;3</p>";
  const label = removables(project).find((item) => item.kind === "graphic")?.label;
  assert.equal(label, "Graphic (panel): Fast cuts \u2014 no clicks \u2713 <3");
});

test("what goes with a removal goes too: a chapter's wipe, a panel's speaker, their sounds", () => {
  assert.deepEqual(
    removables(edit()).map((item) => [item.kind, item.index, item.label]),
    [
      ["overlay", 0, "Title: Hello"],
      ["graphic", 0, "Graphic (panel): Up & away"],
      ["overlay", 1, "Wipe"],
      ["overlay", 2, "Chapter: One"],
      ["broll", 1, "B-roll: clip.mp4"],
      ["overlay", 3, "Chapter: Two"],
    ],
  );
  const { project } = revise(
    edit(),
    {
      remove: [
        { kind: "overlay", index: 2 },
        { kind: "graphic", index: 0 },
        { kind: "broll", index: 1 },
      ],
    },
    sources,
  );
  validateProject(project);
  // The first chapter and its wipe go; the second is renumbered.
  assert.deepEqual(
    project.overlays?.map((overlay) => [overlay.template, overlay.params.index]),
    [
      ["title", undefined],
      ["chapter", 1],
    ],
  );
  assert.equal(project.overlays?.[1]?.params.total, 1);
  assert.deepEqual(project.graphics, []);
  // The speaker below the panel and the B-roll both go, with the sound at each one's start.
  assert.deepEqual(project.broll, []);
  assert.deepEqual(project.audio.sfx, []);
  // The speaker beside a split is not something to remove on its own.
  assert.throws(() => revise(edit(), { remove: [{ kind: "broll", index: 0 }] }, sources));
});

test("a cut makes the new length the planned one, and says where it landed", () => {
  const { project, length, removed } = revise(
    edit(),
    { cuts: [[s(2.2), s(2.7)]], words: [{ line: 0, word: 9, text: "nine" }] },
    sources,
  );
  validateProject(project);
  assert.equal(project.output.target.duration, length);
  assert.equal(removed.length, 1);
  const [from, to] = removed[0] as [number, number];
  assert.equal(length, s(5) - (to - from));
  // The fix made in the same revision survives the cut.
  assert.match(project.captions?.lines[0]?.text ?? "", /nine\.$/);
  assert.doesNotMatch(project.captions?.lines[0]?.text ?? "", /w4/);
});
