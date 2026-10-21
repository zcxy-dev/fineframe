import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { JobError } from "./jobs.ts";
import {
  createKit,
  kitFolder,
  listKits,
  putFont,
  putLogo,
  readKit,
  removeKit,
  removeLogo,
  saveKit,
  setDefault,
} from "./kits.ts";
import { checkSettings } from "./settings.ts";

/** Kits in a folder of the test's own, removed after it. */
async function kits(t: { after: (done: () => Promise<void>) => void }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kits-"));
  const before = process.env.VIDEO_EDITOR_BRAND_KITS;
  process.env.VIDEO_EDITOR_BRAND_KITS = root;
  t.after(async () => {
    if (before === undefined) delete process.env.VIDEO_EDITOR_BRAND_KITS;
    else process.env.VIDEO_EDITOR_BRAND_KITS = before;
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#2f6bff"/></svg>',
);
const refused = (status: number) => (error: unknown) =>
  error instanceof JobError && error.status === status;

test("kits are made, listed by name, saved and deleted, one of them the default", async (t) => {
  await kits(t);
  const b = await createKit("  客戶 B ");
  const a = await createKit("我的頻道");
  assert.equal(b.brand.name, "客戶 B");
  await setDefault(a.id);
  const listed = await listKits();
  assert.deepEqual(
    listed.kits.map((kit) => kit.brand.name),
    ["客戶 B", "我的頻道"],
  );
  assert.equal(listed.default, a.id);
  const saved = await saveKit(a.id, {
    name: "我的頻道",
    colors: { primary: "#2f6bff" },
    fonts: { graphics: { id: "lxgw-wenkai-tc" } },
  });
  assert.deepEqual(saved.brand.fonts, { graphics: { id: "lxgw-wenkai-tc" } });
  await assert.rejects(saveKit(a.id, { name: "", colors: { primary: "#2f6bff" } }), refused(400));
  await assert.rejects(saveKit(a.id, { name: "x", colors: { primary: "blue" } }), refused(400));
  // What failed left the kit as it was.
  assert.deepEqual((await readKit(a.id)).brand, saved.brand);
  await removeKit(a.id);
  assert.deepEqual(await listKits(), { kits: [b], default: null });
});

test("an id that is not a kit's never reaches outside the kits' folder", async (t) => {
  await kits(t);
  for (const id of ["../../etc", "..", "default.json"]) {
    assert.throws(() => kitFolder(id), refused(404));
  }
  await assert.rejects(readKit("00000000-0000-0000-0000-000000000000"), refused(404));
});

test("a logo and a font are kept only when they are what they claim, and nothing names another file", async (t) => {
  const root = await kits(t);
  const { id } = await createKit("Kit");
  await assert.rejects(putLogo(id, Buffer.from("GIF89a")), refused(400));
  await assert.rejects(
    putLogo(id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>')),
    refused(400),
  );
  const logo = await putLogo(id, SVG);
  // A kit's first logo starts hidden.
  assert.deepEqual(logo.brand.logo, {
    file: { path: "logo.svg" },
    show: false,
    corner: "top-right",
    size: 0.12,
    opacity: 0.85,
  });
  await assert.rejects(putFont(id, "captions", "Bad.ttf", Buffer.alloc(2048, 1)), refused(400));
  // The page names only the kit's own files; another path is dropped, not followed.
  const saved = await saveKit(id, {
    name: "Kit",
    colors: { primary: "#2f6bff" },
    fonts: { captions: { path: "../../secret.ttf" } },
    logo: { ...logo.brand.logo, file: { path: "../x.png" }, show: true },
  });
  assert.equal(saved.brand.fonts?.captions, undefined);
  assert.deepEqual(saved.brand.logo?.file, { path: "logo.svg" });
  assert.equal(saved.brand.logo?.show, true);
  await removeLogo(id);
  assert.deepEqual(await readdir(join(root, id)), ["kit.json"]);
});

test("an edit names its kit by id, and asks for the kit's captions only with a kit", () => {
  const asked = { length: 60, aspect: "9:16", names: [] };
  const settings = checkSettings({ ...asked, brand: "k", captions: "brand" });
  assert.ok(typeof settings === "object");
  assert.deepEqual([settings.brand, settings.captions], [{ id: "k", name: "" }, "brand"]);
  assert.equal(typeof checkSettings({ ...asked, captions: "brand" }), "string");
  assert.equal(typeof checkSettings({ ...asked, brand: 7 }), "string");
  assert.equal((checkSettings(asked) as { brand?: unknown }).brand, undefined);
});
