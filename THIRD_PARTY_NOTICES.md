# Third-party notices

The project's own code is under the [MIT License](LICENSE). It uses the components below, each under its own licence. Nothing in this repository bundles a model weight, a font or a binary: the tools download them on first use, from their publishers or, for the Intel macOS FFmpeg, from a release of this repository, or the package managers install them. The desktop app's installers do carry programs: Electron, uv and the npm packages the editor runs, but no FFmpeg, model or Python package ([what they carry](#desktop-installers)). Licences were checked against each component's own licence file or model card at the version or revision the project pins.

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
| [FFmpeg](https://ffmpeg.org) static builds: from [imageio-binaries](https://github.com/imageio/imageio-binaries), 7.0.2 on Linux, 7.1 on Apple silicon and on Windows ([gyan.dev](https://www.gyan.dev/ffmpeg/builds/)'s essentials build); on Intel macOS, 7.1.5 built by this project | GPL-3.0-or-later (Linux, Windows), GPL-2.0-or-later (macOS) | GitHub, pinned commit or this repository's release, and SHA-256; renderer, run as a separate program (see [notes](#ffmpeg)) |
| Remotion's compositor (`@remotion/compositor-*`), with its own FFmpeg | [Remotion License](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md); its FFmpeg is configured with `--enable-gpl`, libx264, libx265 and libfdk-aac | Installed with @remotion/renderer by pnpm; for the desktop app, downloaded from npm on the first effect render, checked against `pnpm-lock.yaml` (see [notes](#desktop-installers)) |
| [CPython](https://www.python.org) builds from [python-build-standalone](https://github.com/astral-sh/python-build-standalone) | PSF-2.0, with the licences of the libraries each build includes | Desktop app only: installed by uv into the app's folder on its first start |
| Chrome Headless Shell ([Chromium](https://www.chromium.org)) | Chromium's BSD-3-Clause licence and the third-party licences it lists; Google's build also refers to the Chrome terms of service | Downloaded by Remotion on the first effect render: from Google's [Chrome for Testing](https://github.com/GoogleChromeLabs/chrome-for-testing), on Linux with glibc 2.35 or later from Remotion's own build, and on older Linux arm64 from Playwright's Chromium build |
| [Kokoro-82M-v1.1-zh](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh) weights and voices | Apache-2.0 | Hugging Face, pinned revision; benchmark `synth` extra only |

### Python packages, installed by uv (direct dependencies)

Models that come inside a package: the TransNetV2 weights in transnetv2-pytorch, Silero VAD's in silero-vad, nagisa's tagger, OpenCC's dictionaries and spaCy's `en_core_web_sm`.

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
| [nagisa](https://github.com/taishi-i/nagisa) | MIT | worker `ml`, Japanese alignment |
| [onnxruntime](https://github.com/microsoft/onnxruntime) | MIT | worker `ml` |
| [opencv-python-headless](https://github.com/opencv/opencv-python) | Apache-2.0; its wheels bundle FFmpeg under LGPL-2.1-or-later | worker `ml` |
| [silero-vad](https://github.com/snakers4/silero-vad) | MIT | worker `ml` |
| [soynlp](https://github.com/lovit/soynlp) | GPL-3.0 on PyPI, LGPL-3.0 in its repository (see [notes](#copyleft-dependencies)) | worker `ml`, Korean alignment |
| [torch](https://github.com/pytorch/pytorch) | BSD-3-Clause and bundled permissive licences | worker `ml`, benchmark `synth` |
| [transformers](https://github.com/huggingface/transformers) | Apache-2.0 | worker `ml` |
| [transnetv2-pytorch](https://github.com/allenday/transnetv2_pytorch) | MIT | worker `ml` |
| [imageio-ffmpeg](https://github.com/imageio/imageio-ffmpeg) | BSD-2-Clause; its wheels bundle imageio-binaries' FFmpeg builds, on Intel macOS a nonfree one (see [notes](#ffmpeg)) | benchmark; worker tests |
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
| [remotion](https://www.remotion.dev), @remotion/bundler, @remotion/renderer | [Remotion License](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md), source-available (see [notes](#remotion)) | effects |
| [react](https://react.dev), react-dom | MIT | effects, web page |
| [ajv](https://github.com/ajv-validator/ajv) | MIT | schema, effects |
| [@fontsource/noto-sans-tc](https://fontsource.org/fonts/noto-sans-tc) | OFL-1.1 | effects, web page |
| [@fontsource-variable/inter](https://fontsource.org/fonts/inter) | OFL-1.1 | web page |
| [next](https://nextjs.org) | MIT | web page |
| [typescript](https://www.typescriptlang.org) | Apache-2.0 | development |
| [@biomejs/biome](https://biomejs.dev) | MIT OR Apache-2.0 | development |
| [json-schema-to-typescript](https://github.com/bcherny/json-schema-to-typescript), @types/node, @types/react, @types/react-dom | MIT | development |
| [electron](https://www.electronjs.org) | MIT; the Chromium and Node.js it is built from keep their licences, listed in `LICENSES.chromium.html` inside the app | desktop app, in its installers |
| [electron-builder](https://www.electron.build) | MIT | desktop app, building the installers |
| [playwright-core](https://playwright.dev) | Apache-2.0 | desktop app, its smoke test |

## Notes

### Remotion

Remotion is source-available, not open source. Its licence is free for individuals, for-profit organisations with up to three employees, non-profits, and evaluation before any commercial use; any other organisation that renders with it needs a [Remotion company licence](https://www.remotion.pro/license). The effect templates render with Remotion, so this applies to whoever runs the editor, not to people who only watch its output. The licence also forbids selling or sublicensing a derivative of Remotion itself.

### FFmpeg

The renderer runs FFmpeg as a separate program and needs libx264, which is GPL; the builds it downloads are therefore GPL builds, and the [Remotion compositor](https://www.remotion.dev/docs/miscellaneous/ffmpeg-license) and the PyAV wheels carry GPL-licensed FFmpeg code as well. The project's own code stays MIT: it only runs FFmpeg, which is downloaded or installed separately.

The Windows build is gyan.dev's 7.1 essentials build, which imageio-binaries republishes; it is configured with `--enable-gpl --enable-version3` and nothing nonfree, so the binary is GPL-3.0-or-later and may be redistributed.

The Intel macOS build is the project's own, because imageio-binaries' (`ffmpeg-macos-x86_64-v7.1`) is configured with `--enable-nonfree` and declares itself not redistributable. [build-ffmpeg-macos-x64.sh](packages/engine/scripts/build-ffmpeg-macos-x64.sh) builds FFmpeg 7.1.5 statically with x264, libvpx, zimg, Opus, libass, FreeType, FriBidi and HarfBuzz, each pinned by SHA-256 or commit, and nothing nonfree, so the binary is GPL-2.0-or-later. A [workflow](.github/workflows/ffmpeg-macos-x64.yml) runs it on GitHub's Intel macOS runner and publishes the binary as a release, with `sources.tar.gz`: every source it was built from and the script. imageio-ffmpeg, which the benchmark and the worker's tests run, still installs imageio-binaries' nonfree build on Intel Macs; nothing ships it.

Anyone who redistributes these builds, for example in a desktop app or a container image, must meet the GPL, including offering the corresponding source: for the Intel macOS build that is its release's `sources.tar.gz`, while imageio-binaries publishes none beside its builds. The alternative is an LGPL build of FFmpeg, which means encoding H.264 without libx264.

### Copyleft dependencies

- **soynlp**, installed with the worker's `ml` extra for the forced aligner's Korean word splitting, is marked GPL-3.0 on PyPI while its repository's licence file is LGPL-3.0.
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

### CED-Base

The ONNX export's model card states Apache-2.0. The same weights are published on Zenodo under CC-BY-4.0, and the CED training code is GPL-3.0. The project uses the Hugging Face export under its stated licence.

### Training data

A model's licence covers its weights, not the data it was trained on. Some of that data has its own terms: YuNet was trained on WIDER FACE (CC BY-NC-ND), CED on AudioSet's YouTube clips, and Beat This! notes that some of its training audio is copyrighted.

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
