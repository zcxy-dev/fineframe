# @video-editor/effects

Animated effect overlays for the edit, as [Remotion](https://www.remotion.dev) templates: titles, lower thirds, keyword highlights, chapter markers, callouts and wipes; and motion-graphics [cards](#cards) to cut to as B-roll. Each entry in a [`project.json`](../schema/README.md#projectjson)'s `overlays` names a template and its params; the renderer draws it as transparent video and lays it over exactly the output frames it covers ([engine](../engine/README.md#how-it-renders)). Remotion is source-available, not MIT: see [who needs its company licence](../../THIRD_PARTY_NOTICES.md#remotion).

## Templates

| Template | What it does | Params |
|---|---|---|
| `title` | Names the video or a major section in large type, over a soft pool of shade | `text`, `subtitle` |
| `lower-third` | A person's name and role, on a plate that opens out of an accent bar; at 9:16 at the top of the frame ([why](#design)) | `name`, `role` |
| `keyword` | A highlighter swipe that lands on the word a sentence turns on | `text`, `position`: `upper` or `lower` |
| `chapter` | The chapter's number and name, under one segment per chapter that shows how far through the video it is | `title`, `index`, `total` |
| `callout` | Outlines a region of a screen recording, dims the rest and labels it | `rect`, `label`, `dim` |
| `wipe` | Two bands sweep across the frame and cover the cut in the middle of the wipe | `direction`, `color` |

Every template also takes `accent`, a `#rrggbb` that replaces the house amber. Each template's lengths and its params' limits are in [`src/catalog.ts`](src/catalog.ts). Lengths are hard limits: below the minimum the motion cannot finish, above the maximum the overlay outstays its point.

## For the planner

```ts
import { catalog, guidance, overlayProblems } from "@video-editor/effects";

const keyword = catalog.keyword; // purpose, whenToUse, avoid, timing, seconds, params, example
const problems = overlayProblems(project.overlays ?? []); // [] when every overlay is valid
```

- **`catalog`:** for each template, what it says to the viewer (`purpose`), the moments it serves (`whenToUse`), where it does not belong (`avoid`), where its `start` goes relative to the speech or the cut (`timing`), its lengths in seconds, its params as a JSON Schema (draft 2020-12) and an example.
- **`guidance`:** the rules across templates. Effects serve the story, so most cuts get none.
- **`overlayProblems` and `validateOverlays`:** check each overlay's template, params and length, and report every problem with its JSON path. The renderer runs `validateOverlays` before it renders anything.

## Design

One motion language for every template: the accent element draws first, the content reveals from behind its edge, and everything leaves faster than it came. Arrivals ease out from a fast start, departures gather speed, and nothing bounces. The first frame of an overlay comes before its entrance and the last after its exit, so it never pops in or out.

Type is white, on near-black plates, with one amber accent. It is set in Noto Sans TC and sized from the frame's short side, larger at 9:16 for a phone held in the hand. Every size is a step of one scale, each step 1.25 times the one below: small print (a role, a chapter count, a callout label), a subtitle, a heading on a plate (a name, a chapter), a keyword and a title, at 3.2, 4, 5, 7.8 and 9.8 % of the short side. Names, keywords and labels shrink to stay on one line; titles balance their lines, and no closing punctuation starts a line.

Overlays keep to a safe area inside the frame's edges. The bottom margin leaves the lower part of the frame to captions, which are drawn over everything. At 9:16 the margins also clear what short-form apps lay over the video: the header, the buttons down the right, and the description at the bottom. That pushes the band above the captions up to where a talking head's mouth and chin fall, so at 9:16 the lower third sits at the top of the frame instead, and a `lower` keyword suits only shots with no one on camera.

The timings, curves, colours, type sizes and margins live in [`src/layout.ts`](src/layout.ts).

## Cards

Cards are opaque motion graphics the edit cuts to, like B-roll: full frame, or the upper panel of a split screen with the speaker below. Each builds in over its first second or two and then holds, slowly pushing in, until a hard cut takes it away; it has no exit. They share the overlays' colours, Noto Sans TC, curves and type scale, on a dark canvas lit by a bloom of the accent, with frosted panels.

| Card | What it shows | Params |
|---|---|---|
| `stat` | One number counting up, with what it measures | `value`, `prefix`, `suffix`, `decimals`, `label`, `context`, `trend` |
| `kpis` | Two to four numbers side by side | `title`, `items` |
| `list` | A numbered list; `active` lights one item and dims the rest | `title`, `items`, `active` |
| `checklist` | Boxes that tick one after another | `title`, `items`, `checked` |
| `versus` | Two things across a VS badge, one lit as the winner | `left`, `right`, `winner` |
| `before-after` | A before state that turns into an after state | `title`, `before`, `after` |
| `quote` | A quotation revealed word by word, with its author | `text`, `author`, `role`, `icon`, `logo` |
| `steps` | A process as icons joined by a drawing line | `title`, `steps` |
| `timeline` | Dated events on a line that draws through them | `title`, `events`, `active` |
| `bar-chart` | Columns growing to their values | `title`, `unit`, `bars`, `highlight` |
| `line-chart` | A line drawing through a series | `title`, `unit`, `points` |
| `ring` | A ring filling to a percentage | `value`, `label`, `context` |
| `progress` | Bars filling to their percentages | `title`, `items` |
| `chat` | A chat window, the reply streaming in | `app`, `icon`, `logo`, `messages` |
| `terminal` | Commands typing out, with their output | `title`, `lines` |
| `code` | Code writing in line by line, some lines lit | `filename`, `lines`, `highlight` |
| `app` | A product card: logo, name, tagline, tags, address | `name`, `tagline`, `icon`, `logo`, `tags`, `url` |
| `logo` | A brand's logo landing, with its name | `name`, `tagline`, `icon`, `logo` |
| `icon-grid` | Icons with labels popping in | `title`, `items` |
| `definition` | A term, its kind and a definition | `term`, `kind`, `text` |
| `highlight` | A statement with key phrases highlighted | `text`, `highlights`, `source` |
| `search` | A query typing into a search box, results under it | `query`, `results` |
| `notifications` | Phone notifications stacking in | `items` |
| `pros-cons` | Upsides with ticks, downsides with crosses | `title`, `pros`, `cons`, `prosLabel`, `consLabel` |
| `ranking` | Ranked rows with bars proportional to their values | `title`, `unit`, `items` |
| `section` | A big number and a section's name | `title`, `index`, `kicker` |
| `table` | Products across, features down, ticks and values | `columns`, `rows`, `highlight` |

Every card also takes `accent`. Icons are Lucide's names and logos Simple Icons' slugs, from the subset in [`src/icons.ts`](src/icons.ts); a logo appears only where the video names that brand ([licences and trademarks](../../THIRD_PARTY_NOTICES.md#icons-copied-into-the-source)). Each card's purpose, lengths, params as a JSON Schema and an example are in [`src/cards.ts`](src/cards.ts):

```ts
import { cardProblems, cards, renderCards } from "@video-editor/effects";

const problems = cardProblems([{ card: "stat", params, seconds: 3 }]); // [] when valid
const [file] = await renderCards([
  { card: "stat", params, placement: "panel", aspect: "9:16", width: 1080, height: 880, fps, frames: 90 },
]);
```

The panel is the top 880 of every 1920 rows at 9:16 and the upper half elsewhere (`panelShare`); `cardSize` gives a card's size in pixels for an output. A rich edit's planner proposes cards from this list and the renderer draws `project.json`'s `cards` with `renderCards` ([visuals](../engine/README.md#visuals)).

A card lays out in the content box [`cardLayout`](src/layout.ts) gives it: inside the overlays' safe area for a full card, so a full 9:16 card ends above the captions; across a panel, clear of the apps' header at 9:16 and of the captions on the seam. Its sizes are in units of the box's short side, growing to 1.3 times that in a long box such as a 16:9 panel, and each card lays out in a row or a column by the box's shape. Cards render like overlays, as VP9 in WebM without alpha, cached by the same key plus their placement.

## Rendering

`renderOverlays(jobs)` renders each overlay at the output's size and frame rate, for exactly the frames it covers, and returns one file per job. The renderer calls it; nothing else needs to.

- **Speed:** a new overlay costs about 0.2 s a frame at 1080p on the [reference machine](../../bench/README.md#reference-machine), so the six templates at 16:9 take about 100 s; a cached one costs only its compositing.
- **Format:** VP9 with alpha in WebM ([why](#format)). Reading the alpha needs the libvpx decoder ([FFmpeg requirements](../engine/README.md#ffmpeg)).
- **Cache:** renders are kept in `~/.cache/video-editor/effects/` (or under `XDG_CACHE_HOME`). An overlay is keyed by its template, params (in any key order), aspect, size, frame rate and frame count, and a hash of this package's source and pinned dependencies. An unchanged overlay renders once. The bundled page each source version renders from takes about 45 MB; delete the folder to reclaim the space.
- **Chrome:** Remotion renders in Chrome Headless Shell, which it downloads (about 92 MB) on the first render into `~/.cache/video-editor/effects/chrome/node_modules/.remotion/`. Renders run in a child process with that folder as its working directory, because Remotion chooses where Chrome goes from the working directory, and this package's own folder may not be writable, as in the desktop app. `onDownload` reports the download's bytes. No licence key or usage event is sent to Remotion.
- **Compositor:** Remotion's native compositor, with its own FFmpeg, comes with `@remotion/renderer` for this system. Where it was not installed, as in the desktop app, whose installer leaves it out because that FFmpeg is GPL with non-free parts ([notes](../../THIRD_PARTY_NOTICES.md#desktop-installers)), the first render downloads it from npm (about 10 MB) into `~/.cache/video-editor/effects/`, checks it against the integrity in `pnpm-lock.yaml` and passes it to Remotion as `binariesDirectory` ([`src/compositor.ts`](src/compositor.ts)).
- **Fonts:** Noto Sans TC comes from [Fontsource](https://fontsource.org) at a pinned version, so a render never depends on the fonts installed on the machine. A frame waits until every slice of the font its text needs has loaded.

### Format

The renderer composites an overlay in every piece of the edit it spans, so the format is chosen by render speed, file size and decoding cost. Each template at its typical length, 30 fps, rendered on the [reference machine](../../bench/README.md#reference-machine), shared with other jobs, with PNG frames from Chrome; decoding as the renderer does, into `yuva420p`:

| | ProRes 4444 | VP9 with alpha |
|---|---|---|
| Render, all six templates at 1080×1920 and 1920×1080 (936 frames) | 164 s | 202 s |
| Size, the same 12 files | 650 MB | 1.05 MB |
| Size, the title at 1080×1920 (its shade covers the frame) | 295 MB | 0.34 MB |
| Decode, title / lower third / chapter | 2.9–3.7 / 1.5 / 1.2–1.4 s | 0.5–0.8 / 0.3–0.6 / 0.4 s |
| Decoder peak memory | 250–360 MB | 60–70 MB |

VP9 renders about 1.2 times slower, but its files are 600 times smaller and it decodes 2 to 8 times faster in a quarter of the memory. At CRF 28 its frames match ProRes's to 40–52 dB PSNR; side by side over footage the two are indistinguishable.

## Preview

[`../engine/scripts/effects-preview.ts`](../engine/scripts/effects-preview.ts) renders every template at 16:9 and 9:16 over the [synthetic corpus](../../bench/README.md#synthetic-corpus), once `vework analyze` has written each clip's `runs/vework/index.json`, with a strip of frames from each template's entrance, hold and exit:

```bash
cd packages/engine
node scripts/effects-preview.ts ../../bench/synthetic /tmp/effects-preview
```

In `packages/effects`, `node scripts/cards-preview.ts <folder>` renders each card's example as a still at 3 s; `--at 9:16/full,16:9/panel` picks the aspects and placements, `--only` some cards and `--mp4` an MP4 of each card named.

## Tests

`pnpm --filter @video-editor/effects test` checks the catalog, the params validation of templates and cards, the cache keys and the layout. Rendering every template through Remotion is tested in the engine ([Tests](../engine/README.md#tests)). One test renders every card's example through Remotion, full frame at 9:16 and as a 16:9 panel, at five frames a second so a few frames span its build; it is skipped where `CI` is set.
