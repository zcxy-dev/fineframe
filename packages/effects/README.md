# @video-editor/effects

The edit's motion graphics and effect overlays, drawn as web pages and rendered to video with [HyperFrames](https://github.com/heygen-com/hyperframes) in Chrome Headless Shell:

- **Graphics** Claude writes for each edit as HTML and CSS: corner labels and lower thirds over the speaker, the upper panel of a 9:16 split screen, and full-frame graphics ([graphics](#graphics)).
- **Templates** for titles, people's names, chapter markers, callouts and wipes ([templates](#templates)).

Each entry in a [`project.json`](../schema/README.md#projectjson)'s `graphics` or `overlays` becomes one page. The renderer draws it as video and lays it over exactly the output frames it covers ([engine](../engine/README.md#how-it-renders)).

## Look

The house look is one stylesheet, [`HOUSE_CSS`](src/style.ts), after the motion-graphics style of the [Herk Edit Kit](../../THIRD_PARTY_NOTICES.md#herk-edit-kit): a near-black stage lit by a soft amber bloom, frosted glass panels, white bold type with one amber accent, and dark, nearly opaque chips and pills over footage.

Type is Noto Sans TC for Chinese and Inter for Latin letters and digits, from [Fontsource](https://fontsource.org) at pinned versions, so a frame never depends on the machine's fonts. Sizes are in `--u`, 1 % of the frame's short side.

Every part enters with a CSS animation of 0.3 to 0.8 s and stays; nothing animates out, and an effect is cut away at its end. The wipe is the exception: its bands cross the frame and leave it. The renderer pushes a full-frame graphic in from the right, and a panel down from the top, over its first 0.35 s ([`SLIDE`](src/graphics.ts)).

## Brand kits

A [brand kit](../engine/README.md#brand-kits) changes the look as the effects render, never the markup Claude wrote, so a kit changes with a render alone ([`src/brand.ts`](src/brand.ts)):

- **Colours:** every colour in the amber family, in the house stylesheet, a template or Claude's CSS, becomes the kit's tone nearest it in lightness (primary, secondary or accent), with its alpha kept.
- **Text:** text in an amber takes the kit's primary. Text under 3:1 contrast against the box behind it is set in black or white, whichever reads better.
- **Icons and logos** drawn in the accent come in the kit's primary.
- **Face:** a kit's face replaces every font family, at every weight. Text may run wider or narrower than the checks measured it in the house faces.

[`colour.ts`](src/colour.ts) holds the colour arithmetic with no Node module, so the web page's previews use the same tones. A kit's SVG logo is checked against an allowlist by `svgProblem` ([`src/logo.ts`](src/logo.ts)) and drawn to a PNG for the watermark by `rasterizeSvg` ([`src/raster.ts`](src/raster.ts)). Without a kit, a page is the house look's.

## Graphics

Claude writes each edit's graphics as markup and its own CSS on the house stylesheet's classes. [`graphicsGuide`](src/graphics.ts) is what it is told: the look, the layouts, the safe area, the type sizes and the motion.

| Layout | What it is | Length | Rendered |
|---|---|---|---|
| `label` | A chip in a corner, over the speaker | 1.5–6 s | At its own box, with its alpha |
| `lower-third` | A pill low on one side, over the speaker | 2–6 s | At its own box, with its alpha |
| `panel` | The top 880 of every 1920 rows of a 9:16 frame, with the speaker below it | 3–8 s | Opaque, at the panel's size |
| `full` | The whole frame | 4–12 s | Opaque, at the frame's size |

**What runs.** A graphic's page runs no script but the renderer's own and reaches nothing but the house stylesheet, the fonts and the icons and logos beside it. Chrome runs with `--no-sandbox`, so three layers hold that, each without the others:
- **Parsed markup** ([`src/markup.ts`](src/markup.ts)): `markupProblem` checks the HTML and CSS against an allowlist (text elements and bundled icon images; `class` and `style`; no `url()`, no `content:` text, only `@keyframes` and `@property`), and `cleanMarkup` rebuilds the page from that parse, so the browser draws exactly what was checked.
- **The page's policy** ([`src/page.ts`](src/page.ts)): a Content-Security-Policy that allows no script but HyperFrames' own inline ones, by hash, and styles, fonts and images only from the page's folder.
- **Blocked requests** ([`src/guard.ts`](src/guard.ts)): every page the checks and HyperFrames open aborts any request or navigation not to the loopback address it came from.

**Icons and logos.** [`src/icons.ts`](src/icons.ts) holds a subset of Lucide's icons and Simple Icons' brand logos ([notices](../../THIRD_PARTY_NOTICES.md#icons-copied-into-the-source)), written as SVG files beside the pages: `icons/<name>.svg` in white, `icons/accent/<name>.svg` in the accent, `logos/<name>.svg` in the brand's colour, or the accent where that colour would vanish on the dark stage.

**Checks.** [`checkGraphics`](src/check.ts) loads each graphic in the same Chrome, seeks its animations to each part's start and end and to its last frame, and reports each problem as a sentence: text that has a character no font has, runs off the frame or its box, lies where the captions are drawn, overlaps other text, is too small or disappears before the end; a label over a face or outside the safe area; a panel or full-frame graphic whose content spans too little of it or whose largest text is under 12 units; a part that does not enter, enters for longer than 0.8 s or keeps moving; a box empty for more than 0.8 s before its text; an icon or logo that does not load. It returns the text the graphic shows (for the engine to check against the speech), a label's or lower third's box, and a half-size screenshot for Claude to fix it from.

```ts
import { checkGraphics, graphicProblems, renderGraphics } from "@video-editor/effects";

const problems = graphicProblems(project.graphics ?? [], "9:16"); // [] when valid
const [check] = await checkGraphics([{ layout, html, css, output, frames, captions, faces }], chrome);
const [file] = await renderGraphics([{ layout, html, css, box, output, frames }], binaries);
```

## Templates

| Template | What it does | Params |
|---|---|---|
| `title` | Names the video or a major section in large type, over a soft pool of shade | `text`, `subtitle` |
| `lower-third` | A person's name and role in a dark pill with an accent bar; at 9:16 at the top of the frame ([safe area](#safe-area)) | `name`, `role` |
| `chapter` | The chapter's number and name, under one segment per chapter that shows how far through the video it is | `title`, `index`, `total` |
| `callout` | Outlines a region of a screen recording, dims the rest and labels it | `rect`, `label`, `dim` |
| `wipe` | Two bands sweep across the frame and cover the cut in the middle of the wipe | `direction`, `color` |

Every template also takes `accent`, a `#rrggbb` that replaces the house amber. Each template's lengths, which are hard limits, and its params' limits are in [`src/catalog.ts`](src/catalog.ts); its markup is in [`src/templates.ts`](src/templates.ts).

```ts
import { catalog, guidance, overlayProblems } from "@video-editor/effects";

const chapter = catalog.chapter; // purpose, whenToUse, avoid, timing, seconds, params, example
const problems = overlayProblems(project.overlays ?? []); // [] when every overlay is valid
```

- **`catalog`:** for each template, what it says to the viewer, when to use it and when not, where its `start` goes, its lengths in seconds, its params as a JSON Schema (draft 2020-12) and an example.
- **`guidance`:** the rules across templates. Effects serve the story, so most cuts get none.
- **`overlayProblems` and `validateOverlays`:** check each overlay's template, params and length, and report every problem with its JSON path. The renderer runs `validateOverlays` before it renders anything.

### Safe area

Overlays keep to a safe area inside the frame's edges, and leave the bottom of the frame to the captions, which are drawn over everything. At 9:16 the margins also clear what short-form apps lay over the video (the header, the buttons down the right, the description at the bottom), so the lower third sits at the top of the frame. The timings, curves, type sizes and margins are in [`src/layout.ts`](src/layout.ts).

## Rendering

`renderOverlays(jobs, binaries)` and `renderGraphics(jobs, binaries)` render each page for exactly the frames it covers, at the output's rate, and return one file per job. The renderer calls them; nothing else needs to.

- **How:** each page is a [HyperFrames](https://github.com/heygen-com/hyperframes) composition that seeks the page's CSS animations to each frame and captures it in Chrome Headless Shell, in a child process ([`src/worker.ts`](src/worker.ts)), so a caller's stdout stays its own.
- **Programs:** `binaries` names Chrome Headless Shell, FFmpeg and ffprobe. The engine downloads Chrome and ffprobe on first use ([engine](../engine/README.md#ffmpeg)).
- **Format:** a transparent page (a template, a label or a lower third) is VP9 with alpha in WebM, whose alpha needs FFmpeg's libvpx decoder ([FFmpeg requirements](../engine/README.md#ffmpeg)); an opaque page (a panel or a full-frame graphic) is H.264 in MP4.
- **Cache:** renders are kept in `~/.cache/video-editor/effects/` (or under `XDG_CACHE_HOME`), keyed by everything that shapes the page, so an unchanged page renders once. Beside them is the folder the pages load the stylesheet and fonts from, about 7 MB, one per version; delete the folder to reclaim the space.
- **Speed:** measured in [MEASUREMENTS.md](../engine/MEASUREMENTS.md#effect-measurements).

## Preview

[`../engine/scripts/effects-preview.ts`](../engine/scripts/effects-preview.ts) renders every template at 16:9 and 9:16 over the [synthetic corpus](../../bench/README.md#synthetic-corpus), with a strip of frames from each template's entrance and hold. Run `vework analyze` first, so that each clip has its `runs/vework/index.json`.

```bash
cd packages/engine
node scripts/effects-preview.ts ../../bench/synthetic /tmp/effects-preview
```

## Tests

`pnpm --filter @video-editor/effects test` checks the catalog and template params, the cache keys, safe area and type scale, the pages and what markup may hold, each layout's render size, the graphics' validation, the icons, brand kits, SVG logos, the request guard, and that every `project.json` path the [`video-editor` skill](../../skills/video-editor/SKILL.md) names exists.

Rendering the templates and graphics through HyperFrames, and the checks in Chrome, are tested in the engine ([`render.test.ts`](../engine/src/render.test.ts), [`plan/graphics.test.ts`](../engine/src/plan/graphics.test.ts)) and skipped where `CI` is set.
