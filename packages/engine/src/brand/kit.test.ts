import assert from "node:assert/strict";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { Brand } from "@video-editor/schema";
import { fontFile } from "../captions/fonts.ts";
import { ffmpeg, QUIET, run } from "../ffmpeg.ts";
import { revise } from "../revise.ts";
import { project, SECOND, scratch } from "../testing.ts";
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
  const staged = await stageBrand(await loadKit(folder), folder, join(edit, "brand"), edit, () => {
    throw new Error("A PNG logo needs no Chrome");
  });
  const files = await readdir(join(edit, "brand"));
  assert.equal(files.length, 2);
  assert.match(staged.logo?.file.path ?? "", /^brand\/[0-9a-f]{16}\.png$/);
  assert.match(staged.logo?.file.sha256 ?? "", /^[0-9a-f]{64}$/);
  assert.deepEqual(staged.fonts?.graphics, { id: "jf-openhuninn" });
  const font = staged.fonts?.captions;
  assert.ok(font && "path" in font && /^brand\/[0-9a-f]{16}\.otf$/.test(font.path));
  // The bundled face downloads on first use; the uploaded one is the kit's own.
  const resolved = await resolveBrand(staged, edit);
  assert.equal(resolved.captions?.family, "Noto Sans CJK TC");
  assert.deepEqual([resolved.watermark?.width, resolved.watermark?.height], [64, 32]);
  assert.ok(resolved.look.font?.path.endsWith("jf-openhuninn-2.1.ttf"));
  await writeFile(join(edit, staged.logo?.file.path ?? ""), "changed");
  await assert.rejects(resolveBrand(staged, edit), /has changed since the edit was made/);
});

test("a kit's custom captions become the edit's style, unless it shows none; a style picked after turns them off", () => {
  const edit = project([{ source: "a", in: 0, out: 5 * SECOND }], {
    captions: { preset: "bold", srt: true, lines: [] },
  });
  const branded = withBrand(edit, KIT);
  assert.equal(branded.captions?.preset, "creator");
  assert.deepEqual(branded.brand, KIT);
  const none = withBrand({ ...edit, captions: { preset: "none", srt: true, lines: [] } }, KIT);
  assert.equal(none.captions?.preset, "none");
  assert.equal(withBrand(branded, null).brand, undefined);
  const restyled = revise(branded, { captions: "minimal" }, new Map()).project;
  assert.equal(restyled.captions?.preset, "minimal");
  assert.equal(restyled.brand?.captions, undefined);
  assert.equal(restyled.brand?.name, "Test kit");
});
