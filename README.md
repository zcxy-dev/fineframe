# Fineframe

**A fully automatic video editor, in development.** The goal: drop in your footage, choose a length and an aspect ratio, and get back a finished video, cut, captioned, framed, graded and animated, with no manual steps. It is built for Mandarin, English and speech that switches between them. Captions come out in Taiwan Traditional Chinese.

[![CI](https://github.com/zcxy-dev/fineframe/actions/workflows/ci.yml/badge.svg)](https://github.com/zcxy-dev/fineframe/actions/workflows/ci.yml)
[![License: proprietary](https://img.shields.io/badge/license-proprietary-red.svg)](LICENSE)

> **Status:** the analysis worker, the planner, the renderer with its captions and effect templates, the `pnpm edit` command that runs them from footage to a finished video, the web page in front of it, the desktop app for Apple silicon Macs, Windows and Linux that runs the page with nothing else to install, the agent skill that changes a finished edit by conversation, and the benchmark work today.

![Six frames from a 60-second 9:16 edit of an interview about Surya, an AI model that forecasts solar flares: name cards for the interviewer and the researcher, close-ups framed on whoever speaks, "solar flare" and "data" highlighted, and captions lit word by word](https://github.com/zcxy-dev/fineframe/releases/download/v0.2.0/example-edit-9x16.jpg)

*A 60-second 9:16 edit made by `pnpm edit` with no manual steps from IBM Research's 19-minute interview "[Why NASA and IBM made a new AI model that predicts the Sun's damaging flares](https://www.youtube.com/watch?v=KWMoF97C1Ds)" ([CC BY 3.0](https://creativecommons.org/licenses/by/3.0/)), cut, reframed, captioned and named on screen ([watch it](https://github.com/zcxy-dev/fineframe/releases/download/v0.2.0/example-edit-60s-9x16.mp4), [16:9 version](https://github.com/zcxy-dev/fineframe/releases/download/v0.2.0/example-edit-90s-16x9.mp4), [credits](THIRD_PARTY_NOTICES.md#readme-example)).*

## Install

The desktop app needs nothing else installed: no Node, no Python, no command line. Download the installer for your computer from the [latest release](https://github.com/zcxy-dev/fineframe/releases/latest):

| Computer | Installer |
|---|---|
| Mac with Apple silicon (M1 or later) | `Fineframe-<version>-mac-arm64.dmg` |
| Windows 10 or 11 (x64) | `Fineframe-<version>-win-x64.exe` |
| Linux (x86-64) | `Fineframe-<version>-linux-x86_64.AppImage` |

Macs with an Intel processor are not supported: PyTorch and ONNX Runtime, which the analysis runs on, no longer publish builds for them.

**macOS.** Open the DMG and drag Fineframe into Applications. The app is not yet signed with an Apple Developer ID, so the first time you open it, macOS says it cannot check the app for malicious software and offers only Done or Move to Trash. Choose Done, then open **System Settings → Privacy & Security**, scroll to Security, and choose **Open Anyway** next to the message about Fineframe; confirm with your password. macOS remembers the choice, and later launches open normally. Each release's `SHA256SUMS` lets you check the file you downloaded, and `gh attestation verify <file> --repo zcxy-dev/fineframe` checks that GitHub Actions built it from this repository.

**Windows.** Open the installer: it installs Fineframe for your user alone, with no administrator needed, and opens it. The installer is not yet signed with a code-signing certificate, so Microsoft Defender SmartScreen may show "Windows protected your PC". Choose **More info**, check that the app is Fineframe, then choose **Run anyway**.

**Linux.** Make the AppImage executable (`chmod +x Fineframe-*.AppImage`) and run it. AppImages need FUSE 2: on Ubuntu 24.04, `sudo apt install libfuse2t64`.

**The first time it opens,** the app asks for your [Anthropic API key](https://console.anthropic.com/settings/keys) and checks it; Claude plans each edit, writes its motion graphics and checks its cuts, about US$0.20 to 0.50 for an edit of a minute or less and US$1 for one of five minutes ([measured](packages/engine/MEASUREMENTS.md#planner-measurements)). Meanwhile it installs the analysis once, about 2 GB of Python and PyTorch, with its progress in the window. The first edit then downloads what it needs on first use, each with its own bar: the speech model ([sizes](#which-speech-model-runs)), FFmpeg and the effects renderer. On a computer with less than 12 GB of memory, too little for the speech model, speech is heard on OpenRouter instead, with your [OpenRouter API key](https://openrouter.ai/settings/keys), for about US$0.03 an hour of footage; the app says so, and either can be chosen.

The keys stay on your computer, in a file only your user can read, in the app's folder (`~/Library/Application Support/Fineframe` on macOS, `%APPDATA%\Fineframe` on Windows, `~/.config/Fineframe` on Linux), with the Python it installed. The models and edits are in `.cache\video-editor` and `.cache\huggingface` in your user folder (`~/.cache/…` on macOS and Linux). To remove the app entirely, uninstall or delete it and delete those folders. The app does not update itself yet: install a newer version over it, and the keys and downloads stay. Releases up to 0.3.0 were called Video Editor: Fineframe does not replace it and asks for the key again, since that app's folder is `Video Editor`; uninstall it and delete that folder. How the app is built: [`apps/desktop`](apps/desktop/README.md).

## Design

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

A single web page drives it: drop the files, pick the length and aspect ratio, press start, and download the result.

## What works today

- **Probe:** rotated phone footage, non-square pixels, HDR and every audio track, read as they play ([sources](packages/engine/README.md#what-it-renders)).
- **Shot detection:** [TransNetV2](https://github.com/soCzech/TransNetV2) finds hard cuts and dissolves.
- **Speech and pauses:** [Silero VAD](https://github.com/snakers4/silero-vad) finds where someone speaks.
- **Loudness and audio events:** EBU R128 loudness, and laughter, applause and music from the [CED](https://github.com/RicherMans/CED) tagger ([details](worker/README.md#media-index)).
- **Faces and who speaks:** [YuNet](https://huggingface.co/opencv/face_detection_yunet) faces tracked through each shot, and who speaks when ([details](worker/README.md#faces-and-speakers)).
- **Long sources:** frames and speech stream through the analysis, so a source's length barely changes its memory; the speech model sets the peak ([sizes](#which-speech-model-runs), [shots](worker/README.md#media-index), [voice](worker/README.md#voice)).
- **Transcript:** [Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR) keeps mixed Mandarin and English mixed, in Taiwan Traditional Chinese with [OpenCC](https://github.com/BYVoid/OpenCC), timed word by word, locally or on OpenRouter ([details](worker/README.md#word-timings)).
- **Transcript correction** (opt-in): Claude fixes misheard names, terms and homophones, and only edits that keep every spoken word apply ([details](worker/README.md#transcript-correction)).
- **Plan:** [Claude plans the edit](packages/engine/README.md#planning) and checks every cut; code cuts between words to the length asked ([measurements](packages/engine/MEASUREMENTS.md#planner-measurements)).
- **Framing:** a [virtual camera](packages/engine/README.md#framing) frames every clip in the edit's shape and follows whoever speaks.
- **Render:** [`project.json` to MP4](packages/engine/README.md#how-it-renders) with frame- and sample-exact cuts, transitions, B-roll, grading and loudness ([measurements](packages/engine/MEASUREMENTS.md#render-measurements)).
- **Music:** tracks you supply, fitted to the edit and ducked under speech ([details](packages/engine/README.md#planning), [measurements](packages/engine/MEASUREMENTS.md#music-measurements)).
- **One command:** [`pnpm edit`](packages/engine/README.md#editing-footage) turns a folder of footage into the finished video at the length and aspect asked ([measurements](packages/engine/MEASUREMENTS.md#edit-measurements)).
- **Desktop app:** [installers](#install) for Apple silicon Macs, Windows and Linux run the web page with nothing else to install ([details](apps/desktop/README.md)).
- **Web page:** [one page](apps/web/README.md) runs `pnpm edit` on dropped footage, with live progress, cost estimates and downloads.
- **Changing an edit:** [`pnpm render`](packages/engine/README.md#changing-an-edit) renders a changed `project.json` again, and the [agent skill](#use-it-from-an-ai-agent) changes an edit by conversation.
- **Effects:** six animated text [templates](packages/effects/#templates), rendered with [HyperFrames](https://github.com/heygen-com/hyperframes) ([placement](packages/engine/README.md#planning)).
- **B-roll:** a rich edit, the default, cuts away to stock footage and captures of the pages the speaker names, from free sources ([details](packages/engine/README.md#visuals)).
- **Motion graphics:** Claude writes each edit's [graphics](packages/effects/#graphics) as HTML and CSS once its cut is known: corner labels and lower thirds over the speaker, a panel over the speaker at 9:16, and full-frame graphics, each checked as drawn and against the speech.
- **Captions:** [burned in word by word](packages/engine/README.md#captions), with a SubRip file that matches the picture.
- **Studio voice:** each source's speech [denoised and processed](packages/engine/README.md#voice) by a chain chosen from its measurements ([measurements](packages/engine/MEASUREMENTS.md#voice-measurements)).
- **Benchmark:** [`vebench`](bench/README.md#metrics) scores transcripts, shots, speakers, renders, music and edits across a corpus.
- **Blind review:** a [local page](bench/README.md#blind-review) records people's ratings of edits and which of two versions they prefer.
- **File formats:** [JSON Schemas](packages/schema/) for the media index, `project.json` and progress lines, with generated types and validators.
- **Ground truth drafts:** `vework draft-truth` drafts a corpus clip's transcript for a person to correct ([workflow](bench/README.md#ground-truth)).
- **Platforms:** macOS on Apple silicon, Windows x64 and Linux x64, tested by CI on every change. Intel Macs are not supported.
- **Synthetic corpus:** [`vebench synth`](bench/README.md#synthetic-corpus) generates talks, conversations, a phone walk, screen recordings and music with exact truth.

Analysis and rendering run locally; [SECURITY.md](SECURITY.md#scope) says what planning, the cut review, transcript correction, cloud speech and a rich edit's B-roll send or fetch.

## Quick start

From the source, for development and the command line; to only use the editor, [install the app](#install).

**Requirements:**
- macOS on Apple silicon, Windows 10 or 11 on x64, or Linux.
- [mise](https://mise.jdx.dev), which installs the pinned Node, Python and `uv`; Node's corepack then provides the pinned pnpm. On Windows, install it with `winget install jdx.mise` and run the commands below in PowerShell, with [Git](https://git-scm.com/download/win) installed.
- Disk space for the Python environment ([size](#install)) and the model weights downloaded on first use ([sizes](#which-speech-model-runs)).
- An [Anthropic API key](https://console.anthropic.com/settings/keys): Claude plans the edit and checks its cuts ([cost](#install)).

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

`pnpm edit --help` lists the options; [`packages/engine`](packages/engine/README.md#editing-footage) says what the command writes and how it reports progress. The analysis on its own writes one file's media index:

```bash
cd worker
# Shots, speech, a transcript with word timings, loudness, audio events, faces and who speaks,
# and voice measurements, with the denoised speech beside the index (talk.voice.wav).
uv run vework analyze talk.mp4 -o talk.index.json
```

The [media index format](packages/schema/media-index.schema.json) is defined with the other file formats in [`packages/schema`](packages/schema/).

### Which speech model runs

| Model | Weights to download | Speed on the [reference machine](bench/README.md#reference-machine) | Peak memory |
|---|---|---|---|
| Qwen3-ASR-0.6B | 3.4 GB | ~1.3× the clip's length | ~9 GB |
| Qwen3-ASR-1.7B | 5.9 GB | ~14× the clip's length | ~14 GB |
| `--asr cloud` | 1.8 GB (the aligner) | ~0.5× the clip's length, with OpenRouter responding quickly | ~3.3 GB |

Weight sizes include the aligner. `vework` uses 1.7B with a CUDA GPU and 0.6B otherwise; `--asr-model` overrides that. With `--asr cloud` (`pnpm edit --asr cloud`), OpenRouter hears the speech and only the aligner runs here. The key goes in `.env` as `OPENROUTER_API_KEY` ([cloud speech](worker/README.md#cloud-speech)). On Linux and Windows, the lockfile installs a CPU-only PyTorch, so the models run on the CPU there.

To plan or render on its own, see [`packages/engine`](packages/engine/). To score outputs against ground truth, see [`bench/`](bench/).

## Use it from an AI agent

The [`video-editor` skill](skills/video-editor/SKILL.md) teaches Claude Code, Codex and other agents that read [Agent Skills](https://agentskills.io) to run the editor: check the setup, make an edit, and then change the finished edit as you ask for it, such as "cut the part about pricing", "the caption says 阿者, it should be 阿哲", "call it 剪輯師的一天" or "turn the music down". Each change edits the edit's `project.json` and renders it again, without analysing or planning again, into a new version beside the last.

Set up the clone as in the [quick start](#quick-start), then link the skill into your agent's skills folder from the clone:

```bash
# Claude Code
mkdir -p ~/.claude/skills && ln -s "$PWD/skills/video-editor" ~/.claude/skills/video-editor
# Codex
mkdir -p ~/.agents/skills && ln -s "$PWD/skills/video-editor" ~/.agents/skills/video-editor
```

Start a new session and ask it to edit a folder of footage, or to change an edit you made. A `git pull` in the clone updates the skill with the editor.

## Contributing

Setup, checks and the rules every change follows are in [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues as described in [SECURITY.md](SECURITY.md).

## Acknowledgements

The editor is built on these models and libraries: [Qwen3-ASR and Qwen3-ForcedAligner](https://github.com/QwenLM/Qwen3-ASR) for the transcript, [TransNetV2](https://github.com/soCzech/TransNetV2) for shots, [Silero VAD](https://github.com/snakers4/silero-vad) for speech, [CED](https://github.com/RicherMans/CED) for audio events, [YuNet](https://github.com/ShiqiYu/libfacedetection.train) for faces, [Beat This!](https://github.com/CPJKU/beat_this) for beats, [DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) for the voice, [OpenCC](https://github.com/BYVoid/OpenCC) for Traditional Chinese, [FFmpeg](https://ffmpeg.org) and libass for rendering, [HyperFrames](https://github.com/heygen-com/hyperframes) for the effects, [Next.js](https://nextjs.org) for the web page, [Noto CJK](https://github.com/notofonts/noto-cjk) and [Inter](https://github.com/rsms/inter) for type, and [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh) for the synthetic corpus's voices.

## License

The project's code is proprietary, all rights reserved ([LICENSE](LICENSE)). [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists every model, font and program it uses and every package it depends on directly, with its licence and how it reaches you, and keeps the notices of code adapted from other projects. Three of them need attention before commercial use or redistribution:

- **FFmpeg**: the builds the renderer downloads and the PyAV wheels the worker installs are GPL. Redistributing FFmpeg means meeting the GPL or shipping an LGPL build ([details](THIRD_PARTY_NOTICES.md#ffmpeg)); the desktop app's installers carry no FFmpeg, which downloads on first use ([details](THIRD_PARTY_NOTICES.md#desktop-installers)).
- **Optional extras** install a few GPL packages: espeak-ng and phonemizer in the benchmark's `synth` extra ([details](THIRD_PARTY_NOTICES.md#copyleft-dependencies)).
