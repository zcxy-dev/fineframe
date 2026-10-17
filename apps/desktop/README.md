# Desktop app

The [web page](../web/README.md) as an app of its own, for people with neither Node nor Python: download the installer, open it, paste a key and make an edit. Installing it is described in the [README](../../README.md#install).

## How it runs

- **Shell:** [Electron](https://www.electronjs.org) 44, whose built-in Node 24 also runs the page's server and `pnpm edit`, as it runs the TypeScript files as they are; nothing else installs Node. The window shows the page from `http://127.0.0.1:<port>`, a port the system hands out at each start, and only that page: other links open in the system's browser.
- **Server:** `next start`, in a process group of its own, with its output in the app's log folder (`~/Library/Logs/Video Editor/server.log` on macOS, `%APPDATA%\Video Editor\logs\` on Windows, `~/.config/Video Editor/logs/` on Linux). It never prints a key.
- **Keys:** in `keys.env` in the app's folder (`~/Library/Application Support/Video Editor/` on macOS, `%APPDATA%\Video Editor\` on Windows, `~/.config/Video Editor/` on Linux), written with permissions 0600 in a folder only its owner can open (on Windows, with an access list that keeps out the machine's other users), not in a repository's `.env`.
- **The analysis's Python:** not in the installer. On its first start, the server has the bundled [uv](https://docs.astral.sh/uv/) install a CPython of its own and the worker's locked packages into `python/` in the app's folder, about 2 GB with PyTorch, and the page shows the download. uv uses no Python and no settings of the user's own. After an update that changes the worker, it installs the worker again; otherwise later starts only check it.
- **First use:** the models, FFmpeg, Chrome Headless Shell and Remotion's compositor download on the first edit that needs them, each with its bar in the page, into the same caches `pnpm edit` uses (`~/.cache/video-editor/`, `~/.cache/huggingface/`).
- **Speech:** a computer with less than 12 GB of memory starts on [cloud speech](../../worker/README.md#cloud-speech), and the page says why and asks for an OpenRouter key.
- **Quitting** stops the server and everything it started: an edit, the analysis, FFmpeg and the Python setup (on Windows, with `taskkill` on the server's process tree). Closing the window quits. If the app ends any other way, even force-quit, the server sees the pipe from the app close and exits too.
- **Updates** are not automatic yet: install a newer version over the old one; the keys, the Python environment and the caches stay.

## Why Electron

The editor's planner, renderer and page are TypeScript on Node, and the analysis is Python, so any shell has to carry a Node runtime and a way to install Python. Electron carries Node already and runs the server with it, so the app is one runtime and the shell is TypeScript like the rest of the code. Tauri's own shell is smaller, as it uses the system's web view, but it would still need a Node runtime bundled beside it, a Rust toolchain to build, and on Linux WebKitGTK, which renders the page and plays its video differently from the Chromium it is tested in. Against the 2 GB of Python the first start installs, the difference in size matters little.

## Building

Each installer is built on the system it is for:

```bash
pnpm install
pnpm --filter @video-editor/desktop dist     # dist/Video-Editor-<version>-<os>-<arch>.dmg or .AppImage
```

[`scripts/stage.ts`](scripts/stage.ts) builds the page and stages what electron-builder packages into `build/`: the repository's layout with only the packages the server and `pnpm edit` run (pnpm's production install, without symlinks between dependencies), the worker's code and lockfile, and uv pinned by version and SHA-256. Left out: Remotion's compositor, whose FFmpeg is GPL with non-free parts (it downloads on first use; [notes](../../THIRD_PARTY_NOTICES.md#desktop-installers)), and sharp, which the page does not use. [`electron-builder.yml`](electron-builder.yml) makes a DMG on macOS with Apple silicon (Intel Macs cannot install the analysis: PyTorch and ONNX Runtime publish no builds for them), signed ad hoc as Apple silicon requires but not with a Developer ID; an NSIS installer on Windows, for the user alone and unsigned; and an AppImage on Linux. An NSIS installer keeps no links, and Node runs the workspace's TypeScript packages only through pnpm's links, never from inside `node_modules`, so on Windows the stage lists those links in `links.json` and the app makes them again as junctions on its first start.

`pnpm --filter @video-editor/desktop start` runs the app from the repository, with uv from PATH, after `pnpm --filter @video-editor/web build`.

## Releases

[`.github/workflows/desktop.yml`](../../.github/workflows/desktop.yml) builds the installers on GitHub's Apple silicon macOS, Windows and Linux runners for every pull request that changes the app or the page, and runs each built app. A tag `v<version>`, matching `version` in [package.json](package.json), also attaches the installers and their `SHA256SUMS` to a draft release of that tag, for the owner to publish.

## Tests

`pnpm --filter @video-editor/desktop test` starts the server against a stand-in for Next.js and checks its port, its environment and that stopping it stops what it started.

[`scripts/smoke.ts`](scripts/smoke.ts) runs a built app as a person would the first time, driving its window with Playwright: it saves a key, waits while the analysis installs, chooses cloud speech and saves its key, adds a synthetic clip spoken by the system's voice (`say` on macOS, .NET's speech synthesizer on Windows, espeak-ng on Linux), makes a 15 s edit and checks its length and captions, plays it in the window's own player and reads back the frame at its middle, then quits and checks that nothing the app started is still running and that the downloads showed in the page. Claude and OpenRouter are local stand-ins (`ANTHROPIC_BASE_URL`, `OPENROUTER_BASE_URL`): the plan keeps every line in order and pops one keyword, every cut passes its check, and each speech chunk is heard as one of the clip's sentences, so it costs nothing. The models, FFmpeg, Chrome Headless Shell and Remotion's compositor download for real, and the clip is analysed, planned, rendered and checked. CI runs it on every installer; locally, on Linux under a display:

```bash
xvfb-run -a node apps/desktop/scripts/smoke.ts apps/desktop/dist/Video-Editor-<version>-linux-x86_64.AppImage --shots shots/
```

`--shots` saves the window at each step.
