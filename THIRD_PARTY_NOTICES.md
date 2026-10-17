# Third-party notices

The project's own code is under the [MIT License](LICENSE). It uses the components below, each under its own licence. Nothing in this repository bundles a model weight, a font or a binary, and its only third-party media are [a few CC0 sound effects](#sound-effects) and [the effect cards' icons](#icons-copied-into-the-source): the tools download the rest on first use, from their publishers, or the package managers install them. The desktop app's installers do carry programs: Electron, uv and the npm packages the editor runs, but no FFmpeg, model or Python package ([what they carry](#desktop-installers)). Licences were checked against each component's own licence file or model card at the version or revision the project pins.

## Components

### Models and data, downloaded on first use

| Component | Licence | How it reaches you |
|---|---|---|
| [Qwen3-ASR-0.6B-hf, Qwen3-ASR-1.7B-hf](https://huggingface.co/Qwen/Qwen3-ASR-0.6B-hf) and [Qwen3-ForcedAligner-0.6B-hf](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B-hf) | Apache-2.0 | Hugging Face, pinned revision; worker `ml` extra |
| [CED-Base](https://huggingface.co/mispeech/ced-base), ONNX export | Apache-2.0 on its model card (see [notes](#ced-base)) | Hugging Face, pinned revision; worker `ml` extra |
| [YuNet](https://huggingface.co/opencv/face_detection_yunet) (`face_detection_yunet_2023mar.onnx`) | MIT | Hugging Face, pinned revision and SHA-256; worker `ml` extra |
| [Beat This!](https://github.com/CPJKU/beat_this) `final0` checkpoint | MIT | JKU Linz's file server, SHA-256 checked; worker `ml` extra |
| [DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet) ONNX export | MIT OR Apache-2.0 | GitHub, pinned commit and SHA-256; worker `ml` extra |
| [Noto Sans CJK TC](https://github.com/notofonts/noto-cjk) Bold and Black | OFL-1.1 | GitHub, pinned commit and SHA-256; renderer, for captions |
| [FFmpeg](https://ffmpeg.org) static builds: from [imageio-binaries](https://github.com/imageio/imageio-binaries), 7.0.2 on Linux, 7.1 on Apple silicon and on Windows ([gyan.dev](https://www.gyan.dev/ffmpeg/builds/)'s essentials build) | GPL-3.0-or-later (Linux, Windows), GPL-2.0-or-later (macOS) | GitHub, pinned commit and SHA-256; renderer, run as a separate program (see [notes](#ffmpeg)) |
| Remotion's compositor (`@remotion/compositor-*`), with its own FFmpeg | [Remotion License](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md); its FFmpeg is configured with `--enable-gpl`, libx264, libx265 and libfdk-aac | Installed with @remotion/renderer by pnpm; for the desktop app, downloaded from npm on the first effect render, checked against `pnpm-lock.yaml` (see [notes](#desktop-installers)) |
| [CPython](https://www.python.org) builds from [python-build-standalone](https://github.com/astral-sh/python-build-standalone) | PSF-2.0, with the licences of the libraries each build includes | Desktop app only: installed by uv into the app's folder on its first start |
| Chrome Headless Shell ([Chromium](https://www.chromium.org)) | Chromium's BSD-3-Clause licence and the third-party licences it lists; Google's build also refers to the Chrome terms of service | Downloaded by Remotion on the first effect render or web capture: from Google's [Chrome for Testing](https://github.com/GoogleChromeLabs/chrome-for-testing), on Linux with glibc 2.35 or later from Remotion's own build, and on older Linux arm64 from Playwright's Chromium build |
| [Lucide](https://lucide.dev) icons (`lucide-static` 1.50.0) | ISC; the icons drawn from Feather MIT, as its licence file lists them | npm registry tarball, SHA-256 checked; engine, on the first icon lookup |
| [Tabler Icons](https://tabler.io/icons) (`@tabler/icons` 3.48.0), outline style | MIT | npm registry tarball, SHA-256 checked; engine, on the first icon lookup |
| [Simple Icons](https://simpleicons.org) (`simple-icons` 16.33.0) | CC0-1.0, except the logos its data gives another licence (see [notes](#icons-and-logos)) | npm registry tarball, SHA-256 checked; engine, on the first logo lookup |
| [Kokoro-82M-v1.1-zh](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh) weights and voices | Apache-2.0 | Hugging Face, pinned revision; benchmark `synth` extra only |

### Python packages, installed by uv (direct dependencies)

Models that come inside a package: the TransNetV2 weights in transnetv2-pytorch, Silero VAD's in silero-vad, OpenCC's dictionaries and spaCy's `en_core_web_sm`.

| Package | Licence | Used by |
|---|---|---|
| [anthropic](https://github.com/anthropics/anthropic-sdk-python) | MIT | worker |
| [av](https://github.com/PyAV-Org/PyAV) (PyAV) | BSD-3-Clause; its wheels bundle FFmpeg linked with x264 and x265 (GPL-2.0-or-later) | worker |
| [numpy](https://numpy.org) | BSD-3-Clause and bundled permissive licences | worker, benchmark |
| [opencc](https://github.com/BYVoid/OpenCC) | Apache-2.0 | worker, benchmark `synth` |
| [pydantic](https://github.com/pydantic/pydantic) | MIT | worker |
| [scipy](https://scipy.org) | BSD-3-Clause | worker |
| [beat-this](https://github.com/CPJKU/beat_this) | MIT | worker `ml` |
| [huggingface-hub](https://github.com/huggingface/huggingface_hub) | Apache-2.0 | worker `ml`, benchmark `synth` |
| [onnxruntime](https://github.com/microsoft/onnxruntime) | MIT | worker `ml` |
| [opencv-python-headless](https://github.com/opencv/opencv-python) | Apache-2.0; its wheels bundle FFmpeg under LGPL-2.1-or-later | worker `ml` |
| [silero-vad](https://github.com/snakers4/silero-vad) | MIT | worker `ml` |
| [torch](https://github.com/pytorch/pytorch) | BSD-3-Clause and bundled permissive licences | worker `ml`, benchmark `synth` |
| [transformers](https://github.com/huggingface/transformers) | Apache-2.0 | worker `ml` |
| [transnetv2-pytorch](https://github.com/allenday/transnetv2_pytorch) | MIT | worker `ml` |
| [imageio-ffmpeg](https://github.com/imageio/imageio-ffmpeg) | BSD-2-Clause; its wheels bundle imageio-binaries' FFmpeg builds (see [notes](#ffmpeg)) | benchmark; worker tests |
| [rapidfuzz](https://github.com/rapidfuzz/RapidFuzz) | MIT | benchmark |
| [kokoro](https://github.com/hexgrad/kokoro) and [misaki](https://github.com/hexgrad/misaki) | Apache-2.0 | benchmark `synth` |
| [jieba](https://github.com/fxsjy/jieba) | MIT | benchmark `synth` |
| [pillow](https://github.com/python-pillow/Pillow) | MIT-CMU | benchmark `synth` |
| [en_core_web_sm](https://github.com/explosion/spacy-models) | MIT | benchmark `synth` |
| [datamodel-code-generator](https://github.com/koxudaxi/datamodel-code-generator), [pytest](https://github.com/pytest-dev/pytest), [ruff](https://github.com/astral-sh/ruff) | MIT | development |

### npm packages, installed by pnpm (direct dependencies)

| Package | Licence | Used by |
|---|---|---|
| [@anthropic-ai/sdk](https://github.com/anthropics/anthropic-sdk-typescript) | MIT | engine, web page |
| [remotion](https://www.remotion.dev), @remotion/bundler, @remotion/renderer | [Remotion License](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md), source-available (see [notes](#remotion)) | effects; @remotion/renderer also engine, to download Chrome for web capture |
| [react](https://react.dev), react-dom | MIT | effects, web page |
| [ajv](https://github.com/ajv-validator/ajv) | MIT | schema, effects |
| [@fontsource/noto-sans-tc](https://fontsource.org/fonts/noto-sans-tc) | OFL-1.1 | effects, web page |
| [@fontsource/jetbrains-mono](https://fontsource.org/fonts/jetbrains-mono) | OFL-1.1 | effects, the cards' terminal and code |
| [@fontsource-variable/inter](https://fontsource.org/fonts/inter) | OFL-1.1 | web page |
| [next](https://nextjs.org) | MIT | web page |
| [typescript](https://www.typescriptlang.org) | Apache-2.0 | development |
| [@biomejs/biome](https://biomejs.dev) | MIT OR Apache-2.0 | development |
| [knip](https://knip.dev) | ISC | development |
| [json-schema-to-typescript](https://github.com/bcherny/json-schema-to-typescript), @types/node, @types/react, @types/react-dom | MIT | development |
| [electron](https://www.electronjs.org) | MIT; the Chromium and Node.js it is built from keep their licences, listed in `LICENSES.chromium.html` inside the app | desktop app, in its installers |
| [electron-builder](https://www.electron.build) | MIT | desktop app, building the installers |
| [playwright-core](https://playwright.dev) | Apache-2.0 | engine, web capture; desktop app, its smoke test |

### Sound effects

In `packages/engine/assets/sfx/`, 22 short Ogg Vorbis files, 144 KB in all, each under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) as its pack's `License.txt` states. The files are as the packs ship them, sorted into folders by kind.

| Files | Source |
|---|---|
| `click/click_001`, `click_002`, `click_005`; `stop/back_002`, `back_004`; `tone/pluck_001`, `pluck_002` | [Interface Sounds](https://kenney.nl/assets/interface-sounds) 1.0 by Kenney |
| `click/click2` | [UI Audio](https://kenney.nl/assets/ui-audio) by Kenney |
| `tap/impactSoft_medium_000`, `_001`, `_002`, `impactWood_light_002`; `stop/impactGeneric_light_002` | [Impact Sounds](https://kenney.nl/assets/impact-sounds) 1.0 by Kenney |
| `paper/card-slide-1`, `card-slide-5`, `card-place-1` | [Casino Audio](https://kenney.nl/assets/casino-audio) by Kenney |
| `paper/bookFlip3` | [RPG Audio](https://kenney.nl/assets/rpg-audio) by Kenney |
| `whoosh/air-1` to `air-3`, `tone/warm-1`, `warm-2` | This project, drawn from noise and sine waves by [`scripts/sfx.ts`](packages/engine/scripts/sfx.ts); dedicated to the public domain under CC0 1.0 |

### Icons, copied into the source

The effect cards draw icons and brand logos from `packages/effects/src/icons.ts`, which holds only the icons they can name, copied from these sets.

| Component | Licence | Used by |
|---|---|---|
| [Lucide](https://lucide.dev) 1.50.0 (`lucide-static`) | ISC; the icons Lucide derived from [Feather](https://github.com/feathericons/feather) also MIT (both texts [below](#lucide)) | effects, the cards' icons |
| [Simple Icons](https://simpleicons.org) 16.33.0 | CC0-1.0 | effects, the cards' brand logos |

Each brand logo is its owner's trademark ([notes](#icons-and-logos)): a card shows a brand's logo only where the video names that brand. The logos Simple Icons' data gives a licence of their own are left out.

## Notes

### Remotion

Remotion is source-available, not open source. Its licence is free for individuals, for-profit organisations with up to three employees, non-profits, and evaluation before any commercial use; any other organisation that renders with it needs a [Remotion company licence](https://www.remotion.pro/license). The effect templates render with Remotion, so this applies to whoever runs the editor, not to people who only watch its output. The licence also forbids selling or sublicensing a derivative of Remotion itself.

### FFmpeg

The renderer runs FFmpeg as a separate program and needs libx264, which is GPL; the builds it downloads are therefore GPL builds, and the [Remotion compositor](https://www.remotion.dev/docs/miscellaneous/ffmpeg-license) and the PyAV wheels carry GPL-licensed FFmpeg code as well. The project's own code stays MIT: it only runs FFmpeg, which is downloaded or installed separately.

The Windows build is gyan.dev's 7.1 essentials build, which imageio-binaries republishes; it is configured with `--enable-gpl --enable-version3` and nothing nonfree, so the binary is GPL-3.0-or-later and may be redistributed.

Anyone who redistributes these builds, for example in a desktop app or a container image, must meet the GPL, including offering the corresponding source, which imageio-binaries publishes none of beside its builds. The alternative is an LGPL build of FFmpeg, which means encoding H.264 without libx264.

### Copyleft dependencies

- **soxr** (LGPL-2.1-or-later) comes with beat-this in the worker's `ml` extra.
- The benchmark's `synth` extra installs **phonemizer-fork** (GPL-3.0-or-later), **espeakng-loader**, whose wheel bundles espeak-ng (GPL-3.0), and **num2words** (LGPL-2.1), through kokoro's English support. The corpus generator never calls them.
- **sharp**'s libvips (LGPL-3.0-or-later) is installed as an optional dependency of Next.js; the web page does not use it, and the desktop app's installers leave it out.
- **mediabunny** (MPL-2.0), which Remotion depends on, is in the desktop app's installers as its published source, unchanged.

### Desktop installers

Each of the [desktop app](apps/desktop/README.md)'s installers carries:

- **Electron** (MIT), with the Chromium and Node.js it is built from; their licences are in `LICENSES.chromium.html` and `LICENSE.electron.txt` inside the app.
- **[uv](https://github.com/astral-sh/uv)** (MIT OR Apache-2.0), pinned by version and SHA-256, which installs the analysis's Python on the first start.
- **The editor's code and the npm packages it runs**, the production dependencies listed above and theirs, as pnpm installs them, under their own licences: almost all MIT, ISC, Apache-2.0 or BSD; Remotion under the [Remotion License](#remotion); mediabunny under MPL-2.0; caniuse-lite's data under CC-BY-4.0.

Left out on purpose, and downloaded on first use instead, from their publishers, as when the editor runs from a clone:

- **FFmpeg.** The renderer's pinned build downloads on the first edit, as [above](#ffmpeg).
- **Remotion's compositor**, whose FFmpeg is built with `--enable-gpl` and with libfdk-aac, a combination the GPL does not allow to be passed on. It downloads from npm on the first effect render, checked against the integrity in `pnpm-lock.yaml`.
- **The analysis's Python**, its packages (PyAV's GPL FFmpeg among them) and the models, which uv and vework download into the user's folders.
- **sharp** and its libvips, which the page does not use.

The installers are not signed with an Apple Developer ID or a Windows code-signing certificate yet; the macOS app is signed ad hoc, which Apple silicon requires to run it.

### Icons and logos

Simple Icons' logos are brands' trademarks, which its CC0 dedication does not cover: an edit may show a logo to refer to its brand, as the brand's guidelines allow, and not to suggest that the brand endorses the video. A few logos carry their own licence in Simple Icons' data; the lookup reports it, and each logo's credit carries the trademark note. Tabler's `brand-*` icons are logos too.

### B-roll from the web

Stock footage comes from [Pexels](https://www.pexels.com/license/) and [Pixabay](https://pixabay.com/service/license-summary/) under their own licences, through each one's API with the user's own key; each clip's credit names its creator and links to its page. A web capture shows someone else's page, whose owner keeps every right in it; its credit names the page.

### CED-Base

The ONNX export's model card states Apache-2.0. The same weights are published on Zenodo under CC-BY-4.0, and the CED training code is GPL-3.0. The project uses the Hugging Face export under its stated licence.

### Training data

A model's licence covers its weights, not the data it was trained on. Some of that data has its own terms: YuNet was trained on WIDER FACE (CC BY-NC-ND), CED on AudioSet's YouTube clips, and Beat This! notes that some of its training audio is copyrighted.

## README example

The example edits at the top of the README are made from footage the project does not own. Their frames and videos are assets of the [v0.2.0 release](https://github.com/zcxy-dev/video-editor/releases/tag/v0.2.0), not files in this repository, and are shared under the footage's licence.

- **Footage:** "[Why NASA and IBM made a new AI model that predicts the Sun's damaging flares](https://www.youtube.com/watch?v=KWMoF97C1Ds)" by IBM Research, published 20 August 2025, with Mike Murphy and Johannes Schmude of IBM Research, licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). The edits shorten it to 60 s at 9:16 and 90 s at 16:9, reframe and grade it, process its sound and add music, captions, name cards and keyword highlights. Neither IBM Research nor the people in it endorse this project.
- **Music:** in the 9:16 edit, "3 am West End" by statusq, dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) ([source](https://commons.wikimedia.org/wiki/File:Statusq_-_3_am_West_End.opus)); in the 16:9 edit, "Cool Vibes" by Kevin MacLeod ([incompetech.com](https://incompetech.com)), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Adapted code

Code adapted from these projects keeps their copyright and licence below, with the files it is in.

### Beat This!

- `worker/src/vework/beats.py`

```text
MIT License

Copyright (c) 2024 Institute of Computational Perception, JKU Linz, Austria

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### BridgeClip

- `packages/engine/src/captions/ass.ts`
- `packages/engine/src/captions/place.ts`
- `packages/engine/src/framing.ts`
- `packages/engine/src/graph/master.ts`
- `packages/engine/src/plan/prompt.ts`
- `worker/src/vework/framing.py`

```text
MIT License

Copyright (c) 2026 BridgeMind LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### DeepFilterNet

- `worker/src/vework/denoise.py`

```text
The MIT License (MIT)
Copyright (c) 2021 Hendrik Schröter

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### libebur128

- `worker/src/vework/loudness.py`

```text
Copyright (c) 2011 Jan Kokemüller

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### Herk Edit Kit

The effect cards rebuild in Remotion the layouts and motion of cards from the [Herk Edit Kit](https://github.com/nateherkai/hyperframes-student-kit) (HTML, CSS and GSAP); none of its code, fonts or brand assets is copied. The planner's visuals follow its editing playbook's B-roll order, split-screen proportions, time away from the speaker and sound-effect rules.

- `packages/effects/src/cards.ts`
- `packages/effects/src/remotion/cards/`
- `packages/effects/src/layout.ts` (`panelShare`)
- `packages/engine/src/plan/visuals.ts`

```text
MIT License

Copyright (c) 2026 Nate Herk

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Lucide

- `packages/effects/src/icons.ts`

```text
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### OpenCut

- `packages/schema/src/time.ts`

```text
Copyright 2025-2026 OpenCut

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

### video-use

- `packages/engine/src/grade.ts`
- `packages/engine/src/graph/video.ts`
- `packages/engine/src/plan/pack.ts`
- `packages/engine/src/plan/strip.ts`

```text
MIT License

Copyright (c) 2026 Browser Use

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
