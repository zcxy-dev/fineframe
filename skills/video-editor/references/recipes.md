# Recipes for changing an edit

Each recipe starts from the newest version, here `out/edit.project.json`, and makes the next one, here `edit-v2`. For a field no recipe covers, the schema says what each one means (`packages/schema/project.schema.json`), the effect templates' catalog gives their params and limits (`packages/effects/src/catalog.ts`), and `packages/effects/src/graphics.ts` the graphics' layouts and lengths. The limits below are copied from them.

**Ticks.** Every time and length is an integer: 120 000 ticks a second. Seconds × 120 000, rounded, gives ticks; `start` of captions, overlays, graphics, B-roll, music and sound effects is on the output timeline, from the video's first frame.

**Editing a copy.** Recipes other than cutting change a copy of the project in the same folder, so its relative paths still resolve. Use your own file tools on the copy, or for a change across many entries:

```bash
node -e '
const fs = require("node:fs");
const p = JSON.parse(fs.readFileSync("out/edit.project.json", "utf8"));
// … change p …
fs.writeFileSync("out/edit-v2.project.json", JSON.stringify(p, null, 2) + "\n");'
fineframe render out/edit-v2.project.json -o out/edit-v2.mp4
```

Several changes can go into one version and one render.

## Cut a part: drop a segment, trim one, remove a sentence

```bash
fineframe render out/edit.project.json --cut 12.4-17.9 -o out/edit-v2.mp4
```

- The range is in seconds (or `m:ss`) of the video the project renders, from the start of the first words to drop to the end of the last: take them from the `start` of the first and the `end` of the last of their `captions.lines[].words`, ÷ 120 000. An `edit.srt` caption stays up after its last word, so its end can reach into the next segment. A whole segment of the main track runs between two neighbouring times of `edit_cuts.json` (from 0 for the first). Trimming a segment is cutting its first or last sentences. Give `--cut` once per range; all of them are times in the input video.
- A word goes when its middle is inside the range, and the pauses beside the words cut go with them, so the edit gets shorter by more than the range when a whole segment goes. An edge of the range between two words said without a pause moves inward to the nearest pause inside the range, so a few words asked for may stay; a range with no such pause inside grows outward to the nearest ones, and stderr says which words that also took. Every new cut lands in the pause beside the words kept, and captions, overlays, B-roll and music move up with the speech. The command writes the cut edit to `out/edit-v2.project.json`; the render's `seconds` is its new length.
- A range that holds no word's middle fails and says so: widen it to the words meant.
- Read its stderr: it prints the words it cut from each clip, the overlays it removed because their whole time was cut, and the ones that overlapped the cut. Check the words are exactly the ones meant. A lower third or graphic that overlapped the cut may now stand over other words: remove it from `edit-v2.project.json` if its word went (below), and render again.
- It refuses a cut that leaves the edit outside ±5 % of its planned length, and prints the length the cut would leave. Tell the user; if they want the shorter video, run the same command with `--retarget`, which makes that length the planned one. A much shorter edit is better planned again (`SKILL.md`).

## Fix a caption word

Find the line in `captions.lines` whose `text` holds the word. Change it in `text` and in the matching entries of `words`, their `text` only; leave every time as it is. In a Chinese line each character is usually its own entry, and an English word is one:

```json
{ "text": "能比如說　把一句話…", "words": [{ "text": "能", … }, { "text": "比", … }, …] }
```

becomes `"text": "嗯　比如說　把一句話…"` with the first entry's `text` `"嗯"`. Each entry keeps at least one character: a fix with more characters than the entries it replaces puts the extra ones in its last entry, and one with fewer deletes the entries left over. Chinese lines show a pause as a full-width space (`　`) where a comma or full stop was, and keep `？`, `！` and quotes; English lines keep their punctuation, set half-width. The SubRip file is written again from the lines. A character the caption font cannot draw fails the render with the line's path.

A word the speech model misheard throughout is better fixed at the source next time: list a person's name in the `--names` file of the next `fineframe edit`, and any other word, such as a brand or a term, in its `--terms` file, which never shows in a lower third.

## Change the title or a lower third

Both are `overlays` entries, by `template`:

- `title`: `params.text`, at most 24 characters, and an optional `params.subtitle`, at most 40.
- `lower-third`: `params.name`, at most 16 characters, and an optional `params.role`, at most 28.

Change the params; keep `start` and `duration`. Overlays show one at a time, so a new one ends before the next overlay's `start`:

- **Add a title:** `{ "template": "title", "params": { "text": "…" }, "start": 0, "duration": 360000 }`, shortened to end where the first other overlay starts, and at least 192000 (1.6 s); when that leaves less, move or remove that overlay.
- **Add a lower third:** `{ "template": "lower-third", "params": { "name": "…", "role": "…" }, "start": …, "duration": 480000 }`, starting about 1 s after the person first speaks on camera; it lasts 2 to 8 s.

## Remove or add a chapter

- **Remove** an overlay by deleting its entry. A `chapter` comes with the `wipe` that covers the cut just before it (the wipe ends shortly after the chapter starts): delete both, then renumber the chapters left, `params.index` from 1 and `params.total` to their number.
- **Add a chapter:** `{ "template": "chapter", "params": { "title": "…", "index": n, "total": m }, "start": …, "duration": 420000 }`, starting with the chapter's first words; `title` at most 20 characters; renumber every chapter. A chapter suits an edit of two minutes or more.

Any overlay can take `params.accent`, a `#rrggbb` colour for its accent instead of the house amber. A changed overlay renders again, in a few seconds; unchanged ones come from the cache.

## Change a motion graphic or B-roll

A rich edit (`fineframe edit --visuals rich`, the default) adds motion graphics Claude wrote for this video, in `graphics`. Each is HTML and CSS on the house stylesheet (`packages/effects/src/style.ts`), with a `layout`:

| `layout` | What it is | Length |
|---|---|---|
| `label` | A chip over the speaker, at its `box` | 1.5–6 s (180000–720000) |
| `lower-third` | A pill low on one side over the speaker, at its `box` | 2–6 s (240000–720000) |
| `panel` | 9:16 only: the top 880 of every 1920 rows, with the speaker below | 3–8 s (360000–960000) |
| `full` | The whole frame | 4–12 s (480000–1440000) |

It also cuts away to web captures or stock footage: `broll` entries whose source id starts with `visual-`, full frame or as the upper panel of a split screen, at most 3.5 s full frame and 6 s split. Below a panel or a split, the speaker plays as `broll` entries of the main track's own source with `rect` `{ "x": 0, "y": 0.458…, "w": 1, "h": 0.541… }` at 9:16 (the lower half elsewhere), in step with it.

- **Remove a graphic:** delete its entry in `graphics`. For a `panel`, also delete the speaker entries in `broll` within the graphic's `start` to `start + duration`, so the full-frame speaker shows again. A sound effect in `audio.sfx` at the graphic's `start` belongs to it: delete it too.
- **Remove a capture or footage:** delete its `broll` entry, and for a split the speaker entries beside it, as above; and its sound effect.
- **Change a graphic's words or numbers:** edit the text in its `html`, keeping the markup and classes. Show only words and numbers the speaker says while it shows, as keywords, never the whole sentence the captions already show. Each part enters with a CSS animation of 0.3 to 0.8 s in its `css` and stays; nothing animates out.
- **Move a graphic:** change `start`, 0.4 s (48000) before the word it shows (its `start` in `captions.lines[].words`), keeping it clear of other graphics and B-roll. Its `words` name the spoken words it shows, so a later cut that takes one out removes it.
- **Add a graphic:** `{ "layout": "label", "html": "…", "css": "…", "box": { "x": …, "y": …, "w": …, "h": … }, "start": …, "duration": 360000 }`, written as `graphicsGuide` in `packages/effects/src/graphics.ts` says: the house classes, sizes in `var(--u)`, inside the safe area and clear of the captions and the speaker's face; `box` only for a label or a lower third, as fractions of the frame. The render checks only its markup and length, so look at a frame of it in the rendered video before handing it over.
- **Credits:** the render writes `edit-v2.broll.txt` again from what the new version shows: each source's `credit`, the sound effects, and each icon and logo a graphic draws (Lucide icons under ISC, Simple Icons logos under CC0 with a note that the logo is its owner's trademark). An icon or logo added by hand is credited the same way.

## Change the music: another library track, its level, or none

- **Another library track:** `fineframe render --help` lists the built-in library's tracks by their ids, under their moods (calm, upbeat, emotional, corporate and energetic). Swap the music for one with a render alone; `none` takes the music out:

  ```bash
  fineframe render out/edit.project.json --music funky-energy-loop -o out/edit-v2.mp4
  ```

  It fits the track to the edit as a plan does, from its first section, at the level the speech calls for, ducked under it, and writes `out/edit-v2.project.json`; the track downloads on its first use. B-roll keeps the beats of the track it was planned on. `edit-v2.music.txt` names the track; library tracks are CC0, and if a platform claims one, the claim is disputed with that licence.
- **Level:** `audio.music[i].gainDb` is the music's level in dB; −3 more is about a third quieter. The music still ducks under speech by `ducking.depthDb`. The finished mix is normalised to `audio.loudness`, so the voice stays at the same loudness.
- **Remove:** delete `audio.music`. The video then has no `edit-v2.music.txt`.
- **Sound effects** are `audio.sfx`, each `{ "source", "start", "gainDb" }`: lower `gainDb` to make one quieter, or delete the entry.

## Change the look or the caption style

- **Look:** each clip of `main` and each `broll` entry of the speaker beside a split screen has `grade.look`, `{ "id": "clean", "intensity": 1 }`. The looks are `clean` (a gentle contrast lift), `warm` (soft, golden highlights, for people and vlogs), `cool` (firmer contrast, blue shadows, for tech and screens) and `film` (matte blacks, teal shadows, warm light). Set the same `id` on every clip; `intensity` from 0 to 1 blends it in. Delete `grade.look` for no look. Leave `grade.auto` and `grade.match` as they are: they correct and match the cameras.

  ```js
  for (const clip of [...p.main, ...(p.broll ?? []).filter((b) => b.grade)]) clip.grade = { ...clip.grade, look: { id: "warm", intensity: 1 } };
  ```

- **Caption style:** `captions.preset` is `bold` (word by word, the word being said in amber), `creator` (a few words at a time, big, in a dark box, numbers and English words in amber), `minimal` (small white type), `pop` (each word pops in as it is said) or `none` (nothing on the picture; `edit-v2.srt` is still written, broken as `bold` breaks it). Only the render changes: no new plan. `fineframe edit --captions` picks it for a new edit.
- With a brand kit's custom captions, `brand.captions` draws in place of the preset's look: delete it to show `captions.preset` as it is.
- **Caption emoji:** Claude picks an emoji for some lines while planning, kept in `captions.lines[].emoji` (one emoji character). Set `captions.emoji` to `true` to draw each at the end of its line and write it in `edit-v2.srt`; delete it to hide them. Only the render changes: no new plan. Change or delete a line's `emoji` to swap or drop it; a skin tone, a flag or an emoji joined from several is refused. `fineframe edit --emoji` turns them on for a new edit.

## Apply, change or remove a brand kit

A kit is a folder holding `kit.json` and the files it names, its paths relative to the folder:

```json
{
  "name": "My channel",
  "colors": { "primary": "#2f6bff" },
  "fonts": { "graphics": { "id": "lxgw-wenkai-tc" }, "captions": { "path": "fonts/Brand.ttf" } },
  "logo": { "file": { "path": "logo.svg" }, "show": true, "corner": "top-right", "size": 0.12, "opacity": 0.85 },
  "captions": { "style": "bold", "size": "L", "text": "#ffffff", "highlight": "#4dd0ff", "frame": "outline", "position": "bottom", "lines": 2 }
}
```

- `brand.colors.primary` replaces the amber in the motion graphics, the templates and the caption highlight; `brand.colors.secondary` and `brand.colors.accent` replace its deeper and lighter tones, made from the primary when left out. Text that would not read on a colour turns black or white.
- `brand.fonts.graphics` and `brand.fonts.captions` are a bundled face by `id` (`noto-sans-tc`, `noto-serif-tc`, `lxgw-wenkai-tc`, `jf-openhuninn`, `iansui`, `chocolate-classical-sans`, `cactus-classical-serif`, `lxgw-marker-gothic`) or a TrueType or OpenType file by `path`. Ask before using a font file the user has not said they have the right to use. A character a face lacks is drawn in Noto Sans TC.
- `brand.logo.file` is a PNG or an SVG; with `brand.logo.show`, it is a watermark in its `brand.logo.corner` through the video, under the captions, away while a graphic, a title, a name, a chapter or a callout it would cover shows. `brand.logo.size` (0.05 to 0.3) is the side of a square of its area, as a share of the frame's shorter side; `brand.logo.opacity` is 0.2 to 1.
- `brand.captions` are custom captions: a drawn style (`bold`, `creator`, `minimal`, `pop`) with `size` `S`, `M` or `L`, `text` and `highlight` colours, `frame` `outline` or `box`, `position` `bottom`, `middle` or `top`, and `lines` 1 or 2. They move off faces, graphics and titles.

Apply or change a kit with a render alone; `none` takes the kit out:

```bash
fineframe render out/edit.project.json --brand path/to/kit -o out/edit-v2.mp4
```

It checks the kit, copies its files into `out/brand/` by their content, and writes `out/edit-v2.project.json` with them in `brand`. To change one setting of the kit an edit carries, edit `brand` in the copy and render it; a file it names has to stay the one copied, whose SHA-256 the render checks.

