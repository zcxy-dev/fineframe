# Desktop app

The [web page](../web/README.md) as an app of its own, for people with neither Node nor Python: download the installer, open it, paste a key and make an edit. Installing it is described in the [README](../../README.md#install).

## How it runs

- **Shell:** [Electron](https://www.electronjs.org), whose built-in Node also runs the page's server and `pnpm edit`, running the TypeScript files as they are; nothing else installs Node. The window shows only the page, from `http://127.0.0.1:<port>` on a port the system hands out at each start; other links open in the system's browser ([`src/main.ts`](src/main.ts)).
- **Server:** `next start` in a process group of its own ([`src/server.ts`](src/server.ts)), its output in the app's log folder (`~/Library/Logs/Fineframe/server.log` on macOS, `%APPDATA%\Fineframe\logs\` on Windows, `~/.config/Fineframe/logs/` on Linux). It never prints a key.
- **The app's folder** (`~/Library/Application Support/Fineframe/` on macOS, `%APPDATA%\Fineframe\` on Windows, `~/.config/Fineframe/` on Linux) holds `keys.env` and `account.json`, readable by their owner alone (on Windows, an access list that keeps out the machine's other users), the brand kits (`brand-kits/`) and the analysis's Python (`python/`). The server gets them as `VIDEO_EDITOR_ENV_FILE`, `VIDEO_EDITOR_ACCOUNT_FILE` and `VIDEO_EDITOR_BRAND_KITS` ([web page](../web/README.md#server)).
- **Account:** "Sign in" follows the website's [entitlement contract](../site/ENTITLEMENT.md), implemented in [`lib/account.ts`](../web/lib/account.ts): an OAuth 2.1 sign-in in the system's browser, the session refreshed before it expires, and a check before each new edit or plan that holds for 7 days without Supabase. "Sign Out", in the page's account dialog and the menu, deletes the session. The Supabase URL, publishable key and OAuth client id, all public, come from the build (`FINEFRAME_SUPABASE_URL`, `FINEFRAME_SUPABASE_PUBLISHABLE_KEY`, `FINEFRAME_OAUTH_CLIENT_ID`, written by the stage into `supabase.json`); `FINEFRAME_DEV_ENTITLED=1`, for development and CI only, skips the check.
- **The analysis's Python:** not in the installer. On the first start the server has the bundled [uv](https://docs.astral.sh/uv/) install a CPython of its own and the worker's locked packages into `python/` ([size](../../README.md#install)), with the download shown in the page; uv uses no Python or settings of the user's. An update that changes the worker installs it again.
- **First use:** the models, FFmpeg, ffprobe, Chrome Headless Shell and, for a link, yt-dlp download on the first edit that needs them, into the caches `pnpm edit` uses (`~/.cache/video-editor/`, `~/.cache/huggingface/`). A computer with too little memory for the local speech model starts on [cloud speech](../../worker/README.md#cloud-speech).
- **Command line and agent skill** ([`src/install.ts`](src/install.ts)): the menu (Fineframe on macOS, File elsewhere) installs both ([README](../../README.md#use-it-from-an-ai-agent)). "Install Command Line Tool…" writes a launcher, `bin/fineframe` (`bin\fineframe.cmd` on Windows) in the app's folder, which runs the app's binary as Node on [`src/cli.ts`](src/cli.ts) with the server's environment: its uv, Python and saved keys. It is linked from `~/.local/bin` on Linux, from `~/.local/bin` or else `/usr/local/bin` on macOS, and put on the user's Path on Windows. "Install Agent Skill…" copies [`skills/video-editor`](../../skills/video-editor/SKILL.md), with the editor's files it names, into `~/.claude/skills/video-editor` and `~/.agents/skills/video-editor`, marked with `.installed-by-fineframe`, and asks before replacing a copy it did not install. At each start the app rewrites a launcher that points elsewhere and updates a skill it installed.
- **Quitting** stops the server and everything it started (on Windows, with `taskkill` on its process tree); closing the window quits. If the app ends any other way, even force-quit, the server sees its stdin close and exits ([`lib/parent.ts`](../web/lib/parent.ts)).
- **Updates** ([`src/updates.ts`](src/updates.ts)): an installed app checks `https://downloads.fineframe.app/` at start and every 4 hours with [electron-updater](https://www.electron.build/auto-update). It downloads a new version in the background (on macOS the zip beside the DMG) and installs it on restart or quit. The keys, the account, the Python environment and the caches stay.

## Why Electron

The editor's planner, renderer and page are TypeScript on Node, and the analysis is Python, so any shell has to carry a Node runtime and a way to install Python. Electron carries Node already and runs the server with it, so the app is one runtime and the shell is TypeScript like the rest of the code. Tauri's own shell is smaller, as it uses the system's web view, but it would still need a Node runtime bundled beside it, a Rust toolchain to build, and on Linux WebKitGTK, which renders the page and plays its video differently from the Chromium it is tested in. Against the 2 GB of Python the first start installs, the difference in size matters little.

## Building

Each installer is built on the system it is for:

```bash
pnpm install
pnpm --filter @video-editor/desktop dist     # dist/Fineframe-<version>-<os>-<arch>.dmg, .exe or .AppImage
```

[`scripts/stage.ts`](scripts/stage.ts) builds the page and stages what electron-builder packages into `build/`: the repository's layout with only the packages the server and `pnpm edit` run (pnpm's production install, without symlinks between dependencies), the worker's code and lockfile, and uv pinned by version and SHA-256. Left out: sharp, which neither the page nor a render uses ([notes](../../THIRD_PARTY_NOTICES.md#desktop-installers)), and the packages' source maps. [`electron-builder.yml`](electron-builder.yml) makes a DMG and a zip for Apple silicon, signed ad hoc as Apple silicon requires, or with the Developer ID and notarized by [`desktop.yml`](../../.github/workflows/desktop.yml); an unsigned per-user NSIS installer on Windows; and an AppImage on Linux. An NSIS installer keeps no links, and Node runs the workspace's TypeScript packages only through pnpm's links, so on Windows the stage lists them in `links.json` and the app makes them again as junctions on its first start.

`pnpm --filter @video-editor/desktop start` runs the app from the repository, with uv from PATH, after `pnpm --filter @video-editor/web build`.

## Releases

[`.github/workflows/desktop.yml`](../../.github/workflows/desktop.yml) builds the installers on GitHub's Apple silicon macOS, Windows and Linux runners and runs each built app's smoke test, for a pull request that changes `apps/desktop/` or on request (`gh workflow run desktop.yml --ref <branch>`). A tag `v<version>`, matching `version` in [package.json](package.json), also makes signed build provenance for each installer and uploads the installers, copies under names without the version (which the website's download page links to), a `SHA256SUMS` and the update feed (`latest*.yml` and the blockmaps) to the Cloudflare R2 bucket that `downloads.fineframe.app` serves, then calls the site's deploy hook so the download page names the new version. Installers never go to GitHub's releases. On a tag or a manual run the macOS job signs the app with the Developer ID Application certificate (`MAC_CSC_LINK`, the `.p12` in base64, and `MAC_CSC_KEY_PASSWORD`), notarizes it with an App Store Connect team API key (`APPLE_API_KEY_P8`, the `.p8` file's contents, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`), and checks the signature and the stapled ticket; a manual run without those secrets is signed ad hoc, and electron-builder signs nothing for a pull request. A tag's build needs the `CLOUDFLARE_ACCOUNT_ID`, `FINEFRAME_SUPABASE_URL`, `FINEFRAME_SUPABASE_PUBLISHABLE_KEY` and `FINEFRAME_OAUTH_CLIENT_ID` repository variables and the `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `CLOUDFLARE_PAGES_DEPLOY_HOOK` and five Apple secrets; without them the release fails.

## Tests

`pnpm --filter @video-editor/desktop test` runs the `*.test.ts` files in `src/` and `scripts/`: the server against a stand-in for Next.js (its port, its environment, and that stopping it stops what it started), the launcher and the skill's install, the updates, and the helpers of the stage and the smoke test.

[`scripts/smoke.ts`](scripts/smoke.ts) runs a built app as a person would the first time, driving its window with Playwright, with `FINEFRAME_DEV_ENTITLED=1` and local stand-ins for Claude and OpenRouter (`ANTHROPIC_BASE_URL`, `OPENROUTER_BASE_URL`), so it costs nothing: it saves the keys, waits for the analysis to install, makes a 15 s edit of a clip spoken by the system's voice (`say` on macOS, .NET's speech synthesizer on Windows, espeak-ng on Linux) and checks it, plays it, switches the language, installs the command and the skill and makes an edit with the command, then quits and checks that nothing the app started is still running. The models, FFmpeg, ffprobe and Chrome Headless Shell download for real. Its caches, and on macOS and Linux its home folder, are in a temporary folder deleted at the end; on Windows the skill goes in the user's own folders, never over a copy the app did not install. CI runs it on every installer; locally, on Linux under a display:

```bash
xvfb-run -a node apps/desktop/scripts/smoke.ts apps/desktop/dist/Fineframe-<version>-linux-x86_64.AppImage --shots shots/
```

`--shots` saves the window at each step.
