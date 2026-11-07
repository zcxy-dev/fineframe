# Fineframe

**A fully automatic video editor, in development.** Drop in your footage, choose a length and an aspect ratio, and get back a finished video, cut, captioned, framed, graded and animated, with no manual steps. It is built for Mandarin, English and speech that switches between them. Captions come out in Taiwan Traditional Chinese.

[![CI](https://github.com/zcxy-dev/fineframe/actions/workflows/ci.yml/badge.svg)](https://github.com/zcxy-dev/fineframe/actions/workflows/ci.yml)
[![License: proprietary](https://img.shields.io/badge/license-proprietary-red.svg)](LICENSE)

![Six frames from a 60-second 9:16 edit of an interview about Surya, an AI model that forecasts solar flares: name cards for the interviewer and the researcher, close-ups framed on whoever speaks, "solar flare" and "data" highlighted, and captions lit word by word](https://downloads.fineframe.app/examples/v0.2.0/example-edit-9x16.jpg)

*A 60-second 9:16 edit made by `pnpm edit` with no manual steps from IBM Research's 19-minute interview "[Why NASA and IBM made a new AI model that predicts the Sun's damaging flares](https://www.youtube.com/watch?v=KWMoF97C1Ds)" ([CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)), cut, reframed, captioned and named on screen ([watch it](https://downloads.fineframe.app/examples/v0.2.0/example-edit-60s-9x16.mp4), [16:9 version](https://downloads.fineframe.app/examples/v0.2.0/example-edit-90s-16x9.mp4), [credits](THIRD_PARTY_NOTICES.md#readme-example)).*

## Install

The desktop app needs nothing else installed: no Node, no Python, no command line. Download the installer for your computer from the [download page](https://fineframe.app/en/download/), or straight from `downloads.fineframe.app`:

| Computer | Installer |
|---|---|
| Mac with Apple silicon (M1 or later) | [`Fineframe-mac-arm64.dmg`](https://downloads.fineframe.app/Fineframe-mac-arm64.dmg) |
| Windows 10 or 11 (x64) | [`Fineframe-win-x64.exe`](https://downloads.fineframe.app/Fineframe-win-x64.exe) |
| Linux (x86-64) | [`Fineframe-linux-x86_64.AppImage`](https://downloads.fineframe.app/Fineframe-linux-x86_64.AppImage) |

These are always the latest version; each version also stays there as `Fineframe-<version>-mac-arm64.dmg`, `-win-x64.exe` and `-linux-x86_64.AppImage`. Macs with an Intel processor are not supported. [`SHA256SUMS`](https://downloads.fineframe.app/SHA256SUMS) lets you check the file you downloaded, and `gh attestation verify <file> --repo zcxy-dev/fineframe` checks that GitHub Actions built it from this repository.

**macOS.** Open the DMG and drag Fineframe into Applications. The app is not signed with an Apple Developer ID, so the first time you open it, macOS says it cannot check the app for malicious software and offers only Done or Move to Trash. Choose Done, then open **System Settings → Privacy & Security**, scroll to Security, and choose **Open Anyway** next to the message about Fineframe; confirm with your password. Later launches open normally.

**Windows.** Open the installer: it installs Fineframe for your user alone, with no administrator needed, and opens it. The installer is not signed with a code-signing certificate, so Microsoft Defender SmartScreen may show "Windows protected your PC". Choose **More info**, check that the app is Fineframe, then choose **Run anyway**.

**Linux.** Make the AppImage executable (`chmod +x Fineframe-*.AppImage`) and run it. AppImages need FUSE 2: on Ubuntu 24.04, `sudo apt install libfuse2t64`.

**The first time it opens,** the app asks you to:

1. Sign in to your Fineframe account, in your browser on fineframe.app. Making or replanning an edit needs the account, free during the public beta and with a [subscription](https://fineframe.app/en/pricing/) once paid plans open; rendering, opening earlier projects and downloads work without it. The app checks the account before each edit and keeps working offline for 7 days after its last check.
2. Paste your [Anthropic API key](https://console.anthropic.com/settings/keys). Claude plans each edit, writes its motion graphics and checks its cuts: about US$0.20 to 0.60 for an edit of a minute or less and US$1 to 1.20 for one of five minutes ([measured](packages/engine/MEASUREMENTS.md#planner-measurements)).

Meanwhile it installs the analysis once, about 2 GB of Python and PyTorch. The first edit downloads the speech model ([sizes](#which-speech-model-runs)), FFmpeg and the effects renderer, and the first imported link downloads yt-dlp, each with its own progress bar. On a computer with less than 12 GB of memory, too little for the speech model, speech is heard on OpenRouter instead, with your [OpenRouter API key](https://openrouter.ai/settings/keys), for about US$0.03 an hour of footage; the app says so, and either can be chosen.

**Where it keeps things.** The keys and the sign-in stay on your computer, in files only your user can read, in the app's folder (`~/Library/Application Support/Fineframe` on macOS, `%APPDATA%\Fineframe` on Windows, `~/.config/Fineframe` on Linux), with the Python it installed and your brand kits. Models and edits are in `.cache/video-editor` and `.cache/huggingface` in your user folder. To remove the app entirely, uninstall or delete it and delete those folders. The older app called Video Editor is separate: uninstall it and delete its `Video Editor` folder.

**Updates.** On Windows and Linux the app downloads a new version in the background and installs it when you restart it ("Restart to update" in the window) or quit it. On a Mac the window says when a new version is out, with its download: install it over the old one. Either way the keys and downloads stay.

## What it does

```text
footage/ (any number of clips)  +  length (15 s … 1 h)  +  aspect (9:16 · 1:1 · 16:9)
        │
        ▼
analyze     shots · speech and pauses · transcript with word timings · faces · audio events
plan        pick the best takes, remove fillers and dead air, fit the requested length
render      cuts · framing · colour · voice · music · animated captions · effects · loudness
check       review every cut, fix what is wrong, at most three passes
        │
        ▼
finished.mp4  +  captions.srt
```

One page drives it: drop the files or paste a video's link, pick the length and aspect ratio, press start, and download the result.

- **Footage:** any number of clips, including rotated phone footage and HDR, or a public video's link from YouTube or another site [yt-dlp](https://github.com/yt-dlp/yt-dlp) reads, imported at up to 1080p.
- **Transcript:** mixed Mandarin and English stays mixed, in Taiwan Traditional Chinese, timed word by word, heard on your computer or on OpenRouter. Optionally, Claude fixes misheard names, terms and homophones.
- **Cut:** Claude picks the best takes and checks every cut; cuts fall between words, at the length asked.
- **Several shorts:** up to 10 shorts from one long video, each with a title, a description and hashtags.
- **Framing:** a virtual camera frames every clip in the edit's shape and follows whoever speaks.
- **Picture and sound:** colour matching and grading, transitions, studio voice processing for each source, and loudness for publishing.
- **Music:** a built-in library of 40 CC0 tracks, or tracks you supply, fitted to the edit and ducked under speech.
- **Captions:** burned in word by word, with a SubRip file that matches the picture.
- **Graphics:** animated titles, name cards, chapters, callouts and wipes, and motion graphics Claude writes for each edit.
- **B-roll:** a rich edit, the default, cuts away to stock footage and captures of the pages the speaker names, from free sources.
- **Brand kits:** a logo watermark, up to three colours, fonts and custom captions, kept as named kits and changed on a finished edit with a render alone.
- **Changing an edit:** render a changed edit again without analysing or planning again, change it by conversation with the [agent skill](#use-it-from-an-ai-agent), or export it as a timeline for Final Cut Pro, DaVinci Resolve or Premiere Pro.

Analysis and rendering run on your computer; [SECURITY.md](SECURITY.md#scope) says what planning, the cut review, transcript correction, cloud speech, B-roll and link import send or fetch.

## Quick start

From the source, for development and the command line; to only use the editor, [install the app](#install).

**Requirements:**
- macOS on Apple silicon, Windows 10 or 11 on x64, or Linux.
- [mise](https://mise.jdx.dev), which installs the pinned Node, Python and `uv`; Node's corepack then provides the pinned pnpm. On Windows, install it with `winget install jdx.mise` and run the commands below in PowerShell, with [Git](https://git-scm.com/download/win) installed.
- Disk space for the Python environment ([size](#install)) and the model weights downloaded on first use ([sizes](#which-speech-model-runs)).
- An [Anthropic API key](https://console.anthropic.com/settings/keys) ([cost](#install)).

```bash
git clone https://github.com/zcxy-dev/fineframe.git
cd fineframe
mise run start
```

`mise run start` installs the tools, the packages and the Python environment, builds the [web page](apps/web/README.md), starts it on 127.0.0.1 and opens it in the browser. mise asks once to trust the repository's `mise.toml`. The first time, the page asks for the API key, checks it with Anthropic and keeps it in the git-ignored `.env`. Run it again the same way; with mise [activated](https://mise.jdx.dev/getting-started.html) in your shell, `pnpm start` does the same.

From the command line, once `mise run start` has set things up (or after `mise install`, `pnpm install` and `uv sync` in `worker/`), with the key in `.env` (copy `.env.example`; `copy .env.example .env` on Windows):

```bash
pnpm edit footage/ --length 60s --aspect 9:16 -o out/edit.mp4
```

`pnpm edit --help` lists the options, among them `--shorts`, `--brand`, `--names`, `--correct` and `--asr cloud`. [`packages/engine`](packages/engine/README.md#editing-footage) says what the command writes, how it reports progress, and how [`pnpm render`](packages/engine/README.md#changing-an-edit) renders a changed edit or [exports](packages/engine/README.md#exporting-to-an-editing-app) it to an editing app. The analysis on its own writes one file's [media index](packages/schema/media-index.schema.json):

```bash
cd worker
uv run vework analyze talk.mp4 -o talk.index.json
```

### Which speech model runs

| Model | Weights to download | Speed on the [reference machine](bench/README.md#reference-machine) | Peak memory |
|---|---|---|---|
| Qwen3-ASR-0.6B | 3.4 GB | ~1.3× the clip's length | ~9 GB |
| Qwen3-ASR-1.7B | 5.9 GB | ~14× the clip's length | ~14 GB |
| `--asr cloud` | 1.8 GB (the aligner) | ~0.5× the clip's length, with OpenRouter responding quickly | ~3.3 GB |

Weight sizes include the aligner. `vework` uses 1.7B with a CUDA GPU and 0.6B otherwise; `--asr-model` overrides that. With `--asr cloud` (`pnpm edit --asr cloud`), OpenRouter hears the speech and only the aligner runs here; the key goes in `.env` as `OPENROUTER_API_KEY` ([cloud speech](worker/README.md#cloud-speech)). On Linux and Windows the models run on the CPU. On a Mac with Apple silicon the speech model runs on its GPU, falling back to the CPU by itself, and the aligner on the CPU ([Apple silicon](worker/README.md#apple-silicon)).

## Use it from an AI agent

The [`video-editor` skill](skills/video-editor/SKILL.md) teaches Claude Code, Codex and other agents that read [Agent Skills](https://agentskills.io) to run the editor: check the setup, make an edit, and then change the finished edit as you ask for it, such as "cut the part about pricing", "the caption says 阿者, it should be 阿哲", "call it 剪輯師的一天" or "turn the music down". Each change renders a new version beside the last, without analysing or planning again.

**With the desktop app:** choose "Install Command Line Tool…" and "Install Agent Skill…" in its menu (the Fineframe menu on macOS, File on Windows and Linux). The first puts a `fineframe` command on your PATH: `fineframe edit` and `fineframe render` take the same options as `pnpm edit` and `pnpm render`, and run with the app's own runtime and the keys saved in it; `fineframe edit` needs the account signed in in the app. The second copies the skill into `~/.claude/skills/video-editor` for Claude Code and `~/.agents/skills/video-editor` for Codex. Each dialog says where it installed and how to remove it. The app updates both when it updates itself.

**From a clone:** set it up as in the [quick start](#quick-start), then link the skill into the clone's own skills folder, so nothing outside the clone changes:

```bash
# Claude Code
mkdir -p .claude/skills && ln -s ../../skills/video-editor .claude/skills/video-editor
# Codex and other agents that read .agents/skills
mkdir -p .agents/skills && ln -s ../../skills/video-editor .agents/skills/video-editor
```

Start a new session in the clone and ask it to edit a folder of footage, or to change an edit you made. A `git pull` updates the skill with the editor.

## Contributing

Setup, checks and the rules every change follows are in [CONTRIBUTING.md](CONTRIBUTING.md). How each part works: the [analysis](worker/README.md), [planning and rendering](packages/engine/README.md), [effects](packages/effects/), [file formats](packages/schema/), the [web page](apps/web/README.md), the [desktop app](apps/desktop/README.md) and the [benchmark](bench/README.md). Report security issues as described in [SECURITY.md](SECURITY.md).

## Acknowledgements

The editor is built on these models and libraries: [Qwen3-ASR and Qwen3-ForcedAligner](https://github.com/QwenLM/Qwen3-ASR) for the transcript, [TransNetV2](https://github.com/soCzech/TransNetV2) for shots, [Silero VAD](https://github.com/snakers4/silero-vad) for speech, [CED](https://github.com/RicherMans/CED) for audio events, [YuNet](https://github.com/ShiqiYu/libfacedetection.train) for faces, [Beat This!](https://github.com/CPJKU/beat_this) for beats, [DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) for the voice, [OpenCC](https://github.com/BYVoid/OpenCC) for Traditional Chinese, [FFmpeg](https://ffmpeg.org) and libass for rendering, [HyperFrames](https://github.com/heygen-com/hyperframes) for the effects, [Next.js](https://nextjs.org) for the web page, [Noto CJK](https://github.com/notofonts/noto-cjk) and [Inter](https://github.com/rsms/inter) for type, and [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh) for the synthetic corpus's voices.

## License

The project's code is proprietary, all rights reserved ([LICENSE](LICENSE)). [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists every model, font and program it uses and every package it depends on directly, with its licence and how it reaches you. Two of them need attention before commercial use or redistribution:

- **FFmpeg**: the builds the renderer downloads and the PyAV wheels the worker installs are GPL. Redistributing FFmpeg means meeting the GPL or shipping an LGPL build ([details](THIRD_PARTY_NOTICES.md#ffmpeg)); the desktop app's installers carry no FFmpeg, which downloads on first use ([details](THIRD_PARTY_NOTICES.md#desktop-installers)).
- **Optional extras** install a few GPL packages: espeak-ng and phonemizer in the benchmark's `synth` extra ([details](THIRD_PARTY_NOTICES.md#copyleft-dependencies)).
