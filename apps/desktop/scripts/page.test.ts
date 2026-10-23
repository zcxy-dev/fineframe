import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { copyPage } from "./page.ts";

async function checkout(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "fineframe-page-"));
  const next = join(root, "apps", "web", ".next");
  await mkdir(join(next, "server"), { recursive: true });
  await writeFile(join(next, "server", "page.js"), "export {};\n");
  await mkdir(join(next, "cache"), { recursive: true });
  await writeFile(join(next, "cache", "entry"), "cached\n");
  return root;
}

test("the page's build is copied without its cache", async (t) => {
  const root = await checkout();
  t.after(() => rm(root, { recursive: true, force: true }));
  const to = join(root, "build", ".next");
  await copyPage(join(root, "apps", "web", ".next"), to);
  assert.equal(await readFile(join(to, "server", "page.js"), "utf8"), "export {};\n");
  await assert.rejects(readFile(join(to, "cache", "entry")), { code: "ENOENT" });
});

test("a package the server build keeps external is refused, not linked into the build checkout", async (t) => {
  // Next links a package its server build keeps external from .next/node_modules into the
  // checkout's node_modules/.pnpm, which the installed editor, installed without links, lacks.
  const root = await checkout();
  t.after(() => rm(root, { recursive: true, force: true }));
  const next = join(root, "apps", "web", ".next");
  const pnpm = join(root, "node_modules", ".pnpm", "postcss@8.5.6", "node_modules", "postcss");
  await mkdir(pnpm, { recursive: true });
  await mkdir(join(next, "node_modules"));
  const link = join(next, "node_modules", "postcss-0a1b2c3d");
  await symlink(relative(dirname(link), pnpm), link, "junction");
  await assert.rejects(copyPage(next, join(root, "build", ".next")), /postcss-0a1b2c3d/);
});
