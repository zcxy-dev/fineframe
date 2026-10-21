import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { Brand } from "@video-editor/schema";
import { fontFile } from "../captions/fonts.ts";
import { buildCaptions } from "../captions/index.ts";
import { ffmpeg, QUIET, run } from "../ffmpeg.ts";
import { pieceVideo } from "../graph/piece.ts";
import { cutPieces } from "../pieces.ts";
import { rebase } from "../render.ts";
import { revise } from "../revise.ts";
import { facts, project, SECOND, scratch, sources } from "../testing.ts";
import { buildTimeline } from "../timeline.ts";
import { BrandError, loadKit, resolveBrand, stageBrand, withBrand } from "./kit.ts";

const KIT: Brand = {
  name: "Test kit",
  colors: { primary: "#2f6bff" },
  fonts: { graphics: { id: "jf-openhuninn" }, captions: { path: "fonts/Face.otf" } },
  logo: { file: { path: "logo.png" }, show: true, corner: "top-right", size: 0.12, opacity: 0.8 },
  captions: {
    style: "creator",
    size: "L",
    text: "#ffffff",
    highlight: "#00ff88",
    frame: "box",
    position: "top",
    lines: 1,
  },
};

/** A kit folder: kit.json, a 64 × 32 PNG logo and a font, as `--brand` takes it. */
async function kitFolder(dir: string, brand: Brand = KIT): Promise<string> {
  const folder = join(dir, "kit");
  await mkdir(join(folder, "fonts"), { recursive: true });
  await run(await ffmpeg(), [
    ...QUIET,
    "-f",
    "lavfi",
    "-i",
    "color=c=white:s=64x32",
    "-frames:v",
    "1",
    join(folder, "logo.png"),
  ]);
  await copyFile(await fontFile(700), join(folder, "fonts", "Face.otf"));
  await writeFile(join(folder, "kit.json"), JSON.stringify(brand));
  return folder;
}

const refused = async (folder: string, pattern: RegExp) =>
  assert.rejects(loadKit(folder), (error: Error) => {
    assert.ok(error instanceof BrandError, error.message);
    assert.match(error.message, pattern);
    return true;
  });

test("a kit folder is read whole, and one naming a file it does not hold is refused", async (t) => {
  const dir = await scratch(t, "kit-");
  const folder = await kitFolder(dir);
  assert.deepEqual(await loadKit(folder), KIT);
  await refused(join(dir, "nowhere"), /no kit\.json/);
  const outside = {
    ...KIT,
    logo: { ...(KIT.logo as NonNullable<Brand["logo"]>), file: { path: "../x.png" } },
  };
  await writeFile(join(dir, "x.png"), await readFile(join(folder, "logo.png")));
  await writeFile(join(folder, "kit.json"), JSON.stringify(outside));
  await refused(folder, /outside the kit's folder/);
  await writeFile(
    join(folder, "kit.json"),
    JSON.stringify({ ...KIT, colors: { primary: "blue" } }),
  );
  await refused(folder, /\/colors\/primary/);
});

test("a logo that is neither a PNG nor a safe SVG, and a font that is not one, are refused", async (t) => {
  const folder = await kitFolder(await scratch(t, "kit-"));
  await writeFile(join(folder, "logo.png"), "GIF89a not a logo");
  await refused(folder, /logo\.png: it is neither a PNG nor an SVG/);
  await writeFile(
    join(folder, "logo.png"),
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  );
  await refused(folder, /logo\.png: it has a <script> element/);
  const kit = await kitFolder(await scratch(t, "kit-"));
  await writeFile(join(kit, "fonts", "Face.otf"), Buffer.alloc(4096, 7));
  await refused(kit, /Face\.otf: it is not a TrueType or OpenType font/);
});

test("an edit copies the kit's files by their content and a render refuses one changed since", async (t) => {
  const dir = await scratch(t, "kit-");
  const folder = await kitFolder(dir);
  const edit = join(dir, "edit");
  const staged = await stageBrand(await loadKit(folder), folder, join(edit, "brand"), edit);
  const files = await readdir(join(edit, "brand"));
  assert.equal(files.length, 2);
  assert.match(staged.logo?.file.path ?? "", /^brand\/[0-9a-f]{16}\.png$/);
  assert.match(staged.logo?.file.sha256 ?? "", /^[0-9a-f]{64}$/);
  assert.deepEqual(staged.fonts?.graphics, { id: "jf-openhuninn" });
  const font = staged.fonts?.captions;
  assert.ok(font && "path" in font && /^brand\/[0-9a-f]{16}\.otf$/.test(font.path));
  // The bundled face downloads on first use; the uploaded one is the kit's own.
  const drawn = async () => {
    throw new Error("A PNG logo is not drawn");
  };
  const resolved = await resolveBrand(staged, edit, drawn);
  assert.equal(resolved.captions?.family, "Noto Sans CJK TC");
  assert.deepEqual([resolved.watermark?.width, resolved.watermark?.height], [64, 32]);
  assert.ok(resolved.look.font?.path.endsWith("jf-openhuninn-2.1.ttf"));
  await writeFile(join(edit, staged.logo?.file.path ?? ""), "changed");
  await assert.rejects(resolveBrand(staged, edit, drawn), /has changed since the edit was made/);
});

test("a kit's custom captions draw over the edit's style, which taking the kit off brings back", () => {
  const edit = project([{ source: "a", in: 0, out: 5 * SECOND }], {
    captions: { preset: "minimal", srt: true, lines: [] },
  });
  const branded = withBrand(edit, KIT);
  assert.equal(branded.captions?.preset, "minimal");
  assert.deepEqual(branded.brand, KIT);
  assert.deepEqual(withBrand(branded, null), edit);
  const restyled = revise(branded, { captions: "pop" }, new Map()).project;
  assert.equal(restyled.captions?.preset, "pop");
  assert.equal(restyled.brand?.captions, undefined);
  assert.equal(restyled.brand?.name, "Test kit");
});

test("without a kit, the captions, each piece's FFmpeg run and the project copy are as before kits", async () => {
  // Hashes of what a render runs FFmpeg and libass with, recorded with the renderer before brand
  // kits: an edit made then renders byte for byte as it did. A deliberate change to the captions
  // or the graph changes this too; packages/effects checks the effect pages the same way.
  const hash = (value: unknown) =>
    createHash("sha256")
      .update(typeof value === "string" ? value : JSON.stringify(value))
      .digest("hex")
      .slice(0, 16);
  const words = (text: string, start: number) =>
    [...text].map((c, i) => ({
      text: c,
      start: start + (i * SECOND) / 4,
      end: start + ((i + 0.8) * SECOND) / 4,
    }));
  const lines = [
    {
      start: SECOND / 2,
      end: SECOND / 2 + (12 * SECOND) / 4,
      language: "zh-TW",
      text: "大家好今天要來聊一下怎麼用AI",
      words: words("大家好今天要來聊一下怎麼用", SECOND / 2),
    },
    {
      start: 4 * SECOND,
      end: 5.5 * SECOND,
      language: "zh-TW",
      text: "自動剪片7分鐘",
      words: words("自動剪片7分鐘", 4 * SECOND),
    },
  ];
  const out: Record<string, string> = {};
  for (const aspect of ["16:9", "9:16"] as const) {
    const size = aspect === "16:9" ? { width: 1280, height: 720 } : { width: 1080, height: 1920 };
    for (const preset of ["bold", "creator", "minimal", "pop", "none"] as const) {
      const edit = project([{ source: "a", in: 0, out: 6 * SECOND }], {
        captions: { preset, srt: true, lines },
      });
      edit.output = { ...edit.output, aspect, ...size };
      const files = await buildCaptions(edit, {
        main: [],
        broll: [],
        frames: 180,
        frameTicks: 4000,
      });
      out[`captions ${aspect} ${preset}`] = hash([files?.ass, files?.srt]);
    }
  }
  const edit = project(
    [
      { source: "a", in: 0, out: 3 * SECOND },
      {
        source: "b",
        in: SECOND,
        out: 4 * SECOND,
        transition: { type: "dissolve", duration: SECOND / 2 },
      },
    ],
    {
      graphics: [
        {
          layout: "label",
          html: "<b>27</b>",
          css: "",
          box: { x: 0.1, y: 0.1, w: 0.4, h: 0.1 },
          start: SECOND / 2,
          duration: SECOND,
        },
        { layout: "full", html: "<b>27</b>", css: "", start: 3 * SECOND, duration: 2 * SECOND },
      ],
      overlays: [
        {
          template: "lower-third",
          params: { name: "林語安" },
          start: SECOND,
          duration: 2 * SECOND,
        },
      ],
    },
  );
  const timeline = buildTimeline(edit, sources(facts("a"), facts("b")));
  for (const [i, piece] of cutPieces(timeline).entries()) {
    out[`piece ${i}`] = hash(
      pieceVideo(piece, timeline, ["overlay-0.webm"], new Map(), [
        "graphic-0.webm",
        "graphic-1.mp4",
      ]),
    );
  }
  out["project copy"] = hash(rebase(edit, "/edits/one/project.json", "/edits/one/out"));
  assert.equal(Object.keys(out).length, 14);
  assert.equal(hash(out), "48c412f7a723ec4c");
});
