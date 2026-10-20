# @video-editor/schema

The files passed between the parts of the editor, defined as JSON Schemas (draft 2020-12), with TypeScript types generated from them, validators and time helpers.

| File | Written by | Read by | Schema | Example |
|---|---|---|---|---|
| Media index | `vework analyze` (Python) | the planner | [media-index.schema.json](media-index.schema.json) | [media-index.example.json](examples/media-index.example.json) |
| Music index: a track's beats, sections, loudness and licence | `vework analyze-music` (Python) | the planner | [music-index.schema.json](music-index.schema.json) | [music-index.example.json](examples/music-index.example.json) |
| `project.json`: the whole edit | the planner | the renderer; kept next to each output | [project.schema.json](project.schema.json) | [project.example.json](examples/project.example.json) |
| Progress lines | `pnpm edit` | the web page | [progress.schema.json](progress.schema.json) | [below](#progress-lines) |
| `shorts.json`: the shorts of `pnpm edit --shorts`, each one's stretch, title, description and hashtags | `pnpm edit --shorts` | the web page | [shorts.schema.json](shorts.schema.json) | [shorts.example.json](examples/shorts.example.json) |

The `description` in each schema explains its fields. This page covers what spans fields.

## Using it

```ts
import { loadJson, validateProject, type Project } from "@video-editor/schema";

const project: Project = await loadJson("edit/project.json", validateProject);
```

`validateMediaIndex`, `validateMusicIndex`, `validateProject`, `validateProgress` and `validateShorts` return the value typed, or throw a `SchemaError` that lists every problem with its JSON Pointer. `validateProject` also checks what a schema cannot express:

- Source ids are unique, and every source a project names exists and has a kind that fits: video or image for clips and colour references, video or audio for voice decisions, audio for music.
- Ranges run forward, crop and scale keyframes move forward in time, and caption words lie within their line.
- The first clip has no transition, and a clip is long enough for the transitions into and out of it.
- B-roll rects stay inside the frame (`x + w` and `y + h` at most 1); a crop lies at least partly on the picture, and a crop path changes its size, or whether it splits the area, only at a cut.
- A source has at most one voice decision, and an image's clips start at 0.
- The output frame rate has a whole number of ticks per frame, and the size matches the aspect.

**Projects from 0.4.0.** `validateProject` first reads a project as this version would have written it (`upgradeProject`). A project Fineframe 0.4.0 wrote keeps its cuts, framing, captions, B-roll, music and sounds, and loses what this version no longer draws:
- its motion-graphics `cards`, with the speaker clips that played below a panel card and the sound that started with each card;
- its `keyword` overlays.

Its caption presets `spotlight`, `sweep` and `boxed` are gone too: a project that used one is captioned in `bold`.

`upgradeProject` returns how many of each it took out, so a caller can say that planning the edit again gives it the new motion graphics.

## Time

`project.json` counts time in **ticks**, integers at 120 000 per second. Every common frame rate has a whole number of ticks per frame, NTSC rates included (30000/1001 fps is 4004 ticks), so frame times are exact and long timelines do not drift. A frame rate is a fraction, `{"num": 30000, "den": 1001}`.

The media index keeps seconds, as its Python producer measures them. The helpers in [`time.ts`](src/time.ts) convert; their doc comments say how each one rounds.

| Helper | Does |
|---|---|
| `secondsToTicks(s)`, `ticksToSeconds(t)` | Convert between seconds and ticks |
| `ticksPerFrame(fps)`, `frameToTicks(n, fps)` | When a frame starts |
| `ticksToFrame(t, fps, rounding)` | The frame at a time, by the `Rounding` the caller chooses |

## project.json

A project renders the same video every time from the file and the sources it names. Each source carries a fingerprint (size and SHA-256), so a changed file fails the render instead of shifting the edit. A source's sound is its first audio stream, the one its media index analysed for speech. `plan` records how the planner arrived at the edit; rendering ignores it.

**Two clocks.** Clip `in`/`out`, crop and scale keyframes, music `in`/`out`, the beat grid's downbeat and dropped ranges are in source time, which counts from the same time zero as the source's media index. An image has no time of its own: its clips run from 0 to how long it shows. B-roll `start`, graphics, captions, overlays, music and sound effect `start` and `plan.emphasis` are on the output timeline.

**The main track** plays its clips back to back. A clip starts where the one before it ends, except after a dissolve, which overlaps the two clips by its duration. So the edit lasts the sum of `out - in` over the clips, minus the dissolves' durations.

**Layers**, bottom to top: the main track, B-roll in array order, graphics in array order, overlays in array order, then captions, which are never covered.

**Frames.** Output frame *n* shows what is on the timeline at its start, `frameToTicks(n, fps)`. Something on screen from `start` to `end` is in frame *n* when `start <= frameToTicks(n, fps) < end`.

**Adding to it.** Sections a later feature fills (`broll`, `graphics`, `captions`, `overlays`, `audio.voice`, `audio.music`, `audio.sfx`, `framing`, `grade`, `plan`) are optional, so a project without them stays valid.

## Media index

`vework analyze` writes one per source. A later analysis adds its own optional top-level section: declare it under `properties` (not `required`) with its shape in `$defs`, then run `pnpm gen`. Indexes written before it stay valid. A field never changes meaning; a change that would break a reader bumps `version`.

## Progress lines

`pnpm edit` prints one JSON object per line on stdout. `fraction` never goes down, and the last line is `done` or `error`.

```json
{"stage": "analyze", "file": "footage/take-2.mp4", "fraction": 0.12, "message": "Downloading Qwen/Qwen3-ASR-0.6B-hf", "download": {"name": "Qwen/Qwen3-ASR-0.6B-hf", "bytes": 447724386, "total": 1576381331}}
{"stage": "analyze", "file": "footage/take-2.mp4", "fraction": 0.18, "message": "Transcribing 3/9"}
{"stage": "render", "fraction": 0.72, "message": "Rendering"}
{"stage": "done", "fraction": 1, "message": "Finished", "claude": {"plan": {"dollars": 0.07, "requests": 1}, "check": {"dollars": 0.012, "requests": 9}}, "outputs": {"video": "/work/out/edit.mp4", "project": "/work/out/edit.project.json", "captions": "/work/out/edit.srt"}}
```

With `--shorts`, the lines while a short is made name it, a `short` line says each one is done once `shorts.json` lists it, with what it cost, and the `done` line names `shorts.json` and adds what finding the moments cost as `claude.find`:

```json
{"stage": "render", "fraction": 0.41, "message": "Rendering 3/7", "short": {"n": 2, "of": 5}}
{"stage": "short", "fraction": 0.52, "message": "Short 2 of 5: 44.6 s, \"…\"", "short": {"n": 2, "of": 5}, "claude": {"plan": {"dollars": 0.12, "requests": 2}, "graphics": {"dollars": 0.19, "requests": 1}, "check": {"dollars": 0.01, "requests": 8}}}
{"stage": "done", "fraction": 1, "message": "Made 5 shorts in shorts", "claude": {"find": {"dollars": 0.21, "requests": 1}, "plan": {"dollars": 0.6, "requests": 10}, "graphics": {"dollars": 0.95, "requests": 5}, "check": {"dollars": 0.05, "requests": 40}}, "outputs": {"shorts": "/work/out/shorts/shorts.json"}}
```

## Changing a schema

Edit the `.schema.json` and the examples, then run `pnpm gen` at the repository root. It regenerates the types in `src/generated/` and the worker's models of the two indexes; CI's `pnpm check-gen` fails while any is out of date.
