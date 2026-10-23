// The page's build as the installer carries it.
import { cp, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

/** Copies the page's build, apps/web/.next, to `to`, without the build's own cache. A package the
 * page's server build keeps external is a link in .next/node_modules into the checkout's
 * node_modules/.pnpm, which the installed editor, installed without links between dependencies,
 * does not have (and a copy would point at the building machine's checkout): such a build is
 * refused, naming the links. */
export async function copyPage(next: string, to: string): Promise<void> {
  const modules = join(next, "node_modules");
  const entries = await readdir(modules, { recursive: true, withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    },
  );
  const links = entries
    .filter((entry) => entry.isSymbolicLink())
    .map((entry) => relative(next, join(entry.parentPath, entry.name)));
  if (links.length > 0)
    throw new Error(
      `The page's server build keeps packages external, which the installed editor cannot load: ${links.join(", ")}. Keep what imports them out of the server's imports, as packages/effects/src/text.ts keeps postcss out.`,
    );
  await cp(next, to, {
    recursive: true,
    filter: (path) => !path.includes(`${join(".next", "cache")}`),
  });
}
