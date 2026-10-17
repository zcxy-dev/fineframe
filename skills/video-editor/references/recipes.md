# Recipes for changing an edit

Each recipe starts from the newest version, here `out/edit.project.json`, and makes the next one, here `edit-v2`. For a field no recipe covers, the schema says what each one means (`packages/schema/project.schema.json`), the effect templates' catalog gives their params and limits (`packages/effects/src/catalog.ts`), and the cards' theirs (`packages/effects/src/cards.ts`). The overlays' limits below are copied from the catalog; where they differ, the catalog wins.

**Ticks.** Every time and length is an integer: 120 000 ticks a second. Seconds × 120 000, rounded, gives ticks; `start` of captions, overlays, cards, B-roll, music and sound effects is on the output timeline, from the video's first frame.

**Editing a copy.** Recipes other than cutting change a copy of the project in the same folder, so its relative paths still resolve. Use your own file tools on the copy, or for a change across many entries:

```bash
node -e '
const fs = require("node:fs");
const p = JSON.parse(fs.readFileSync("out/edit.project.json", "utf8"));
// … change p …
fs.writeFileSync("out/edit-v2.project.json", JSON.stringify(p, null, 2) + "\n");'
pnpm -s render out/edit-v2.project.json -o out/edit-v2.mp4
```

Several changes can go into one version and one render.

## Cut a part: drop a segment, trim one, remove a sentence

```bash
pnpm -s render out/edit.project.json --cut 12.4-17.9 -o out/edit-v2.mp4
```

- The range is in seconds (or `m:ss`) of the video the project renders, from the start of the first words to drop to the end of the last: take them from the `start` of the first and the `end` of the last of their `captions.lines[].words`, ÷ 120 000. An `edit.srt` caption stays up after its last word, so its end can reach into the next segment. A whole segment of the main track runs between two neighbouring times of `edit_cuts.json` (from 0 for the first). Trimming a segment is cutting its first or last sentences. Give `--cut` once per range; all of them are times in the input video.
- A word goes when its middle is inside the range, and the pauses beside the words cut go with them, so the edit gets shorter by more than the range when a whole segment goes. Every new cut lands in the pause beside the words kept, and captions, overlays, B-roll and music move up with the speech. The command writes the cut edit to `out/edit-v2.project.json`; the render's `seconds` is its new length.
- A range that holds no word's middle fails and says so: widen it to the words meant.
- Read its stderr: it prints the words it cut from each clip, the overlays it removed because their whole time was cut, and the ones that overlapped the cut. Check the words are exactly the ones meant. A keyword or lower third that overlapped the cut may now stand over other words: remove it from `edit-v2.project.json` if its word went (below), and render again.
- It refuses a cut that leaves the edit outside ±5 % of its planned length, and prints the length the cut would leave. Tell the user; if they want the shorter video, run the same command with `--retarget`, which makes that length the planned one. A much shorter edit is better planned again (`SKILL.md`).

## Fix a caption word

Find the line in `captions.lines` whose `text` holds the word. Change it in `text` and in the matching entries of `words`, their `text` only; leave every time as it is. In a Chinese line each character is usually its own entry, and an English word is one:

```json
{ "text": "能比如說　把一句話…", "words": [{ "text": "能", … }, { "text": "比", … }, …] }
```

becomes `"text": "嗯　比如說　把一句話…"` with the first entry's `text` `"嗯"`. Each entry keeps at least one character: a fix with more characters than the entries it replaces puts the extra ones in its last entry, and one with fewer deletes the entries left over. Chinese lines show a pause as a full-width space (`　`) where a comma or full stop was, and keep `？`, `！` and quotes; English lines keep their punctuation. The SubRip file is written again from the lines. A character the caption font cannot draw fails the render with the line's path.

A name the speech model misheard throughout is better fixed at the source next time: list it in the `--names` file of the next `pnpm edit`.

## Change the title or a lower third

Both are `overlays` entries, by `template`:

- `title`: `params.text`, at most 24 characters, and an optional `params.subtitle`, at most 40.
- `lower-third`: `params.name`, at most 16 characters, and an optional `params.role`, at most 28.

Change the params; keep `start` and `duration`. Overlays show one at a time, so a new one ends before the next overlay's `start`:

- **Add a title:** `{ "template": "title", "params": { "text": "…" }, "start": 0, "duration": 360000 }`, shortened to end where the first other overlay starts, and at least 192000 (1.6 s); when that leaves less, move or remove that overlay.
- **Add a lower third:** `{ "template": "lower-third", "params": { "name": "…", "role": "…" }, "start": …, "duration": 480000 }`, starting about 1 s after the person first speaks on camera; it lasts 2 to 8 s.

## Remove or add a keyword or chapter

- **Remove** an overlay by deleting its entry. A `chapter` comes with the `wipe` that covers the cut just before it (the wipe ends shortly after the chapter starts): delete both, then renumber the chapters left, `params.index` from 1 and `params.total` to their number.
- **Add a keyword:** `{ "template": "keyword", "params": { "text": "…", "position": "upper" }, "start": …, "duration": 180000 }`. `text` is the word or number as spoken, at most 12 characters; `start` is that word's `start` in `captions.lines[].words` (its first character's, in Chinese) less 18 000 (0.15 s), so the swipe lands as it is said. Keep `position` `upper` at 9:16 unless no one is on camera. Pick a moment no other overlay covers, and keep keywords to one to three a minute.
- **Add a chapter:** `{ "template": "chapter", "params": { "title": "…", "index": n, "total": m }, "start": …, "duration": 420000 }`, starting with the chapter's first words; `title` at most 20 characters; renumber every chapter. A chapter suits an edit of two minutes or more.

Any overlay can take `params.accent`, a `#rrggbb` colour for its accent instead of the house amber. A changed overlay renders again, in a few seconds; unchanged ones come from the cache.

## Remove or add a card or B-roll

A rich edit (`pnpm edit --visuals rich`, the default) cuts away from the speaker on its points: to a motion-graphics card (`cards`), or to a web capture or stock footage (`broll` entries whose source id starts with `visual-`), full frame or as the upper panel of a split screen. In a split, the speaker plays below as `broll` entries of the main track's own source with `rect` `{ "x": 0, "y": 0.458…, "w": 1, "h": 0.541… }` at 9:16 (the lower half elsewhere), in step with it. A visual lasts at most 3.5 s full frame and 6 s split, and the speaker shows between two for at least a second.

- **Remove a card:** delete its entry in `cards`. When its `placement` is `panel`, also delete the speaker entries in `broll` with the same `start` range (their `start` within the card's `start` to `start + duration`), so the full-frame speaker shows again. A sound effect in `audio.sfx` at the card's `start` belongs to it: delete it too.
- **Remove a capture or footage:** delete its `broll` entry, and for a split the speaker entries beside it, as above; and its sound effect.
- **Change a card's text or numbers:** edit its `params`, as its JSON Schema in `packages/effects/src/cards.ts` allows; the render names any param that breaks it. Never put a number on a card that the speaker does not say.
- **Add a card:** `{ "card": "stat", "params": { "value": 3, "suffix": "倍", "label": "…" }, "start": …, "duration": 360000, "placement": "full" }`, `start` at the first word it illustrates (its `start` in `captions.lines[].words`), `duration` within the card's `seconds` (`min` to `max`), and clear of other cards, B-roll and overlays. `"placement": "panel"` splits the screen: then add the speaker below as one `broll` entry per main clip the card spans, `{ "source": <the main clip's source>, "in": <the main clip's in + (start − where that clip starts in the edit)>, "out": in + the length, "start": …, "rect": <the speaker rect above> }`, which plays in step with the main track. A card renders in a few seconds a second of it, and once rendered comes from the cache.
- **Credits:** the render writes `edit-v2.broll.txt` again from what the new version shows: each source's `credit`, and the logos and icons its cards draw.

## Change the music level, or remove the music

- **Level:** `audio.music[i].gainDb` is the music's level in dB; −3 more is about a third quieter. The music still ducks under speech by `ducking.depthDb`. The finished mix is normalised to `audio.loudness`, so the voice stays at the same loudness.
- **Remove:** delete `audio.music`. The video then has no `edit-v2.music.txt`.
- **Sound effects** are `audio.sfx`, each `{ "source", "start", "gainDb" }`: lower `gainDb` to make one quieter, or delete the entry.

## Change the look or the caption style

- **Look:** each clip of `main` and each `broll` entry of the speaker beside a split screen has `grade.look`, `{ "id": "clean", "intensity": 1 }`. The looks are `clean` (a gentle contrast lift), `warm` (soft, golden highlights, for people and vlogs), `cool` (firmer contrast, blue shadows, for tech and screens) and `film` (matte blacks, teal shadows, warm light). Set the same `id` on every clip; `intensity` from 0 to 1 blends it in. Delete `grade.look` for no look. Leave `grade.auto` and `grade.match` as they are: they correct and match the cameras.

  ```js
  for (const clip of [...p.main, ...(p.broll ?? []).filter((b) => b.grade)]) clip.grade = { ...clip.grade, look: { id: "warm", intensity: 1 } };
  ```

- **Caption style:** `captions.preset` is `bold`, `spotlight`, `sweep` (karaoke) or `boxed`.
