# @video-editor/engine

Turns footage into a finished video with one command, [`pnpm edit`](#editing-footage): it has each file analysed, plans the edit with Claude from the media indexes, frames each clip for the output's shape, renders the resulting [`project.json`](../schema/README.md#projectjson) to an MP4 with burned-in captions by driving FFmpeg, and reviews every cut. What it measures is in [MEASUREMENTS.md](MEASUREMENTS.md).

## Editing footage

```bash
pnpm edit footage/ --length 60s --aspect 9:16 -o out/edit.mp4 --music music/
```

```text
footage/ ─▶ analyze  vework analyze, one file at a time, or its index from the cache;
music/                vework analyze-music for each track
         ─▶ plan     the planner (below) fits the edit to the length within ±5 %
         ─▶ render   the renderer (below)
         ─▶ check    the review: its fixes rendered again, at most three times
         ─▶ out/edit.mp4, edit.project.json, edit.srt, edit_cuts.json, edit.music.txt,
            edit.broll.txt
```

`pnpm edit --help` lists every option. What they do:

- **Inputs:** files, folders and links, where a folder stands for the files directly in it. Videos are cut. Still images (JPEG, PNG, WebP, BMP, TIFF) can show as B-roll for up to 8 s, which Claude places by their names alone. Audio files among the footage fail: music comes with `--music`. A video with a `<name>.project.json` beside it is an earlier edit and is not read as footage. The length is 15 s to 1 h, written as 60s, 90, 3m, 1m30s, 1:30, 1h or 1h30.
- **Links:** an `http` or `https` argument is a public video's page, such as a YouTube video's; other sites [yt-dlp](https://github.com/yt-dlp/yt-dlp) reads may work ([`src/link.ts`](src/link.ts)). Use only videos you have the right to use. Each one's video is fetched beside the output (with `--shorts`, in the shorts' folder) as `<title> [<id>].mp4`, or `.mkv` when the site's streams are not MP4's, never over an existing file, at up to 1080p on its shorter side and never re-encoded; it is then footage like a file. One link fetches one video: a playlist or channel link fails, as do private, members-only, age-restricted and live videos. yt-dlp runs with no configuration file and never reads cookies. It stays current: each link checks GitHub's latest release, downloads the standalone build for the computer when it is new, checks it against the release's `SHA2-256SUMS` and keeps it as `~/.cache/video-editor/yt-dlp-<hash>`; when GitHub cannot be reached, the newest kept is used. Stopping the command stops yt-dlp and FFmpeg and removes the partly fetched file.
- **A stretch:** `--within 612-671` (or `10:12-11:11`) cuts the edit from that stretch of the one video given; the planner reads only the lines said wholly inside it. A stretch past the file's end, or shorter than the length, fails before any analysis. `--short "<title>. <description>"` with it plans one short again as `--shorts` did: hook first, with no opening title.
- **Instructions:** `--instructions "<text>"`, at most 2000 characters, passes what the user wants of the edit ("open with the demo", "leave out the pricing") to every planning request, set apart in `<instructions>` tags: Claude follows it as far as the footage, the length and its rules allow.
- **Look:** `--look` names the [look](#colour) over the edit: `clean` unless another is named, or `none`.
- **Captions:** `--captions` names the [caption style](#captions), `bold` unless another is named. `--emoji` draws the emoji Claude picked for a caption line.
- **Brand kit:** `--brand <folder>` renders the edit in a [brand kit's](#brand-kits) look. The kit is checked before anything else runs, and its files are copied into `brand/` beside the video (with `--shorts`, in the shorts' folder). Its custom captions replace the caption style unless `--captions` names one. Nothing in a kit reaches Claude.
- **Visuals:** `--visuals rich`, the default, shows [what the speaker talks about](#visuals): motion graphics Claude writes for the edit, captures of the pages the speaker names and, with `PEXELS_API_KEY` or `PIXABAY_API_KEY` in the `.env` (both free, both optional), stock footage. `--visuals minimal` makes the edit without them.
- **Fillers:** `--fillers natural`, the default, has Claude cut hesitations (嗯, 呃, um, uh) and stutters (我我, the the); `aggressive` also words that are often verbal tics (啊, 喔, 欸, 那個, 這個, 就是, 然後, 對, like, you know, I mean, so opening a sentence, basically) where Claude finds they add nothing; `off` cuts no word inside a line.
- **Analysis** runs `vework analyze` in `worker/` with `uv run`, so uv installs the models' packages (the worker's default `ml` group) first if `uv sync` ([quick start](../../README.md#quick-start)) has not. `--names names.txt` (people's names) and `--terms terms.txt` (brands, jargon) reach vework together as `--glossary` with `--asr-context`; only the names reach the planner, as the people a lower third may show. `--correct` turns on [transcript correction](../../worker/README.md#transcript-correction). `--asr cloud` has the speech heard on OpenRouter with `OPENROUTER_API_KEY` from the `.env` ([cloud speech](../../worker/README.md#cloud-speech)); OpenRouter takes no context prompt, so the glossary then reaches vework only with `--correct`. Each index is kept in `~/.cache/video-editor/indexes/`, keyed by the file's SHA-256, those options, and the worker's code and lockfile (not its version number), with its [denoised speech](../../worker/README.md#voice) beside it. Another edit of the same footage, at any length or aspect, starts at the plan; a change to the worker analyses again.
- **Music** (`--music`, any number of times): `library`, the default, offers the built-in music library; audio files, or folders of them, offer the user's own tracks instead, and with `library` beside them both; `none` makes an edit without music. Claude may put one of the tracks offered under the edit. Use only music you have the right to use. Each track of the user's own has its licence as the first line of `<name>.txt` beside it, which may go on with a web address where its terms are and a credit line, for example:

  ```text
  CC BY 4.0
  https://creativecommons.org/licenses/by/4.0/
  "Song" by Artist
  ```

  `--music-license "CC0 1.0"` gives the licence of every track without its own file; a track with neither fails before any analysis. Each track is analysed with `vework analyze-music` and its index cached like the footage's, keyed also by its licence. When the beat model cannot be downloaded, the track is indexed without beats and plays from its start, the `done` line's `beatsSkipped` says so, and the next edit analyses it again.
- **Music library:** 40 instrumental CC0 1.0 tracks, 8 for each mood: calm, upbeat, emotional, corporate and energetic ([notices](../../THIRD_PARTY_NOTICES.md#music-library)). [`assets/music/library.json`](assets/music/library.json) lists each track's id, title, artist, mood, size, SHA-256 and origin, with its [music index](../../worker/README.md#music) beside it, so the library needs no analysis. The audio is on `downloads.fineframe.app`: a track downloads only when an edit plays it or the re-edit panel previews it, into `~/.cache/video-editor/music/`, checked against its SHA-256. A chosen track that cannot be downloaded, or does not match, leaves the edit without music rather than failing it (the `done` line's `musicSkipped` says why); `pnpm render --music` fails instead. [`scripts/music-library.ts`](scripts/music-library.ts) writes the indexes again from the published audio, after a track is added or the music analysis changes.
- **Claude:** the key is read as for [planning](#planning). Before any analysis the command looks up the planning model, which costs nothing, so a missing or wrong key fails at once. `estimateCost` in [`plan/estimate.ts`](src/plan/estimate.ts) gives a range for what Claude will cost, fitted to the [measured edits](MEASUREMENTS.md#edit-measurements). `--quality economy` plans, and judges the cut checks the review doubts, with `claude-sonnet-5-5` instead of `claude-opus-5-5`, for about half the cost; `best` is the default ([measurements](MEASUREMENTS.md#quality-measurements)).
- **Outputs**, beside the video: `<name>.project.json`, which renders the same video again; `<name>.srt`, the captions; the renderer's `edit_cuts.json`; with music, `<name>.music.txt`; and with B-roll or sound effects that carry a credit, `<name>.broll.txt`. Work files go to `.<name>.edit/` beside the video, removed when the edit ends. A file already at the output path fails the edit unless it is an earlier edit, with its `<name>.project.json` beside it, so footage is never written over.
- **Progress:** each step is one JSON line on stdout, as [progress.schema.json](../schema/README.md#progress-lines) defines it, naming its stage (`analyze`, `plan`, `render`, `check`), the file being analysed and, with `--shorts`, the short. While something downloads on first use (a model, the pinned FFmpeg, a library track, Chrome Headless Shell and ffprobe, a link's video, a new yt-dlp), the lines carry its name and bytes as `download`. The `done` line, and an `error` line after a Claude request, carry what Claude cost so far by stage as `claude`. After an `error` line the command exits with 1, or with 2 for arguments it cannot use. Lines for a person go to stderr: each step, the review's findings, and at the end the time each stage took and what Claude cost. `pnpm -s edit` leaves out pnpm's banner on stdout.
- **Several shorts:** `--shorts 5 --length 30-60s -o out/shorts` makes up to 5 shorts (1 to 10) from one long video instead of one edit, each from one continuous stretch of one file; several files count as one recording split in order. The range is 15 s to 3 min. One request to the planning model reads every transcript and lists the moments that stand alone, best first, each with a length within the range, a title, a description and 3 to 5 hashtags in the footage's language (Taiwan Traditional Chinese for Mandarin), at most one per 2 minutes of footage ([`plan/moments.ts`](src/plan/moments.ts)). Each of the best is then edited as a short, hook first, from its stretch alone, into `out/shorts/01/edit.mp4`, `02/`, … with the outputs above; a moment that cannot be cut to a length in the range is left out and the next one made instead. `shorts.json` beside the folders ([schema](../schema/shorts.schema.json)) lists each short as it is done. Claude's cost is held to $1 for finding the moments in each hour of footage, $1 for each short, and in all the finding's limit plus $1 for each short asked; past one, the run ends with the shorts made and `shorts.json` says `"stopped": "cost"`. The output folder must be new or empty. `estimateShortsCost` in [`plan/estimate.ts`](src/plan/estimate.ts) gives a range for the run.
- **Failures** that the inputs cause say what to change: a length out of range, a link that cannot be imported, no video among the inputs, an audio file among the footage, a track without a licence, an image FFmpeg cannot decode, a file vework cannot read, a missing or wrong key, an output path that holds footage, and a length the footage cannot reach. A Claude request that fails after the analysis says the analysis is kept, so running the edit again starts at the plan.

## Planning

```bash
pnpm --filter @video-editor/engine plan footage/ --length 60 --aspect 9:16 -o edit/project.json \
  --music music/
```

The inputs are media indexes, or folders whose `*.index.json` and `index.json` files are read; each index's source file is the one it names, next to it. From code, `{ index, source }` names an index kept apart from its file, as `pnpm edit` keeps them, and `{ image }` a still to show as B-roll. `--music` offers music indexes from [`vework analyze-music`](../../worker/README.md#music), or folders of `*.music.json`, each next to its track. Claude needs `ANTHROPIC_API_KEY`, which the command also reads from the git-ignored `.env` at the repository root. It prints the project's path, its length and what the requests cost.

```ts
import { plan, review } from "@video-editor/engine";

const edit = await plan({ inputs: ["footage/"], length: 60, aspect: "9:16", out: "edit/project.json" });
// Render edit.path to out/edit.mp4, then review it; render again while a review changes the
// project.
const { changed } = await review(edit, "out/edit.mp4");
```

```text
media indexes ─▶ pack.ts     one transcript per file: numbered lines, filler candidates marked
              ─▶ claude-opus-5-5 (or claude-sonnet-5-5 at economy quality), structured output:
                 segments in story order, each with a
                 priority; retakes and mistakes left out; fillers and false starts to cut;
                 B-roll; emphasis; effects
              ─▶ locate.ts   each callout's thing boxed on its frame ─▶ claude-haiku-5-5, cached
              ─▶ place.ts    clips cut only in silence, on the frame grids, clear of clicks and shot changes
              ─▶ fit.ts      the length nearest the target, by priority
              ─▶ music.ts    the chosen track on its phrases, under the speech, B-roll on its beats
              ─▶ effects.ts  the effects timed on the speech, one at a time
              ─▶ visuals.ts  each visual sourced, timed on its words, laid out full frame or split,
                             clear of the effects; the effects again, kept off the visuals
              ─▶ graphics.ts the edit's motion graphics, written by Claude once the cut is known,
                             timed on their words, checked as drawn, fixed once or left out
              ─▶ captions, plan.dropped, colour (grade), punch-ins (framing.scale),
                 a voice chain per source and the loudness for the aspect (see Voice)
              ─▶ project.json
render ─▶ review.ts  a strip around each cut ─▶ claude-haiku-5-5, doubtful ones to the planner's model
                     ─▶ fixes ─▶ fit again ─▶ project.json
```

**What Claude reads.** Each file is packed into numbered `[start-end] text` lines, split on pauses and at sentence ends, with possible fillers marked by an id (hesitations, words said twice at once, and with `--fillers aggressive` the verbal tics; `--fillers off` marks none). A header gives the file's length, frame size and rate, shot changes, share of speech, long pauses, loudness peaks and audio events. A file without speech, and a still image, is offered as B-roll by its name. A file's id is its name, made unique and safe (`file-1`, … when no character of it is allowed). The packed transcripts are a cached prefix, so a second request for the same footage reads them cheaply.

**What Claude decides,** with `claude-opus-5-5` at high effort (`claude-sonnet-5-5` with `quality: "economy"`) and a JSON Schema for its answer: the segments to play, as runs of lines in story order, each with a priority from 1 to 5; lines left out as retakes, mistakes or off-topic; which marked words are fillers, plus fillers and false starts the marks missed; B-roll; [visuals](#visuals); the moments to emphasise (`plan.emphasis`), which get a push-in; and effects. A target under half the footage's speech asks for its strongest self-contained moments; a longer one keeps the whole story with the best take of each line. Code ignores any line number or id that does not resolve.

**What code does** (`place.ts`, `stem.ts`). Every cut falls in silence: between words, and outside speech the transcript missed but the source's [voice stem](../../worker/README.md#voice) holds. A cut keeps a margin from the sound on both sides, and dead air over 0.75 s inside kept speech is cut down to that breath. A filler is cut only where both sides allow it: a long enough silence, or a dip in the denoised speech deep enough to place a sound edge (`joinAt`); otherwise it stays, since cutting there would clip the words beside it. A clip's opening or closing silence moves past any click in the source's sound or shot change in its index, so a cut never lands on the source's own splice. Each clip starts on one of its source's frames and lasts whole output frames; a cut in a silence shorter than a frame cuts the sound at the cut itself (`soundIn`, `soundOut`) while the picture cuts on the frame.

**Length** (`fit.ts`). A target longer than the footage's speech allows fails before any request and says the longest it allows. Claude is asked for about 1.25 times the target; code then drops or trims segments by priority and stretches or shrinks the breaths at the joins to land nearest the target within ±5 %. An edit still short gets one more request; still short after two, the planner fails and says how long the edit came out. `plan.fit` records the length, and `plan.dropped` every stretch of a source left out, with why: a filler, a pause, a retake or mistake, a lower priority, or not chosen.

**Captions** are the kept words on the output timeline, one line per transcript line or sentence, tagged `zh-TW` or `en`. A Chinese line drops its commas and full stops, as Taiwanese subtitles do; English words stay in English. Edits start with the `bold` style unless `--captions` names another. Laying them out is the [caption renderer's](#captions).

**Music** (`music.ts`). Claude picks the track whose mood, tempo and sections fit the content, and the section the edit opens on; from the library, it answers none only when the user's instructions ask for no music. Code fits the track on its phrases (4 bars from a section's start), entering on a bar line, skipping or looping whole phrases with short cross-fades on the downbeats, and ending on the track's own ending at the edit's last frame. The music sits 6 LU under the speech's loudness in pauses and 18 LU under while anyone speaks, ducking just before speech starts; the renderer takes it further down under quieter speech ([below](#how-it-renders)). B-roll edges move onto the nearest beat within 150 ms. Each music range records the track's licence.

**Effects** come from the [effect templates](../effects/), sparingly: Claude decides which moments get one and what it says, and code times and checks it (`effects.ts`).
- **A title** over the opening of an edit of a minute or more that keeps the whole story. A short edit opens on its hook instead.
- **Chapters** in an edit of two minutes or more, each marked with the chapter template and a wipe on the cut into it; at least 30 s each, at most 12, and none when fewer than three remain.
- **Lower thirds** with a person's name and role, only when names are given (`--names`), only a name from that list, and only while that person is on screen talking.
- **Callouts** on screen recordings: Claude names the thing on screen and `claude-haiku-5-5` boxes it on the frame (`locate.ts`), cached under `~/.cache/video-editor/regions/`. The box is outlined for 3 s, at most three a minute, only when it holds still across the clips under it.
- **One at a time,** title first, then chapters, lower thirds and callouts. An effect that would overlap another, run too short, or break its template's params is left out.

**Output.** The requested aspect at the largest of 1080, 720, 540 or 360 lines that the footage fills, at the frame rate of the file with the most speech, or 30 fps when that file runs slower than 23.976 fps.

**Framing** (`punch.ts`). Each clip, B-roll included, is framed by [`cropPath`](#framing). The planner then sets each main-track clip's `framing.scale`: it zooms only as far as the footage has pixels to spare (or to the punch-in, 125 % at 16:9 and 112 % at 9:16 and 1:1), about the face of whoever speaks most during the clip (`framing.anchor`), never so far that the head leaves the frame. A screen recording or a shot without a face shows wide.
- **Jump cuts.** At a hard cut between two clips of one shot of one source, the framing alternates between wide and the punch-in, the way an editor hides a jump cut. A clip that plays on from where the one before stopped keeps its framing.
- **Long shots.** At 16:9, a shot with a face held in one framing for more than 8 s changes to the other framing at a gap between words.
- **Push-ins.** A clip pushes in slowly on each `plan.emphasis` moment that starts in it, up to 6 %, eased in and out.

**Colour.** `grade.auto` is measured for each clip with `autoGrade`, the main track's sources are matched to the one it uses longest, and the look goes on every clip: `clean` unless `plan()` is given another `look`, or `null` for none. [Colour](#colour) says how.

**Self-review** (`review.ts`). After each render, every cut gets a picture of the two seconds around it: eight frames over the waveform, the cut marked and silences shaded. `claude-haiku-5-5` reads it with the words on both sides and reports a clipped word, a broken sentence, a long silence or a bad frame, with a fix. A check under 0.7 sure, or one that would drop a clip, goes to the planning model. A fix keeps more silence beside a clipped word, moves the cut to the next pause, puts back a filler, or drops a clip; the length is then fitted again. A review that changes nothing ends the loop, and an edit gets at most three.

### Visuals

A rich edit (`visuals: "rich"`, the default; `pnpm edit --visuals`) shows what the speaker talks about: the real thing they name, as stock footage or as its web page zoomed into the part talked about, and motion graphics for the keywords, numbers, comparisons and lists they say. The plan proposes the footage and the pages (`visuals.ts`); once the cut is known, Claude writes the graphics (`graphics.ts`). Whatever code cannot use is left out, so its line keeps the speaker, and stderr says why.

- **What the plan may propose:** `stock`, a search for footage of a physical thing or scene (only with `PEXELS_API_KEY` or `PIXABAY_API_KEY`); `web`, the page of a product, project, paper or organisation the speaker names in that line, with the words on it to zoom into; `sfx`, a sound for a visible action.
- **Checks:** a page must be public http or https, not a search page, named in its line, and show the words asked for once [captured](#b-roll-sourcing). Each visual is sourced once per plan.
- **Timing:** a visual cuts in on its first word, at most one every 5 s of the edit, clear of the effects and other B-roll; a capture lasts 4 s, footage up to 3.5 s.
- **Layout:** full frame for at most 3.5 s. At 9:16 a capture, or a longer visual, splits the screen for up to 6 s: the visual in the top 880 of 1920 rows and the speaker below. A still pushes in by 8 % over its time on screen.
- **Sound:** a visual that asks for one gets the next sound of that kind from the [CC0 set](#b-roll-sourcing), at most one every 6 s, under the voice and not ducked.
- **Credits:** each capture, clip and sound carries its `credit`; the renderer writes those the video plays to `<name>.broll.txt`.

**Graphics** (`graphics.ts`). Once the edit is fitted, one request with the planning model at medium effort writes all its graphics (one per 3 minutes of a longer edit). It gets the edit's timed words, where captions and faces are, where the picture already changes, and the stretches no graphic may cover; it answers, for each graphic, its [layout](../effects/README.md#graphics) (a corner label, a lower third, a panel at 9:16, or the full frame), the words it lands on, how long it stays, a sound, and its HTML and CSS in the [house look](../effects/README.md#look). Graphics show only keywords, numbers, comparisons or lists the speaker says, never the sentence being said; full-frame graphics take at most a quarter of the edit.

Code then places and checks each one:
- **Timing:** a graphic starts 0.4 s before its words, for as long as its layout allows (`GRAPHIC_SECONDS`), and is left out when its words were cut or it would crowd the one before, B-roll or an effect.
- **Checks:** each graphic is drawn in Chrome against the captions and faces under it ([checks](../effects/README.md#graphics)). Each word it shows must be said within 20 s before or 10 s after it, it may not restate the phrase being said, and a logo must be of a brand named nearby.
- **Cadence:** stretches where nothing new comes into the picture for longer than 8 s at 16:9 or 4 s at 9:16 are found.

The graphics that fail, and those still stretches, go to Claude once, together, to fix or fill; what still fails is left out. After a review fits the edit again, the graphics are placed and checked again without another request. A request that fails leaves the edit without graphics there. Icons and logos a graphic draws are credited in `<name>.broll.txt`.

## Rendering

```bash
pnpm render edit/project.json -o out/edit.mp4
```

The command renders a project as it is, after validating it: a project that breaks the schema, or what the schema cannot express (see [`packages/schema`](../schema/README.md#using-it)), fails with every problem by its JSON path. From code:

```ts
import { writeFile } from "node:fs/promises";
import { autoGrade, loudnessFor, planVoice, render } from "@video-editor/engine";

// The planner measures each clip's correction into grade.auto and chooses each source's voice
// chain (audio.voice) before rendering, at the loudness for the video's shape.
project.audio.loudness = loudnessFor(project.output.aspect);
const planned = await planVoice(await autoGrade(project, "edit/project.json"), "edit/project.json");
await writeFile("edit/project.json", JSON.stringify(planned));
const result = await render("edit/project.json", "out/edit.mp4", {
  onProgress: (fraction, message) => console.log(fraction, message),
});
```

Beside the video it writes:

- **`<name>.project.json`:** the project, with its paths rewritten for its new folder, so the same video can be rendered again.
- **`edit_cuts.json`:** where each main-track edit falls in the video, in seconds, as [vebench](../../bench/) reads it.
- **`<name>.srt`:** the captions as SubRip, when `captions.srt` is set, on the same frames as the picture shows them.
- **`<name>.music.txt`,** with music: each track's file, licence and the credit its licence asks for, ready to paste where the video is published. A library track also says, in English and Taiwan Chinese, that a platform's claim on it is disputed with its CC0 licence.
- **`<name>.broll.txt`,** when the video shows B-roll or plays sound effects whose sources carry a `credit`: where each came from, its licence and any note it must carry.

The `stems` option also writes the mix's parts into a folder before loudness normalisation: `voice.wav` (the main track and B-roll sound) and `music.wav` (the music as ducked), which `vebench mix` and the review read.

A video only B-roll shows, muted, needs no media index. Every other video source needs its media index from `vework analyze`: the renderer reads the sound, the colour tags and the frame rate from it, and a voice chain that denoises plays the denoised speech the index names. A source whose size or SHA-256 differs from its fingerprint fails the render.

### Changing an edit

A finished edit changes by changing its `<name>.project.json` and rendering it again, without analysing or planning again. The [agent skill](../../skills/video-editor/SKILL.md) has the recipes an agent follows for each kind of change. Each option below writes the edit as changed to `<name>.project.json` beside the new video.

```bash
pnpm render out/edit.project.json --cut 29-33 -o out/edit-v2.mp4
```

- **`--music <id>`** plays that [music library](#editing-footage) track under the edit instead ([`library.ts`](src/library.ts)), fitted and ducked as a plan fits it, with the B-roll's edges moved onto its beats; `--music none` takes the music out.
- **`--brand <folder>`** renders the edit in that [brand kit's](#brand-kits) look, its files copied into `brand/` beside the video; `--brand none` in the house look.
- **`--cut <from>-<to>`**, in seconds or minutes:seconds of the rendered video, takes that stretch out ([`cut.ts`](src/cut.ts)), any number of times:
  - A word goes when its middle falls in a stretch; a stretch that takes out no word fails. Each edge moves inward to the nearest pause a cut fits in, so no word goes that was not asked for; only a stretch with no such pause grows outward, and stderr says which words that took. A clip that loses words from inside it splits around them, its new ends placed as the planner places cuts.
  - Caption words that went leave their lines; overlays and B-roll move up with the speech, and go when all of their time went; music plays on without a gap. stderr lists what was cut and any overlay that overlapped a cut.
  - A cut that leaves the edit outside the tolerance of `output.target` fails and prints the new length; `--retarget` makes that length the target instead.

### Exporting to an editing app

```bash
pnpm render out/edit.project.json --export out/edit-export
```

`--export` writes, instead of a video, what Final Cut Pro, DaVinci Resolve and Premiere Pro open to finish the edit there ([`src/nle/`](src/nle/)), into a folder that must be empty or new:

- **`<name>.fcpxml`** (FCPXML 1.8, for Final Cut Pro and Resolve) and **`<name>.xml`** (Final Cut Pro 7 XML, for Premiere Pro): the same timeline, every clip on exactly the frames the render shows it, at every frame rate, NTSC included.
- **`<name>.srt`:** the captions, as the render writes them.
- **`media/`:** copies of the B-roll, music and sound effects, and `overlay.mov` when the edit has graphics, effect overlays or a watermark: those alone, drawn over transparency in ProRes 4444 with alpha, the length of the edit. The main-track footage and the owner's own B-roll (sources without a `credit`) are not copied: the timelines name their absolute paths.
- **`README.txt`:** the same, in English and Traditional Chinese.

What the timelines hold:

- **Main track:** each clip with its sound; a dissolve becomes a cross dissolve, a dip a cut.
- **Framing:** one fixed position and scale per clip, the mean of what its crop and punch-in show; a clip whose framing cuts is split there. The halves of a split screen are two clips.
- **B-roll** on the tracks above, each at its rect with its sound; then `overlay.mov` on top.
- **Music and sound effects** on tracks of their own at their gains, with the music's fades and ducking as level keyframes.
- **Left out:** the grade, the voice chain, loudness normalisation, the blurred fill where a crop reaches past the picture, B-roll fades, the short fades at cuts, and the extra ducking under quiet speech.

## What it renders

| `project.json` | |
|---|---|
| Main track: cuts, dissolves (picture and equal-power sound), dips to a colour | ✅ |
| `framing`: a static crop, a crop path that pans ([framing](#framing)), a punch-in scale and an eased push-in, both about an anchor | ✅ |
| `grade`: `auto`, which `autoGrade` measures, then `match` and `look` through one 3D LUT | ✅ |
| `broll`: full frame or in a rect, with fades, and its own sound at `gainDb` | ✅ |
| `audio.loudness` | ✅ |
| `audio.music`: ranges of tracks with fades, a gain and ducking under speech | ✅ |
| `overlays`: the [effect templates](../effects/), on exactly the frames each covers | ✅ |
| `graphics`: the [motion graphics](../effects/README.md#graphics), as labels and lower thirds over the picture, in the upper panel of a split screen or full frame, on exactly their frames | ✅ |
| `audio.sfx`: sound effects, mixed with the music and not ducked | ✅ |
| `captions`: [animated, word by word](#captions), and as SubRip | ✅ |
| `audio.voice`: each source's [voice chain](#voice) on the main track | ✅ |
| `brand`: a [brand kit's](#brand-kits) colours, fonts, watermark and custom captions | ✅ |

A project that uses something not rendered yet fails with its JSON path, instead of rendering without it.

**Sources:** phone footage with a rotation matrix comes out upright, and footage with non-square pixels in its displayed shape. Every frame rate, variable rates included, is retimed to the project's. PQ and HLG footage is tone-mapped to BT.709. Footage that does not say which colour matrix it uses is read as BT.709 at HD sizes and BT.601 below. A source without sound, or with a silent track, plays silence.

**Output:** H.264 High at CRF 18, 4:2:0, tagged BT.709; AAC at 192 kb/s and 48 kHz; the index at the front of the file for streaming.

## Framing

`cropPath` turns the faces and speakers in a media index's [`framing`](../schema/media-index.schema.json) into the crop for one clip, in the shape of the box it fills: the output frame, or a B-roll rect. The planner writes it into every clip it places, as:

```ts
import { cropPath } from "@video-editor/engine";

const crop = cropPath(index, clip, project.output); // clip.in and clip.out in source ticks
if (crop) clip.framing = { crop };
```

It returns nothing when the index has no `framing` or the box already has the source's shape. The source's shape is as displayed, from the index's `sample_aspect`; the planner and the renderer refuse an index without it, asking for `vework analyze` again.

- **What it frames,** shot by shot, from the shot's layout:
  - a shot without a face, such as a product, scenery or a screen recording (`screen`, `screen_cam`): the whole picture, still, over a blurred copy of itself that fills the rest of the box;
  - one person (`talking_head`): the face that speaks, or the biggest one;
  - two people side by side (`two_shot`) who both talk, in a portrait box: a split screen, the left one in the top half and the right one in the bottom half, when each fits there; otherwise followed in turn, as below;
  - two people (`two_shot`) or more (`group`): everyone, when their faces fit with room around them; otherwise whoever speaks, held through pauses until someone else speaks for a second and a half;
  - a video call: the window of whoever speaks, as large as the box's shape fits in it. `plan/windows.ts` finds each face's window on a plain background, once per shot.
- **How it frames a face:** the whole head in, with room above it and the eyes a third of the way down. Where the picture runs out (a head cut off at the top, or a face too close to fit), the crop reaches past the picture's edge and the blurred copy shows there.
- **How it moves:** it holds still while the subject stays within a dead zone around the crop's centre, and beyond it re-centres with an eased pan under a top speed. A switch to a speaker far away, or to another crop size, and a shot change cut instead of panning. A median over a few samples drops single-sample detector jumps.

The path depends only on the source, so two clips cut from one shot frame it the same way. `CAMERA` holds the dead zone, top speed and acceleration; the fourth argument overrides them, and the fifth gives each face's window in a video call.

**Rendering a path:** FFmpeg's crop filter evaluates the path at every output frame, in whole source pixels; a cut is two keyframes one tick apart, so no frame falls between them. Where a cut changes the crop's size, splits the frame or stops splitting it, or steps the scale, the clip's picture is drawn in stretches joined end to end. A split screen whose halves reach past the picture, or zoom, is refused.

## Captions

`captions.lines` are drawn over the finished picture by libass in the style `captions.preset` names ([`src/captions/presets.ts`](src/captions/presets.ts)):

| Style | Type | Words |
|---|---|---|
| `bold` | Heavy white type with a dark stroke and a soft shadow; a caption settles in from 90 % | the word being spoken turns amber |
| `creator` | 1.4 × the size, heavy white type in a dark rounded box, one row of at most 6 Chinese characters' width and 3 English words; each caption pops in from 80 % | numbers, and English words in a Chinese line, are amber |
| `minimal` | 0.72 × the size, bold white type with a thin dark stroke and a soft shadow | no highlight |
| `pop` | As `bold`, 1.05 × the size | each word appears as it is said, shrinking from 125 % to its size, where the finished row puts it, so the row never moves |
| `none` | Nothing on the picture | the SubRip file is still written, broken as `bold` breaks it |

The style is the render's alone: changing `captions.preset` re-renders with no new plan, so graphics are planned clear of where every style would draw.

**Size and place.** The type is sized from the frame's shorter side, times the style's size:

| Aspect | Type size | Longest row | Rows | Bottom of the last row |
|---|---|---|---|---|
| 9:16 | 7 % of the width | 10 Chinese characters | 2 | 72 % down |
| 1:1 | 6 % | 12 | 2 | 86 % down |
| 16:9 | 5.8 % of the height | 16 | 1 | 90 % down |

At 9:16 the rows stay clear of the bottom 22 %, where short-form apps draw their buttons and description. A caption that would cover a face (from the media index's `framing`, through each clip's crop and punch-in), a split screen's panel or a full-frame graphic moves just above or below it, within its aspect's band, and the next caption in the same shot keeps that place.

**Line breaking.** Each line is split into captions of one or two rows: at its pauses first, otherwise between words (Chinese where `Intl.Segmenter` ends a word, English at spaces), never with closing punctuation at a row's start or opening punctuation at its end, nor inside a number, and into rows as even as those breaks allow.

**Timing.** A caption shows from the first frame of its first word, one at a time, and a line's last caption stays up 0.5 s after its last word unless the next line starts sooner. Each word is lit from its first frame until the next word starts. Captions after and before a pause fade in and out; back-to-back captions switch at full strength. Every caption and highlight lands on exactly the frame it was laid out on, at every common frame rate.

**Font.** Noto Sans CJK TC (OFL-1.1), Bold and Black, downloaded on first use from a pinned commit, checked against its SHA-256 and kept in `~/.cache/video-editor/`. The render hands libass the face files itself, whatever fonts the machine has; a line with a character they lack fails the render, naming the line.

**Emoji.** The planner may pick one emoji for a transcript line (`captions.lines[].emoji`); with `captions.emoji` on (`pnpm edit --emoji`), the render draws it after the line's last caption from Noto Color Emoji (OFL-1.1), and the SubRip file writes it. Only a single emoji character is drawn. The switch changes with a render alone.

**Samples.** `node scripts/caption-samples.ts <project.json> <folder>` renders a planned edit in every style that draws, at every aspect, each with a strip of eight frames on which a word starts, labelled with the frame, its time and the word.

## Brand kits

A kit is a folder: `kit.json`, which [`project.json`'s `brand`](../schema/project.schema.json) has the shape of, and the logo and fonts it names ([`src/brand/kit.ts`](src/brand/kit.ts)). The render applies it alone, so an edit's kit changes with a render and no new plan.

- **Checks:** each file must lie inside the kit's folder. A logo is a PNG of up to 10 MB and 4096 pixels a side, or an SVG of up to 2 MB that holds only shapes, text, gradients, clips and references inside itself: anything that could run or load something (a style, a script, an event handler, a `foreignObject`, an image, a doctype, a reference to another file) is refused ([`svgProblem`](../effects/src/logo.ts)). An SVG is drawn to a PNG in the guarded Chrome the graphics render in ([`rasterizeSvg`](../effects/src/raster.ts)) and kept in `~/.cache/video-editor/brand-logos/`. A font is a TrueType or OpenType file of up to 64 MB, read by the engine's own parser ([`readFace`](src/captions/fonts.ts)); a family name holding a comma, a brace or a backslash is refused.
- **Copies:** an edit copies the files into `brand/`, each named by its content's SHA-256, and records the hashes in `brand`; a render fails on a file changed since.
- **Colours:** primary replaces the amber accent (`#ffb547`); secondary and accent replace its deeper and lighter tones, made from the primary when left out. The [effects](../effects/README.md#brand-kits) recolour every amber of their pages, and the captions light their words in the primary. Text that would fall under 3:1 contrast is white or black instead.
- **Fonts:** one of eight open faces that cover Traditional Chinese, downloaded on first use from a pinned commit and checked against its SHA-256 into `~/.cache/video-editor/brand-fonts/` ([`src/brand/faces.ts`](src/brand/faces.ts)), or a file of the kit's own. Graphics and titles are set in the first; captions in the second. A character a face lacks is drawn in Noto Sans TC.
- **Watermark:** with `logo.show`, the logo is laid over every frame, under the captions, in its corner of the overlays' safe area, sized by `logo.size` and at `logo.opacity`. It is left out of the frames where a graphic or template overlay meets its box, so it never covers their text ([`src/graph/watermark.ts`](src/graph/watermark.ts)).
- **Custom captions:** one of the four drawn styles with its size (80, 100 or 125 %), its text and highlight colours, a dark outline or the creator style's box, its place (the aspect's bottom, the middle, or the top of its band) and one or two rows. Custom captions also keep clear of the labels, lower thirds, titles, chapter markers and callouts on screen.

## How it renders

```text
project.json ─▶ timeline.ts  every clip and overlay on the output frame grid, in whole frames
                             and samples
             ─▶ effects      each overlay and graphic rendered by @video-editor/effects, or taken from
                             its cache
             ─▶ pieces.ts    one piece per clip body, one per dissolve, B-roll and overlays split
                             between them
             ─▶ sound pass   each piece's FFmpeg runs its clips' voice chains and writes its
                             samples into one PCM file
                             ─▶ music bed: every music range, ducked, into a second, added to it
                             ─▶ loudnorm measures the mix ─▶ loudnorm normalises it into another
             ─▶ picture pass each piece's FFmpeg writes raw frames into one encoder,
                             which takes the finished sound from that file ─▶ out.mp4
```

- **No join after encoding.** Pieces are never encoded alone, so there is no `-c copy` join and no encoder padding at a cut. The whole edit is encoded once.
- **Bounded memory.** Each piece's FFmpeg opens at most two clips plus the B-roll and effect overlays over it.
- **Exact lengths.** Clip boundaries are rounded to output frames along the whole edit, so rounding never adds up. Every span is retimed to exactly its frame count and sample count, and the render fails if the encoder counts any other number of frames.
- **Overlays counted onto frames.** An overlay is rendered for exactly the frames it covers and laid on them by frame count, not by its file's timestamps, so it lands on the right frames at any rate, NTSC included.
- **One time zero.** Each source is opened at the time zero its media index records, so picture and sound line up with the index's word times. A clip's sound split between pieces is cut from one decode, so the halves join sample for sample.
- **Clicks at cuts.** Every hard cut gets a 5 ms raised-cosine (`hsin`) fade out and in ([measured](MEASUREMENTS.md#render-measurements)); a sound edge on speech (`soundIn`, `soundOut`) fades over 20 ms. Dissolves cross-fade the sound with quarter-sine curves.
- **Graphics** are rendered at the size of what they fill (a label or lower third at its box with alpha, a panel or full-frame graphic opaque) and laid over the B-roll by frame count; a full-frame graphic slides in from the right, a panel down from the top.
- **Music.** Each range is faded and set to its gain, and ducked by a gain envelope computed beforehand from where the media indexes found speech, so it starts down before speech starts. Under speech quieter than the edit's as a whole, the music goes down by the difference too, up to 12 dB. The bed is added before loudness is measured, so normalisation keeps the voice's lead.
- **Loudness.** Two-pass loudnorm to the project's target, as a linear gain when the true-peak ceiling allows it (`result.loudness.linear` says which happened). The finished sound is then encoded and its true peak measured; while it is over the target, the mix is normalised again through a 4× oversampled limiter, after at most six tries. `result.loudness.truePeakDbtp` is the encoded sound's true peak.
- **Auto grade** is measured on up to ten frames of each clip after tone mapping; every value stays within a few percent of 1.
- **Push-ins** zoom with sub-pixel precision (`perspective`), so they glide rather than step a pixel at a time, and carry on across pieces.
- **Match and look.** Each pair of a match and a look becomes one 33-point 3D LUT, applied after the auto grade in 32-bit float RGB.

## Colour

### Matching

Shots from different cameras or phones in one edit are brought toward one reference: the video source the main track uses longest (`match.ts`).

- **Measured as shown:** up to ten frames of each clip, framed as the output frames them, after its auto grade.
- **A camera run backwards:** the correction (`grade.match`'s matrix and offset) is a luma-keeping saturation matrix, then a gain and an offset per channel, which covers white balance, exposure, contrast and saturation. It is fit from the two sources' colour distributions, so no pixel of one needs to correspond to a pixel of the other.
- **Only what a camera could do:** a source is left as it is when the best fit still leaves a residual over 0.02, which means the two show different things rather than one thing through two cameras (a wide shot and a close-up of one scene count as different), or when it needs gains outside ×0.67–1.5, a white balance shift past ×0.67–1.5 between channels, a saturation outside ×0.7–1.4 or an offset over 0.15. One scene through different cameras fits within 0.005; different footage leaves 0.037 or more, even two files drawn with the same colours ([measurements](MEASUREMENTS.md#colour-measurements)).

### Skin tones

A colour counts as skin by its CIELAB hue (within 20° of 50°, fading out by 35°), chroma (10 to 45) and lightness (20 to 90), with soft edges so the protection draws no contours. Where a colour is skin, a turn of its hue and a change of its chroma are limited, and its lightness is not:

- **By a match:** 15° and ×0.5–2: undoing a camera's white balance turns skin by up to 12° and changes its chroma by ×0.7–1.8 on the [colour measurements'](MEASUREMENTS.md#colour-measurements) synthetic cameras, and faces are what has to agree.
- **By a look:** 3° and ×0.9–1.1, so its warmth reaches the face without turning it orange, grey or green.

### Looks

One look over the whole edit, from `looks.ts`, at an intensity from 0 to 1. Each is a tone curve on L*, a chroma trim and at most a gentle split between shadow and highlight colour, thinning out towards black and white.

| Look | For | What it does |
|---|---|---|
| `clean` (default) | Any edit | A gentle S-curve, about 4 % more mid-tone contrast, 3 % more chroma, white kept white, no tint |
| `warm` | Vlogs, lifestyle, people on camera | Lifted blacks, softer contrast, amber highlights (b* +5) and slightly warm shadows |
| `cool` | Tech, business, screen recordings | Firmer contrast, shadows towards blue (b* −4), 5 % less chroma |
| `film` | Story pieces | Matte blacks (L* 5), highlights rolled off to L* 96, teal shadows and amber highlights, 12 % less chroma |

## Voice

[`voice.ts`](src/voice.ts) chooses each source's chain from what vework measured on its speech, as recorded and denoised ([worker](../../worker/README.md#voice)), and `planVoice` writes the decision with those measurements into `audio.voice`.

| Stage | When | How hard |
|---|---|---|
| Denoise | The speech is less than 55 dB above the room, the room reverberates, or there is too little pause to measure the room | 6 to 30 dB, more for a noisier or more reverberant room |
| De-reverb | The denoised speech still reverberates for 0.35 s or more | An expander under the speech, deeper the longer the tail, at most 12 dB |
| High-pass | Always | 80 Hz |
| EQ | Low-mids or presence off their targets | A cut at 300 Hz of at most 4 dB; -3 to +4 dB at 3.5 kHz, never a lift on a clipped recording |
| Leveller | A loudness range of 8 LU or more: a speaker who moves or turns away | Evened over 3 s windows, raising by at most 12 dB |
| Compressor | Always | 2:1 to 3:1 as the loudness range grows; makeup brings every source's speech to -20 LUFS |
| De-esser | Always | Above 6 kHz |
| Limiter | Always | Peaks held 11 dB over the speech, so the loudness pass reaches its target with one gain |

`loudnessFor(aspect)` gives the loudness the loudness pass normalises to: -14 LUFS for 9:16 and 1:1 and -16 for 16:9, both at -1 dBTP.

**Rendering a chain** ([`graph/voice.ts`](src/graph/voice.ts)): a clip runs its source's chain on the mono mix of its sound and plays it in both channels. With denoise, the clip plays from the index's denoised stem, with the recording mixed back under it at the attenuation limit. The chain starts on the source a second or more before the clip, so its filters have settled by the clip's first sample and the level does not swell after a cut.

## B-roll sourcing

`@video-editor/engine/broll` finds B-roll from free sources for the planner to place ([visuals](#visuals)). Each capture, clip and icon comes with a `Credit`, and `writeCredits` writes them to `<name>.broll.txt` beside the video.

- **Web capture:** `capturePage` opens a page in Chrome Headless Shell, the one the effects render in, at 2x. With `selector` or `text` it crops to that element and returns its box as `focus`; without, it shows the first screen. With `scroll` it writes an MP4 of that many seconds that eases down the page. Cookie and consent banners and other fixed overlays are hidden, never accepted. Each capture has a fresh profile and a 20 s limit to load; it never logs in, and never reaches a local or private address, through a redirect or a WebSocket included ([security](../../SECURITY.md#scope)). A page that answers with an error, or turns the visitor away (a bot check, a block or a captcha), fails. Captures are kept under `~/.cache/video-editor/broll/captures/`.
- **Stock footage:** `findStock` searches Pexels, then Pixabay, for a clip at least `minSeconds` long that the video has not shown yet, and downloads its smallest file whose short side reaches 1080 px, else its largest, to `~/.cache/video-editor/broll/stock/`. It needs the user's own free key, `PEXELS_API_KEY` or `PIXABAY_API_KEY`, in the `.env` as [`.env.example`](../../.env.example) lists; without either it finds nothing. Each search is kept for 24 hours, and clips are downloaded, never linked to. A rejected key or a rate limit is reported through `onProblem` and the other provider is tried.
- **Icons and logos:** `findIcon` returns an SVG by name: a symbol from [Lucide](https://lucide.dev) or [Tabler](https://tabler.io/icons) by its name or tags, or a brand's logo from [Simple Icons](https://simpleicons.org) in the brand's colour; `kind: "logo"` or `"symbol"` asks for one. The sets are their npm packages' tarballs, pinned by SHA-256, downloaded on the first lookup and kept in `~/.cache/video-editor/broll/icons/`. A logo's credit notes that it is a trademark ([notices](../../THIRD_PARTY_NOTICES.md#icons-and-logos)).
- **Sound effects:** `sfxOf(kind)` lists the CC0 sounds of a kind and `pickSfx(kind, nth)` takes the next one for each use. The kinds are `click`, `tap`, `paper`, `whoosh`, `tone` and `stop`, for visible actions, not every cut. The files are in `assets/sfx/`, some drawn by [`scripts/sfx.ts`](scripts/sfx.ts) ([sources](../../THIRD_PARTY_NOTICES.md#sound-effects)).

## FFmpeg

On first use the renderer downloads its pinned FFmpeg build ([which one](../../THIRD_PARTY_NOTICES.md#ffmpeg)), checks it against its SHA-256 and keeps it in `~/.cache/video-editor/` (`%USERPROFILE%\.cache\video-editor\` on Windows). The Linux arm64 build is not tested.

The effects also need ffprobe, which [HyperFrames](../effects/README.md#rendering) runs to check what it wrote, and Chrome Headless Shell. Both download on the first render with effects:
- **ffprobe:** the static build for the system from the npm packages of [@ffprobe-installer](https://www.npmjs.com/org/ffprobe-installer), pinned by SHA-256 and kept in `~/.cache/video-editor/ffprobe-*/`. `VIDEO_EDITOR_FFPROBE` points at another one.
- **Chrome Headless Shell:** Google's Chrome for Testing build, pinned by version (`CHROME_BUILD` in [`src/chrome.ts`](src/chrome.ts)) and kept in `~/.cache/video-editor/chrome/`. Web capture uses the same one. Chrome for Testing has no Linux arm64 build; `VIDEO_EDITOR_CHROME` points at a Chrome or Chromium there.

`VIDEO_EDITOR_FFMPEG` points the renderer at another FFmpeg instead. It must be FFmpeg 7.0 or later and have every filter, encoder and decoder the renderer needs: libass, libx264, zimg, loudnorm and libvpx's VP9 decoder among them. If it is older or one is missing, the first render fails before any work and names each one.

## Tests

`pnpm --filter @video-editor/engine test` runs every test here except the one that asks Claude, which needs your own key; with `CI` set it skips the ones that need Chrome too ([CONTRIBUTING](../../CONTRIBUTING.md#setup)). The first run downloads the pinned FFmpeg and ffprobe and the caption fonts. Planning tests replay `src/plan/fixtures/talk-plan.json`.
