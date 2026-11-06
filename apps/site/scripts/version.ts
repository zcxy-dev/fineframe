// Writes `out/version.json` with the commit Cloudflare Pages built (`CF_PAGES_COMMIT_SHA`), so
// verify-site-deploy can tell that fineframe.app serves the merged commit. `pnpm build` runs it
// after `next build`; a build outside Pages writes `"commit": null`.
import { writeFile } from "node:fs/promises";

const out = new URL("../out/version.json", import.meta.url);
await writeFile(out, `${JSON.stringify({ commit: process.env.CF_PAGES_COMMIT_SHA ?? null })}\n`);
