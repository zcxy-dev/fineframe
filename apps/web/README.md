# Web page

One page in front of [`pnpm edit`](../../packages/engine/README.md#editing-footage): add footage, music or video links, choose the length, aspect and style, start, watch the progress, then play, change and download the result. The [desktop app](../desktop/README.md) runs the same page in its own window.

```bash
mise run start      # or pnpm start, with mise activated
```

`pnpm start` ([`scripts/start.ts`](scripts/start.ts)) checks Node, pnpm and uv, warns when the disk has less than 10 GB free, installs the packages and the worker's environment, builds the page when its code changed, starts the server and opens http://127.0.0.1:3000 (`--no-open` leaves the browser alone; when the page already runs there it only opens it). `pnpm -C apps/web build` and `pnpm -C apps/web start` build and start the page alone.

## Server

- **Address:** 127.0.0.1 only; `VIDEO_EDITOR_HOST` and `PORT` change it. The page has no login of its own, so never put it on a public address. Requests addressed to any other host name are refused, against DNS rebinding; `VIDEO_EDITOR_ALLOWED_HOSTS` adds names, comma-separated, for a proxy such as `tailscale serve` ([`proxy.ts`](proxy.ts)). Requests from another origin are refused ([`checkOrigin`](lib/http.ts)).
- **One edit at a time:** a second is refused before its footage is sent; stopping the server stops a running edit ([`lib/jobs.ts`](lib/jobs.ts), [`lib/runner.ts`](lib/runner.ts)).
- **Jobs:** each edit is a folder in `~/.cache/video-editor/jobs/` (`XDG_CACHE_HOME` moves it with the engine's cache, `VIDEO_EDITOR_JOBS` alone). An upload whose path could leave the folder, a hidden file, a file of another type or size than announced, and footage that does not fit the free disk are refused ([`lib/paths.ts`](lib/paths.ts), [`app/api/jobs/routes.test.ts`](app/api/jobs/routes.test.ts)). Links are read as they are pasted (`POST /api/links`) and fetched with the engine's link import when the edit starts.
- **Retention:** the newest five finished projects keep their footage, and each edit keeps the video of its newest three versions and the one shown; every version keeps its `project.json` ([`lib/retention.ts`](lib/retention.ts), [`lib/versions.ts`](lib/versions.ts)).
- **Keys:** Anthropic's, OpenRouter's (cloud speech) and the optional Pexels and Pixabay keys are checked with their service at no cost and saved only when accepted, in the git-ignored `.env` at the repository root (`VIDEO_EDITOR_ENV_FILE` moves it), readable by its owner alone. A saved key is used over the same variable in the server's environment, and never goes back to the page or into a log ([`lib/key.ts`](lib/key.ts), [`lib/key.test.ts`](lib/key.test.ts)).
- **Account:** only with `VIDEO_EDITOR_ACCOUNT_FILE`, which the desktop app sets: a new edit or plan needs a signed-in account that the [entitlement contract](../site/ENTITLEMENT.md) allows. Rendering, opening projects and downloads need none; from a clone nothing is checked ([`lib/account.ts`](lib/account.ts), [`lib/account.test.ts`](lib/account.test.ts)).
- **Analysis setup:** with `VIDEO_EDITOR_SETUP=1` (the desktop app) the server installs the analysis's Python environment on its first start and an edit waits for it ([`lib/setup.ts`](lib/setup.ts)).
- **Brand kits:** folders in `brand-kits/` in the engine's cache, or the one `VIDEO_EDITOR_BRAND_KITS` names. Uploads are checked as `pnpm edit --brand` checks a kit (a logo up to 10 MB, a font up to 64 MB), and a change that fails leaves `kit.json` as it was ([`lib/kits.ts`](lib/kits.ts), [`lib/kits.test.ts`](lib/kits.test.ts); what a kit holds: [engine](../../packages/engine/README.md#brand-kits)).
- **Progress:** `pnpm edit`'s [progress lines](../../packages/schema/README.md#progress-lines), sent to the page as Server-Sent Events (`GET /api/jobs/<id>/events`), with the time left from [`lib/eta.ts`](lib/eta.ts). The job's id is in the page's address, so a reload opens it again.
- **Failures:** what happened and the step that fixes it in plain words, with the program's message behind "Show details" and local paths cut to file names ([`lib/fixes.ts`](lib/fixes.ts), [`lib/fixes.test.ts`](lib/fixes.test.ts)).

## The page

- **Start** ([`SettingsPanel.tsx`](components/SettingsPanel.tsx), [`Footage.tsx`](components/Footage.tsx), [`Projects.tsx`](components/Projects.tsx)): each setting is a `pnpm edit` option ([engine](../../packages/engine/README.md#editing-footage)), checked the same way in the browser and on the server ([`lib/settings.ts`](lib/settings.ts)). Length, aspect and caption style come first; the rest is under Advanced. Names and terms are remembered for the next edit ([`lib/remembered.ts`](lib/remembered.ts)). Before an edit the page estimates what Claude will cost with the engine's `estimateCost` ([`Editor.tsx`](components/Editor.tsx)).
- **Progress** ([`RunView.tsx`](components/RunView.tsx)): a bar in four parts (transcribe, pick, render and check), the analysis's checklist ([`lib/steps.ts`](lib/steps.ts)), each first-use download with its own bar, and Cancel.
- **Several shorts** ([`Shorts.tsx`](components/Shorts.tsx), [`lib/shorts.ts`](lib/shorts.ts)): `--shorts` as one project; each short opens as an edit of its own, and "Download all" is one zip of every short with `shorts.txt` ([`lib/zip.ts`](lib/zip.ts)).
- **A finished edit** ([`ReEdit.tsx`](components/ReEdit.tsx)): the player, the transcript as a timeline and a panel of tabs. Deleting words is [`pnpm render --cut`](../../packages/engine/README.md#changing-an-edit); captions, music, the look, the brand kit, text and overlays change with a render alone. Changes pile up until Apply renders them as a new version. Reordering, another length beyond ±5 %, another aspect or the owner's own music need Re-plan ([`Replan.tsx`](components/Replan.tsx)), which plans again from the kept analysis. "Export to an editing app" runs [`pnpm render --export`](../../packages/engine/README.md#exporting-to-an-editing-app) on the version shown and downloads it as a zip.

Layout, tokens and motion follow [DESIGN.md](DESIGN.md); who the page is for, [PRODUCT.md](PRODUCT.md).

## Tests

`pnpm --filter @video-editor/web test` runs the `*.test.ts` files beside the code: the job routes against stand-ins for `pnpm edit` and `pnpm render` ([`app/api/jobs/routes.test.ts`](app/api/jobs/routes.test.ts)), the host check, keys, account, kits, versions, the zip and that every language has every message ([`lib/i18n/i18n.test.ts`](lib/i18n/i18n.test.ts)).
