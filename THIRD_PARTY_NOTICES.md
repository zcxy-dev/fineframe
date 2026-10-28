# Third-party notices

The project's own code is proprietary, all rights reserved ([LICENSE](LICENSE)). It uses the components below, each under its own licence. Nothing in this repository bundles a model weight, a font or a binary, and its only third-party media are [a few CC0 sound effects](#sound-effects), [a subset of icons and logos](#icons-copied-into-the-source) and the [music library's](#music-library) tags and analysis, without its audio, besides the website's footage loops, in [its own notices](apps/site/THIRD_PARTY_NOTICES.md) with its packages: the tools download the rest on first use, from their publishers, or the package managers install them. The desktop app's installers do carry programs: Electron, uv and the npm packages the editor runs, but no FFmpeg, model or Python package ([what they carry](#desktop-installers)). Licences were checked against each component's own licence file or model card at the version or revision the project pins.

## Components

### Models and data, downloaded on first use

| Component | Licence | How it reaches you |
|---|---|---|
| [Qwen3-ASR-0.6B-hf, Qwen3-ASR-1.7B-hf](https://huggingface.co/Qwen/Qwen3-ASR-0.6B-hf) and [Qwen3-ForcedAligner-0.6B-hf](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B-hf) | Apache-2.0 | Hugging Face, pinned revision; worker `ml` group |
| [CED-Base](https://huggingface.co/mispeech/ced-base), ONNX export | Apache-2.0 on its model card (see [notes](#ced-base)) | Hugging Face, pinned revision; worker `ml` group |
| [YuNet](https://huggingface.co/opencv/face_detection_yunet) (`face_detection_yunet_2023mar.onnx`) | MIT | Hugging Face, pinned revision and SHA-256; worker `ml` group |
| [Beat This!](https://github.com/CPJKU/beat_this) `final0` checkpoint | MIT | JKU Linz's file server, or its copy on `downloads.fineframe.app`, SHA-256 checked; worker `ml` group |
| [DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet) ONNX export | MIT OR Apache-2.0 | GitHub, pinned commit and SHA-256; worker `ml` group |
| [Noto Sans CJK TC](https://github.com/notofonts/noto-cjk) Bold and Black | OFL-1.1 | GitHub, pinned commit and SHA-256; renderer, for captions |
| [Noto Color Emoji](https://github.com/googlefonts/noto-emoji) | OFL-1.1 | GitHub, pinned commit and SHA-256; renderer, for caption emoji |
| [Noto Serif CJK TC](https://github.com/notofonts/noto-cjk) Bold | OFL-1.1 | GitHub, pinned commit and SHA-256; renderer and the Brand kit page, for a kit that names it |
| [LXGW WenKai TC](https://github.com/lxgw/LxgwWenkaiTC) Bold | OFL-1.1 | [google/fonts](https://github.com/google/fonts), pinned commit and SHA-256; renderer and the Brand kit page, for a kit that names it |
| [jf open huninn](https://github.com/justfont/open-huninn-font) 2.1 (jf open 粉圓) | OFL-1.1; its Hanzi derive from Kosugi Maru under Apache-2.0, as its licence file says | GitHub, pinned commit and SHA-256; renderer and the Brand kit page, for a kit that names it |
| [Iansui](https://github.com/ButTaiwan/iansui) | OFL-1.1 | google/fonts, pinned commit and SHA-256; renderer and the Brand kit page, for a kit that names it |
| [Chocolate Classical Sans](https://github.com/MoonlitOwen/ChocolateSans) | OFL-1.1 | google/fonts, pinned commit and SHA-256; renderer and the Brand kit page, for a kit that names it |
| [Cactus Classical Serif](https://github.com/MoonlitOwen/CactusSerif) | OFL-1.1 | google/fonts, pinned commit and SHA-256; renderer and the Brand kit page, for a kit that names it |
| [LXGW Marker Gothic](https://github.com/lxgw/LxgwMarkerGothic) | OFL-1.1 | google/fonts, pinned commit and SHA-256; renderer and the Brand kit page, for a kit that names it |
| [FFmpeg](https://ffmpeg.org) static builds: from [imageio-binaries](https://github.com/imageio/imageio-binaries), 7.0.2 on Linux, 7.1 on Apple silicon and on Windows ([gyan.dev](https://www.gyan.dev/ffmpeg/builds/)'s essentials build) | GPL-3.0-or-later (Linux, Windows), GPL-2.0-or-later (macOS) | GitHub, pinned commit and SHA-256; renderer, run as a separate program (see [notes](#ffmpeg)) |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) standalone builds (`yt-dlp_linux`, `yt-dlp_linux_aarch64`, `yt-dlp_macos`, `yt-dlp.exe`, `yt-dlp_arm64.exe`) | Unlicense; each build also carries Python and the libraries its [THIRD_PARTY_LICENSES.txt](https://github.com/yt-dlp/yt-dlp/blob/master/THIRD_PARTY_LICENSES.txt) lists, under their own licences | GitHub, the latest release, checked against that release's SHA2-256SUMS and updated before each link import; engine, on the first link imported, run as a separate program |
| ffprobe static builds from [@ffprobe-installer](https://github.com/SavageCore/node-ffprobe-installer)'s npm packages: 5.2.0 on Linux, 5.0.1 on Apple silicon, 5.1.0 on Windows | GPL-3.0 (Linux, Windows), LGPL-2.1 (macOS), as each package states | npm registry tarball, SHA-256 checked; renderer, on the first effect render, run as a separate program by HyperFrames (see [notes](#ffmpeg)) |
| [CPython](https://www.python.org) builds from [python-build-standalone](https://github.com/astral-sh/python-build-standalone) | PSF-2.0, with the licences of the libraries each build includes | Desktop app only: installed by uv into the app's folder on its first start |
| Chrome Headless Shell ([Chromium](https://www.chromium.org)) | Chromium's BSD-3-Clause licence and the third-party licences it lists; Google's build also refers to the Chrome terms of service | Google's [Chrome for Testing](https://github.com/GoogleChromeLabs/chrome-for-testing), pinned build, its archive SHA-256 checked per platform, through @puppeteer/browsers; renderer, on the first effect render or web capture. There is no build for Linux on arm64 |
| [Music library](#music-library), 40 tracks | CC0 1.0 | `downloads.fineframe.app`, SHA-256 checked; engine, each track when an edit plays it or the page previews it |
| [Lucide](https://lucide.dev) icons (`lucide-static` 1.50.0) | ISC; the icons drawn from Feather MIT, as its licence file lists them | npm registry tarball, SHA-256 checked; engine, on the first icon lookup |
| [Tabler Icons](https://tabler.io/icons) (`@tabler/icons` 3.48.0), outline style | MIT | npm registry tarball, SHA-256 checked; engine, on the first icon lookup |
| [Simple Icons](https://simpleicons.org) (`simple-icons` 16.33.0) | CC0-1.0, except the logos its data gives another licence (see [notes](#icons-and-logos)) | npm registry tarball, SHA-256 checked; engine, on the first logo lookup |
| [ASCEND](https://huggingface.co/datasets/CAiRE/ASCEND) test split, 200 utterances and their transcripts | CC BY-SA 4.0 (see [notes](#ascend)) | Hugging Face's dataset viewer, pinned revision and SHA-256 per utterance; `vebench ascend` only, written into the git-ignored corpus folder |
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
| [@hyperframes/producer](https://github.com/heygen-com/hyperframes) | Apache-2.0 | effects, rendering the effects and graphics |
| [puppeteer-core](https://pptr.dev) | Apache-2.0 | effects, checking the graphics |
| [htmlparser2](https://github.com/fb55/htmlparser2) | MIT | effects, reading the graphics' markup |
| [PostCSS](https://postcss.org) | MIT | effects, reading the graphics' styles; web page, building its styles |
| [@puppeteer/browsers](https://pptr.dev/browsers-api) | Apache-2.0 | engine, downloading Chrome Headless Shell |
| [react](https://react.dev), react-dom | MIT | web page |
| [ajv](https://github.com/ajv-validator/ajv) | MIT | schema, effects |
| [@fontsource/noto-sans-tc](https://fontsource.org/fonts/noto-sans-tc) | OFL-1.1 | effects, web page |
| [@fontsource-variable/inter](https://fontsource.org/fonts/inter) | OFL-1.1 | effects, web page (the brand kit's sample frame) |
| [@fontsource-variable/geist](https://fontsource.org/fonts/geist) ([Geist](https://github.com/vercel/geist-font)) | OFL-1.1 | web page, its text |
| [radix-ui](https://www.radix-ui.com) | MIT | web page: the dialogs, tabs and language menu |
| [motion](https://motion.dev) | MIT | web page, its animation |
| [lucide-react](https://lucide.dev) | ISC; the icons Lucide derived from Feather also MIT | web page, its icons |
| [class-variance-authority](https://cva.style) | Apache-2.0 | web page, the button's variants |
| [cn](https://github.com/shadcn-ui/cn) | MIT | web page, merging class names |
| [tailwindcss](https://tailwindcss.com), @tailwindcss/postcss | MIT | web page, building its styles |
| [tw-animate-css](https://github.com/Wombosvideo/tw-animate-css) | MIT | web page, the components' enter and exit animations |
| [next](https://nextjs.org) | MIT | web page |
| [typescript](https://www.typescriptlang.org) | Apache-2.0 | development |
| [@biomejs/biome](https://biomejs.dev) | MIT OR Apache-2.0 | development |
| [knip](https://knip.dev) | ISC | development |
| [json-schema-to-typescript](https://github.com/bcherny/json-schema-to-typescript), @types/node, @types/react, @types/react-dom | MIT | development |
| [electron](https://www.electronjs.org) | MIT; the Chromium and Node.js it is built from keep their licences, listed in `LICENSES.chromium.html` inside the app | desktop app, in its installers |
| [electron-builder](https://www.electron.build) | MIT | desktop app, building the installers |
| [electron-updater](https://www.electron.build/auto-update) | MIT | desktop app, its updates |
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

`packages/effects/src/icons.ts` holds a subset of icons and brand logos, copied from these sets, for the motion graphics.

| Component | Licence | Used by |
|---|---|---|
| [Lucide](https://lucide.dev) 1.50.0 (`lucide-static`) | ISC; the icons Lucide derived from [Feather](https://github.com/feathericons/feather) also MIT (both texts [below](#lucide)) | effects, icons |
| [Simple Icons](https://simpleicons.org) 16.33.0 | CC0-1.0 | effects, brand logos |

Each brand logo is its owner's trademark ([notes](#icons-and-logos)): a graphic shows a brand's logo only where the video names that brand. The logos Simple Icons' data gives a licence of their own are left out.

### Components, copied into the web page

`apps/web/components/ui/` holds components copied from these projects and changed for the page:

- from [shadcn/ui](https://ui.shadcn.com) (MIT, Copyright (c) 2023 shadcn): `button`, `input` (with its textarea and native select), `tabs`, `dialog`, `dropdown-menu`;
- from [Magic UI](https://magicui.design) (MIT, Copyright (c) Magic UI): `number-ticker`.

## Notes

### FFmpeg

The renderer runs FFmpeg as a separate program and needs libx264, which is GPL; the builds it downloads are therefore GPL builds; the ffprobe builds HyperFrames runs are GPL or LGPL builds, and the PyAV wheels carry GPL-licensed FFmpeg code as well. The project's own code stays proprietary, all rights reserved: it only runs FFmpeg and ffprobe, which are downloaded or installed separately.

The Windows build is gyan.dev's 7.1 essentials build, which imageio-binaries republishes; it is configured with `--enable-gpl --enable-version3` and nothing nonfree, so the binary is GPL-3.0-or-later and may be redistributed.

Anyone who redistributes these builds, for example in a desktop app or a container image, must meet the GPL, including offering the corresponding source, which imageio-binaries publishes none of beside its builds. The alternative is an LGPL build of FFmpeg, which means encoding H.264 without libx264.

### Copyleft dependencies

- **soxr** (LGPL-2.1-or-later) comes with beat-this in the worker's `ml` group.
- The benchmark's `synth` extra installs **phonemizer-fork** (GPL-3.0-or-later), **espeakng-loader**, whose wheel bundles espeak-ng (GPL-3.0), and **num2words** (LGPL-2.1), through kokoro's English support. The corpus generator never calls them.
- **sharp**'s libvips (LGPL-3.0-or-later) is installed as an optional dependency of Next.js and as a dependency of HyperFrames' preview server; neither the web page nor a render uses it, and the desktop app's installers leave it out.

### Desktop installers

Each of the [desktop app](apps/desktop/README.md)'s installers carries:

- **Electron** (MIT), with the Chromium and Node.js it is built from; their licences are in `LICENSES.chromium.html` and `LICENSE.electron.txt` inside the app.
- **[uv](https://github.com/astral-sh/uv)** (MIT OR Apache-2.0), pinned by version and SHA-256, which installs the analysis's Python on the first start.
- **The editor's code and the npm packages it runs**, the production dependencies listed above and theirs, as pnpm installs them, and the web page's own (radix-ui, motion, lucide-react, class-variance-authority, cn and Geist), compiled into the built page, under their own licences: almost all MIT, ISC, Apache-2.0 or BSD; caniuse-lite's data under CC-BY-4.0.

Left out on purpose, and downloaded on first use instead, from their publishers, as when the editor runs from a clone:

- **FFmpeg.** The renderer's pinned build downloads on the first edit, as [above](#ffmpeg).
- **The music library's audio**, each track when an edit plays it or the page previews it, as [above](#models-and-data-downloaded-on-first-use).
- **ffprobe and Chrome Headless Shell**, which download on the first effect render, as [above](#models-and-data-downloaded-on-first-use).
- **The analysis's Python**, its packages (PyAV's GPL FFmpeg among them) and the models, which uv and vework download into the user's folders.
- **sharp** and its libvips, which neither the page nor a render uses.

The installers are not signed with an Apple Developer ID or a Windows code-signing certificate yet; the macOS app is signed ad hoc, which Apple silicon requires to run it.

### Music library

The built-in music library's 40 tracks, each dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) by its author on [FreePD](https://freepd.com), whose site said: "This music is all licensed CC0 1.0 Universal Public Domain Dedication" ([archived](https://web.archive.org/web/20251207054520/https://freepd.com/)). FreePD closed in 2025; each file is byte for byte the one freepd.com served, from the Internet Archive's capture below, and is published unchanged on `downloads.fineframe.app`. `packages/engine/assets/music/` holds each track's tags and its music index, not its audio.

| Title | Author | Mood | Source |
|---|---|---|---|
| Connecting Rainbows | Kevin MacLeod | calm | [capture](https://web.archive.org/web/20251124004140/https://freepd.com/music/Connecting%20Rainbows.mp3) |
| Energizing | Kevin MacLeod | calm | [capture](https://web.archive.org/web/20251122233525/https://freepd.com/music/Energizing.mp3) |
| Infinite Wonder | Kevin MacLeod | calm | [capture](https://web.archive.org/web/20251006151845/https://freepd.com/music/Infinite%20Wonder.mp3) |
| Meditating Beat | Kevin MacLeod | calm | [capture](https://web.archive.org/web/20251202215358/https://freepd.com/music/Meditating%20Beat.mp3) |
| Night in Venice | Kevin MacLeod | calm | [capture](https://web.archive.org/web/20251118154443/https://freepd.com/music/Night%20in%20Venice.mp3) |
| Pond | Rafael Krux | calm | [capture](https://web.archive.org/web/20250911140703/https://freepd.com/music/Pond.mp3) |
| Soundtrack From the Starcourt Mall | Bryan Teoh | calm | [capture](https://web.archive.org/web/20251006152053/https://freepd.com/music/Soundtrack%20From%20the%20Starcourt%20Mall.mp3) |
| Study and Relax | Kevin MacLeod | calm | [capture](https://web.archive.org/web/20251122233540/https://freepd.com/music/Study%20and%20Relax.mp3) |
| And Just Like That | Bryan Teoh | upbeat | [capture](https://web.archive.org/web/20251118002951/https://freepd.com/music/And%20Just%20Like%20That.mp3) |
| Funkeriffic | Kevin MacLeod | upbeat | [capture](https://web.archive.org/web/20251122233423/https://freepd.com/music/Funkeriffic.mp3) |
| Funky Energy Loop | Kevin MacLeod | upbeat | [capture](https://web.archive.org/web/20250723181812/https://freepd.com/music/Funky%20Energy%20Loop.mp3) |
| Funshine | Kevin MacLeod | upbeat | [capture](https://web.archive.org/web/20251118004331/https://freepd.com/music/Funshine.mp3) |
| Gotta Keep On Movin | Bryan Teoh | upbeat | [capture](https://web.archive.org/web/20251122233149/https://freepd.com/music/Gotta%20Keep%20On%20Movin.mp3) |
| Happy Whistling Ukulele | Rafael Krux | upbeat | [capture](https://web.archive.org/web/20251117234159/https://freepd.com/music/Happy%20Whistling%20Ukulele.mp3) |
| Hold on a Sec | Bryan Teoh | upbeat | [capture](https://web.archive.org/web/20251122233401/https://freepd.com/music/Hold%20on%20a%20Sec.mp3) |
| Ukulele Song | Rafael Krux | upbeat | [capture](https://web.archive.org/web/20251118171800/https://freepd.com/music/Ukulele%20Song.mp3) |
| Brothers Unite | Alexander Nakarada | emotional | [capture](https://web.archive.org/web/20240211063827/https://freepd.com/music/Brothers%20Unite.mp3) |
| Horizon Flare | Alexander Nakarada | emotional | [capture](https://web.archive.org/web/20241001151104/https://freepd.com/music/Horizon%20Flare.mp3) |
| Ice and Snow | Rafael Krux | emotional | [capture](https://web.archive.org/web/20251118020712/https://freepd.com/music/Ice%20and%20Snow.mp3) |
| Isolation Waltz | Bryan Teoh | emotional | [capture](https://web.archive.org/web/20251118154443/https://freepd.com/music/Isolation%20Waltz.mp3) |
| Nostalgic Piano | Rafael Krux | emotional | [capture](https://web.archive.org/web/20250911140713/https://freepd.com/music/Nostalgic%20Piano.mp3) |
| Relaxing Ballad | Alexander Nakarada | emotional | [capture](https://web.archive.org/web/20240211063246/https://freepd.com/music/Relaxing%20Ballad.mp3) |
| Romantic Inspiration | Rafael Krux | emotional | [capture](https://web.archive.org/web/20250911140707/https://freepd.com/music/Romantic%20Inspiration.mp3) |
| Shining Stars | Rafael Krux | emotional | [capture](https://web.archive.org/web/20251118154444/https://freepd.com/music/Shining%20Stars.mp3) |
| Adding the Sun | Kevin MacLeod | corporate | [capture](https://web.archive.org/web/20251107152247/https://freepd.com/music/Adding%20the%20Sun.mp3) |
| Advertime | Rafael Krux | corporate | [capture](https://web.archive.org/web/20251011155222/https://freepd.com/music/Advertime.mp3) |
| Arpent | Kevin MacLeod | corporate | [capture](https://web.archive.org/web/20251202215400/https://freepd.com/music/Arpent.mp3) |
| City Sunshine | Kevin MacLeod | corporate | [capture](https://web.archive.org/web/20251123132355/https://freepd.com/music/City%20Sunshine.mp3) |
| From Page to Practice | Bryan Teoh | corporate | [capture](https://web.archive.org/web/20251011155222/https://freepd.com/music/From%20Page%20to%20Practice.mp3) |
| Inspiration | Rafael Krux | corporate | [capture](https://web.archive.org/web/20251118195204/https://freepd.com/music/Inspiration.mp3) |
| Inventing Flight | Bryan Teoh | corporate | [capture](https://web.archive.org/web/20251121104137/https://freepd.com/music/Inventing%20Flight.mp3) |
| Motions | Rafael Krux | corporate | [capture](https://web.archive.org/web/20251119204459/https://freepd.com/music/Motions.mp3) |
| Be Chillin | Alexander Nakarada | energetic | [capture](https://web.archive.org/web/20240211063429/https://freepd.com/music/Be%20Chillin.mp3) |
| Chronos | Alexander Nakarada | energetic | [capture](https://web.archive.org/web/20240927005202/https://freepd.com/music/Chronos.mp3) |
| Favorite | Alexander Nakarada | energetic | [capture](https://web.archive.org/web/20240211063921/https://freepd.com/music/Favorite.mp3) |
| Fireworks | Alexander Nakarada | energetic | [capture](https://web.archive.org/web/20240211063930/https://freepd.com/music/Fireworks.mp3) |
| Goodnightmare | Kevin MacLeod | energetic | [capture](https://web.archive.org/web/20251202215403/https://freepd.com/music/Goodnightmare.mp3) |
| Heroic Adventure | Rafael Krux | energetic | [capture](https://web.archive.org/web/20251123161444/https://freepd.com/music/Heroic%20Adventure.mp3) |
| Hit n Smash | Rafael Krux | energetic | [capture](https://web.archive.org/web/20251123161443/https://freepd.com/music/Hit%20n%20Smash.mp3) |
| Kings Trailer | Rafael Krux | energetic | [capture](https://web.archive.org/web/20251123161509/https://freepd.com/music/Kings%20Trailer.mp3) |

### Icons and logos

Simple Icons' logos are brands' trademarks, which its CC0 dedication does not cover: an edit may show a logo to refer to its brand, as the brand's guidelines allow, and not to suggest that the brand endorses the video. A few logos carry their own licence in Simple Icons' data; the lookup reports it, and each logo's credit carries the trademark note. Tabler's `brand-*` icons are logos too.

### Wordmark

The wordmark (`brand/wordmark.svg`, `brand/wordmark-on-dark.svg`) sets "Fineframe" in [Archivo](https://github.com/Omnibus-Type/Archivo) SemiExpanded by Omnibus-Type, under the [SIL Open Font License 1.1](https://openfontlicense.org). Its letters are outlined into paths there. The web page sets the name beside the icon in Geist, as the website does.

### B-roll from the web

Stock footage comes from [Pexels](https://www.pexels.com/license/) and [Pixabay](https://pixabay.com/service/license-summary/) under their own licences, through each one's API with the user's own key; each clip's credit names its creator and links to its page. A web capture shows someone else's page, whose owner keeps every right in it; its credit names the page.

### CED-Base

The ONNX export's model card states Apache-2.0. The same weights are published on Zenodo under CC-BY-4.0, and the CED training code is GPL-3.0. The project uses the Hugging Face export under its stated licence.

### ASCEND

The benchmark's transcription corpus (`vebench ascend`) is built from ASCEND: "ASCEND: A Spontaneous Chinese-English Dataset for Code-switching in Multi-turn Conversation" by Holy Lovenia, Samuel Cahyawijaya, Genta Indra Winata, Peng Xu, Xu Yan, Zihan Liu, Rita Frieske, Tiezheng Yu, Wenliang Dai, Elham J. Barezi, Qifeng Chen, Xiaojuan Ma, Bertram E. Shi and Pascale Fung (LREC 2022, [arXiv:2112.06223](https://arxiv.org/abs/2112.06223)), published by CAiRE on [Hugging Face](https://huggingface.co/datasets/CAiRE/ASCEND) under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). `vebench ascend` joins a sample of its test utterances into clips and converts their transcripts to Taiwan Traditional Chinese; the clips and transcripts it writes are adaptations under the same licence, kept in the git-ignored corpus folder. Transcripts of four such clips were committed by mistake in an intermediate commit of [#65](https://github.com/zcxy-dev/fineframe/pull/65) and removed before it merged; that commit stays visible in the pull request's history, under the same licence and with this attribution. The authors do not endorse this project.

### Training data

A model's licence covers its weights, not the data it was trained on. Some of that data has its own terms: YuNet was trained on WIDER FACE (CC BY-NC-ND), CED on AudioSet's YouTube clips, and Beat This! notes that some of its training audio is copyrighted.

## README example

The example edits at the top of the README are made from footage the project does not own. Their frames and videos are served from `downloads.fineframe.app`, not files in this repository, and are shared under the footage's licence.

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

The house stylesheet adapts the look of the motion graphics in the [Herk Edit Kit](https://github.com/nateherkai/hyperframes-student-kit) (HTML, CSS and GSAP): its lit stages, glass panels, chips and entrances, redrawn in CSS animations without GSAP and in Fineframe's own colours; none of its fonts or brand assets is copied. The graphics' layouts, lengths and timing, and the planner's visuals, follow its editing playbook's split-screen proportions, card frequency, time away from the speaker and sound-effect rules.

- `packages/effects/src/style.ts`
- `packages/effects/src/graphics.ts`
- `packages/engine/src/plan/graphics.ts`
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
