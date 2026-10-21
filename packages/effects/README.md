# @video-editor/effects

The edit's motion graphics and effect overlays, drawn as web pages and rendered to video with [HyperFrames](https://github.com/heygen-com/hyperframes) in Chrome Headless Shell:

- **Graphics** Claude writes for each edit as HTML and CSS: corner labels and lower thirds over the speaker, the upper panel of a 9:16 split screen, and full-frame graphics ([graphics](#graphics)).
- **Templates** for titles, people's names, chapter markers, callouts and wipes ([templates](#templates)).

Each entry in a [`project.json`](../schema/README.md#projectjson)'s `graphics` or `overlays` becomes one page. The renderer draws it as video and lays it over exactly the output frames it covers ([engine](../engine/README.md#how-it-renders)).

## Look

The house look is one stylesheet, [`HOUSE_CSS`](src/style.ts). It is taken from the motion-graphics style of the [Herk Edit Kit](../../THIRD_PARTY_NOTICES.md#herk-edit-kit), in Fineframe's own colours:

- **Stage:** near-black (`#0b0c0f`), lit by a soft amber bloom, with a faint grid and a vignette.
- **Panels:** frosted glass panels with a thin light edge.
- **Type:** white bold type, with one amber accent (`#ffb547`).
- **Over footage:** chips and pills are dark and nearly opaque. Graphics are laid over the footage after they are rendered, so there is nothing under them to frost.

Type is set in Noto Sans TC for Chinese and Inter for Latin letters and digits. Both come from [Fontsource](https://fontsource.org) at pinned versions, so a frame never depends on the fonts installed on the machine. Sizes are given in `--u`, 1 % of the frame's short side.

Motion follows the same numbers everywhere:

- **Entrances:** every part enters with a CSS animation of 0.3 to 0.8 s, from a fast start that settles, and stays. Nothing animates out; an effect is cut away at its end. The wipe is the exception: its bands cross the frame and leave it.
- **Pushes:** a full-frame graphic is pushed in from the right, and a panel down from the top, over its first 0.35 s ([`SLIDE`](src/graphics.ts)). The renderer moves the rendered graphic, so the graphic itself stays opaque.

## Brand kits

A [brand kit](../engine/README.md#brand-kits) changes the look as the effects render, never the markup Claude wrote, so a kit changes with a render alone ([`src/brand.ts`](src/brand.ts)):

- **Colours:** every colour a page's CSS or style attributes write out in a property that takes a colour (`color`, backgrounds, borders, outlines, shadows, `fill`, `stroke`, `stop-color`, filters, and custom properties holding one), as hex, `rgb()` or `hsl()` in either syntax, or as any CSS colour name, whose hue is 20 to 55°, saturation at least 45 % and lightness 30 to 92 % is in the house amber's family, whether the house stylesheet's, a template's or a near amber Claude wrote. It becomes the kit's tone nearest it in lightness, primary, secondary or accent, with its alpha kept. The page loads the house stylesheet so recoloured, inline, in place of `house.css`.
- **Text:** text in an amber is in the kit's primary. As the page loads, a script of the effects' own reads each text's colour against the nearest box behind it with a fill of at least half opacity, as the cascade resolved both (or else the dark stage), and sets text under 3:1 contrast in black or white, whichever reads better.
- **Icons and logos** drawn in the accent come from a copy in the kit's primary, in `brand/marks-<colour>/` of the render's folder.
- **Face:** with a kit's face, every font family, in `font-family` or a `font` shorthand, is `"Fineframe Brand", "Noto Sans TC"`, the face loaded from `brand/<hash>.<ext>` of the render's folder, at every weight as drawn. Text may run wider or narrower than the checks measured it in the house faces.

[`colour.ts`](src/colour.ts) holds the arithmetic, with no Node module, so the web page's previews use the same tones. Without a kit, a page is the one the house look draws.

## Graphics

Claude writes each edit's graphics for that video, as markup and its own CSS on the house stylesheet's classes. [`graphicsGuide`](src/graphics.ts) is what it is told: the look, the layouts, the safe area, the type sizes and the motion.

| Layout | What it is | Length | Rendered |
|---|---|---|---|
| `label` | A chip in a corner, over the speaker | 1.5–6 s | At its own box, with its alpha |
| `lower-third` | A pill low on one side, over the speaker | 2–6 s | At its own box, with its alpha |
| `panel` | The top 880 of every 1920 rows of a 9:16 frame, with the speaker below it | 3–8 s | Opaque, at the panel's size |
| `full` | The whole frame | 4–12 s | Opaque, at the frame's size |

**What runs.** A graphic's page runs no script but the renderer's own, and reaches nothing but the house stylesheet, the fonts and the icons and logos beside it. Chrome runs with `--no-sandbox`, so three layers hold that, each without the others:
- **Parsed markup** ([`src/markup.ts`](src/markup.ts)). `markupProblem` reads the HTML with htmlparser2 against an allowlist: `div`, `span`, `p`, `b`, `strong`, `i`, `em`, `small`, `sub`, `sup`, `br`, lists, headings and `img`. The only attributes are `class` and `style`, plus `src`, `alt`, `width` and `height` on an image, whose `src` must name a bundled icon or logo. Comments, doctypes and CDATA are refused. It reads the CSS and each style attribute with PostCSS: only `@keyframes` and `@property`, no `url()` or anything else that loads, and no `content:` text or counters, whose words no check would read. `cleanMarkup` rebuilds the markup from that parse for the page, so the browser draws exactly what was checked, and a graphic that fails never becomes a page.
- **The page's policy** ([`src/page.ts`](src/page.ts)). Its Content-Security-Policy allows no script, and styles, fonts and images only from its own folder. As the renderer serves a page, it adds the SHA-256 of each inline script in it, which are HyperFrames' own, so no script added later runs.
- **Blocked requests** ([`src/guard.ts`](src/guard.ts)). The checking browser's page, and every page HyperFrames opens (its puppeteer's `launch` is wrapped in the render's worker), intercept every request: only those to the loopback address the page came from get through, and every other request and navigation is aborted.

**Icons and logos.** [`src/icons.ts`](src/icons.ts) holds a subset of Lucide's icons and Simple Icons' brand logos ([notices](../../THIRD_PARTY_NOTICES.md#icons-copied-into-the-source)). They are written as SVG files beside the pages, and a graphic shows one as an image: `icons/<name>.svg` in the house white, `icons/accent/<name>.svg` in the accent, `logos/<name>.svg` in the brand's colour, or the accent where that colour would vanish on the dark stage.

**Checks.** [`checkGraphics`](src/check.ts) loads each graphic in the same Chrome, seeks its animations to each part's start and end and to its last frame, and reports each problem as a sentence. Every text drawn is checked, faint ones too; it reports text that:
- has a character none of the fonts has;
- runs off the frame or out of its box;
- lies where the captions are drawn;
- overlaps other text;
- is under the smallest size;
- disappears before the end.

It also reports:
- a label that covers a face or leaves the safe area;
- a panel or full-frame graphic whose text and icons span too little of it, or whose largest text is under 12 units;
- a part that does not enter, enters for longer than 0.8 s or keeps moving;
- a box that shows empty for more than 0.8 s before its text;
- an icon or logo that does not load.

It returns:
- the text the graphic shows, for the engine to check against the speech;
- for a label or lower third, the box it draws in;
- a half-size screenshot, for Claude to fix it from.

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
| `lower-third` | A person's name and role in a dark pill with an accent bar; at 9:16 at the top of the frame ([why](#safe-area)) | `name`, `role` |
| `chapter` | The chapter's number and name, under one segment per chapter that shows how far through the video it is | `title`, `index`, `total` |
| `callout` | Outlines a region of a screen recording, dims the rest and labels it | `rect`, `label`, `dim` |
| `wipe` | Two bands sweep across the frame and cover the cut in the middle of the wipe | `direction`, `color` |

Every template also takes `accent`, a `#rrggbb` that replaces the house amber. Each template's lengths and its params' limits are in [`src/catalog.ts`](src/catalog.ts), and its markup in [`src/templates.ts`](src/templates.ts). Lengths are hard limits: below the minimum the motion cannot finish, and above the maximum the overlay outstays its point.

```ts
import { catalog, guidance, overlayProblems } from "@video-editor/effects";

const chapter = catalog.chapter; // purpose, whenToUse, avoid, timing, seconds, params, example
const problems = overlayProblems(project.overlays ?? []); // [] when every overlay is valid
```

- **`catalog`:** for each template:
  - what it says to the viewer (`purpose`);
  - the moments it serves (`whenToUse`);
  - where it does not belong (`avoid`);
  - where its `start` goes relative to the speech or the cut (`timing`);
  - its lengths in seconds;
  - its params as a JSON Schema (draft 2020-12);
  - an example.
- **`guidance`:** the rules across templates. Effects serve the story, so most cuts get none.
- **`overlayProblems` and `validateOverlays`:** check each overlay's template, params and length, and report every problem with its JSON path. The renderer runs `validateOverlays` before it renders anything.

### Safe area

Overlays keep to a safe area inside the frame's edges. The bottom margin leaves the lower part of the frame to the captions, which are drawn over everything.

At 9:16 the margins also clear what short-form apps lay over the video: the header, the buttons down the right, and the description at the bottom. That pushes the band above the captions up to where a talking head's mouth and chin fall. So at 9:16 the lower third sits at the top of the frame instead.

The timings, curves, type sizes and margins live in [`src/layout.ts`](src/layout.ts).

## Rendering

`renderOverlays(jobs, binaries)` and `renderGraphics(jobs, binaries)` render each page for exactly the frames it covers, at the output's rate, and return one file per job. The renderer calls them; nothing else needs to.

- **How:** each page is a [HyperFrames](https://github.com/heygen-com/hyperframes) composition with no timeline of its own. HyperFrames seeks the page's CSS animations to each frame and captures it in Chrome Headless Shell. Renders run in a child process ([`src/worker.ts`](src/worker.ts)), so a caller's stdout stays its own.
- **Programs:** `binaries` names Chrome Headless Shell, FFmpeg and ffprobe. The engine downloads Chrome and ffprobe on first use ([engine](../engine/README.md#ffmpeg)).
- **Format:**
  - A transparent page (a template, a label or a lower third) is VP9 with alpha in WebM. Reading its alpha needs FFmpeg's libvpx decoder ([FFmpeg requirements](../engine/README.md#ffmpeg)).
  - An opaque page (a panel or a full-frame graphic) is H.264 in MP4. HyperFrames captures opaque pages faster on Linux, where Chrome's BeginFrame capture leaves out alpha.
- **Cache:** renders are kept in `~/.cache/video-editor/effects/` (or under `XDG_CACHE_HOME`). A page is keyed by its whole document, which names a brand kit's face and marks by their contents, size, frame rate, frame count and alpha, and by the house stylesheet, the fonts and the pinned HyperFrames version, so an unchanged page renders once. The folder the pages load the stylesheet and the fonts from, about 7 MB, is made once per version beside them; delete the folder to reclaim the space.
- **Speed:** measured in [MEASUREMENTS.md](../engine/MEASUREMENTS.md#effect-measurements).

## Preview

[`../engine/scripts/effects-preview.ts`](../engine/scripts/effects-preview.ts) renders every template at 16:9 and 9:16 over the [synthetic corpus](../../bench/README.md#synthetic-corpus), with a strip of frames from each template's entrance and hold. Run `vework analyze` first, so that each clip has its `runs/vework/index.json`.

```bash
cd packages/engine
node scripts/effects-preview.ts ../../bench/synthetic /tmp/effects-preview
```

## Tests

`pnpm --filter @video-editor/effects test` checks:
- the catalog and the template params' validation;
- the pages, what markup may hold, and each layout's render size;
- each template's markup;
- the graphics' validation;
- the cache keys and the layout.

Rendering every template and the graphics through HyperFrames, and the checks in Chrome, are tested in the engine ([`render.test.ts`](../engine/src/render.test.ts), [`plan/graphics.test.ts`](../engine/src/plan/graphics.test.ts)). Those tests are skipped where `CI` is set.
