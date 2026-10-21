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

- **Inputs:** files, folders and links, where a folder stands for the files directly in it. Videos are cut. Still images (JPEG, PNG, WebP, BMP, TIFF) can show as B-roll for up to 8 s, which Claude places by their names alone. Audio files among the footage fail: music comes with `--music`. A video with a `<name>.project.json` beside it is an earlier edit and is not read as footage. The length is 15 s to 1 h, written as 60s, 90, 3m, 1m30s, 1:30, 1h or 1h30.
- **Links:** an `http` or `https` argument is a public video's page, such as a YouTube video's; other sites [yt-dlp](https://github.com/yt-dlp/yt-dlp) reads (Instagram, TikTok, Facebook, X, Vimeo, Bilibili, …) may work ([`src/link.ts`](src/link.ts)). Use only videos you have the right to use. Before the analysis, each one's video is fetched beside the output (the video, or with `--shorts` the shorts' folder) as `<title> [<id>].mp4`, or `.mkv` when the site's streams are not MP4's, beside any file of that name, in any case, rather than over it (`<title> [<id>] (2).mp4`), at the best quality up to 1080p on its shorter side, or the best there is below it, never re-encoded, with FFmpeg joining its video and sound; it is then footage like a file, and its index is cached by its contents like any file's. One link fetches one video: a playlist or channel link fails, asking for one video's link, as do private, members-only, age-restricted and live videos. yt-dlp runs with no configuration file and never reads cookies, from a file or a browser; YouTube's JavaScript runs on the Node that runs the command; its cache is `~/.cache/video-editor/yt-dlp.cache/`. Unlike the pinned downloads, yt-dlp stays current, as sites change often: each link first reads the latest release's `SHA2-256SUMS` on GitHub, downloads that release's standalone yt-dlp for the computer when it is not kept yet, checks it against its SHA-256 before keeping it as `~/.cache/video-editor/yt-dlp-<hash>`, keeps the one before, which an import that started with it may still run, and removes older ones; when GitHub cannot be reached, the newest kept is used. yt-dlp runs in a process group of its own, which stopping a fetch stops whole, FFmpeg included; when the command ends, even by Ctrl+C or a stop signal, it stops them and removes the partly fetched file.
- **A stretch:** `--within 612-671` (or `10:12-11:11`) cuts the edit from that stretch of the one video given, in seconds: the planner reads only the lines said wholly inside it. A stretch past the file's end, or shorter than the length, fails before any analysis. A short of several is planned again this way, with `--short "<title>. <description>"`, which plans it as `--shorts` did: hook first, with no opening title, about its moment (below).
- **Instructions:** `--instructions "<text>"` passes what the user wants of the edit, in their own words ("open with the demo", "leave out the pricing"), to every planning request, set apart in `<instructions>` tags: Claude follows it as far as the footage, the length and its rules allow. It works for a first edit and for one planned again from the same footage; at most 2000 characters.
- **Look:** `--look` names the [look](#colour) over the edit: `clean` unless another is named, or `none`.
- **Brand kit:** `--brand <folder>` renders the edit in a [brand kit's](#brand-kits) look: its colours, fonts, logo and custom captions. The kit is checked before anything else runs, and its files are copied into `brand/` beside the video (with `--shorts`, in the shorts' folder). Its custom captions replace the caption style unless `--captions` names one. Nothing in a kit reaches Claude: a plan with a kit asks what one without it asks.
- **Visuals:** `--visuals rich`, the default, shows [what the speaker talks about](#visuals): motion graphics Claude writes for the edit once its cut is known, captures of the pages the speaker names and, with `PEXELS_API_KEY` or `PIXABAY_API_KEY` in the `.env` (both free, both optional), stock footage, with a soft sound on a visible action. `--visuals minimal` makes the edit without them, planned from the same request as before they existed.
- **Analysis** runs `vework analyze` in `worker/` with `uv run` on the Python version in `.python-version`, so uv installs the models' packages (the worker's default `ml` group) first if `uv sync` ([quick start](../../README.md#quick-start)) has not, and again if a Python upgrade makes it rebuild the environment. `--names names.txt`, people's names, and `--terms terms.txt`, other words such as brands and jargon, reach vework together as `--glossary` with `--asr-context` (both in one file of the cache when both are given); only the names reach the planner, as the people a lower third may show. `--correct` turns on [transcript correction](../../worker/README.md#transcript-correction). `--asr cloud` has the speech heard on OpenRouter with `OPENROUTER_API_KEY`, which the command reads from the `.env` as it reads Anthropic's key ([cloud speech](../../worker/README.md#cloud-speech)); OpenRouter takes no context prompt, so the glossary then reaches vework only with `--correct`, for the correction, and is left out of the index's hash without it. Each index is kept in `~/.cache/video-editor/indexes/`, named by the file's SHA-256 and a hash of those options, where the speech was heard, and the worker's code and lockfile (leaving out the worker's own version number, so a release that only raises it keeps the cache), with its [denoised speech](../../worker/README.md#voice) beside it. Another edit of the same footage, at any length or aspect, starts at the plan; a change to the worker analyses again.
- **Music** (`--music`, any number of times): audio files, or folders of them, that Claude may put under the edit ([how](#planning)); without it the edit has no music. Use only music you have the right to use. Each track's licence is the first line of `<name>.txt` beside it, which may go on with a web address where its terms are and a credit line, for example:

  ```text
  CC BY 4.0
  https://creativecommons.org/licenses/by/4.0/
  "Song" by Artist
  ```

  `--music-license "CC0 1.0"` gives the licence of every track without its own file; a track with neither fails before any analysis. Each track is analysed with `vework analyze-music` and its index cached like the footage's, keyed also by its licence. The licences of the music the video plays go to `<name>.music.txt` beside it.
- **Claude:** the key is read as for [planning](#planning). Before any analysis the command looks up the planning model, which costs nothing, so a missing or wrong key fails at once. `estimateCost` in [`plan/estimate.ts`](src/plan/estimate.ts) gives a range for what Claude will cost from the footage's length and the edit's, fitted to the [measured edits](MEASUREMENTS.md#edit-measurements). `--quality economy` plans, and judges the cut checks the review doubts, with `claude-sonnet-5-5` instead of `claude-opus-5-5`, for half the cost; `best` is the default ([measurements](MEASUREMENTS.md#quality-measurements)).
- **Outputs**, beside the video: `<name>.project.json`, which renders the same video again; `<name>.srt`, the captions burned into the video; the renderer's `edit_cuts.json`; with music, `<name>.music.txt`; and with B-roll or sound effects that carry a credit, `<name>.broll.txt`. Work files go to `.<name>.edit/` beside the video, removed when the edit ends. A file already at the output path fails the edit unless it is an earlier edit, with its `<name>.project.json` beside it, so footage is never written over.
- **Progress:** each step is one JSON line on stdout, as [progress.schema.json](../schema/README.md#progress-lines) defines it. The line names its stage (`analyze`, `plan`, `render`, `check`) and, while a file is analysed, the file as given; with `--shorts`, the short it is about as `short`, and a `short` line says each one is done. While something downloads on its first use, the lines carry its name and bytes as `download`, at the fraction reached before: a model vework downloads, the pinned FFmpeg, which is fetched before the analysis starts, and, on the first effect render, Chrome Headless Shell and ffprobe ([effects](../effects/README.md#rendering)). So do a link's video, named by its title, and yt-dlp when a new release downloads. The `done` line, and an `error` line after a Claude request, carry what Claude cost so far by stage as `claude`: planning, with the callouts it finds on screen, the motion graphics with their fixes, and the cut checks with what they escalate. After an `error` line the command exits with 1, or with 2 for arguments it cannot use. When every file needs analysis, it takes 90 % of the fraction, shared by file size, as it took 89 to 96 % of a first edit in the [measured edits](MEASUREMENTS.md#edit-measurements). Lines for a person go to stderr: each step, whatever vework prints besides its progress, the review's findings and what each review pass's checks cost, and at the end the time each stage took and what Claude cost in all and by stage; transcript correction's requests are not counted. pnpm prints a banner on stdout first, which `pnpm -s edit` leaves out.
- **Several shorts:** `--shorts 5 --length 30-60s -o out/shorts` makes up to 5 shorts from one long video instead of one edit, each from one continuous stretch of one file; several files count as one recording split in order. The range is 15 s to 3 min, as two lengths joined by a dash. After the analysis, one request to the planning model reads every transcript and lists the moments that stand alone as shorts, best first, each a run of lines of one file with the length Claude picks within the range, a title, a description and 3 to 5 hashtags in the footage's language (Taiwan Traditional Chinese for Mandarin), at most one per 2 minutes of footage ([`plan/moments.ts`](src/plan/moments.ts)). Code leaves out a moment that shares a line with a better one, or whose stretch, every word kept, is shorter than the range. Then each of the best is edited as a short edit, hook first, from its stretch alone (`--within`), in turn, into `out/shorts/01/edit.mp4`, `02/`, … with the outputs below. A short whose plan still reaches less than its length after both planning requests is fitted to the length it reaches, when that is within the range, and `shorts.json` records that length; a moment the planner cannot cut to a length in the range is left out and the next one made instead. `shorts.json` beside the folders ([schema](../schema/shorts.schema.json)) lists each short as it is done, with its stretch and its video's length. Fewer shorts than asked are made when fewer moments stand alone or can be cut to their length, and the `done` line says so. Claude's cost is held to $1 for finding the moments in each hour of footage, $1 for each short and, with the moments left out counted, the finding's limit and $1 for each short asked in all; at most twice as many moments as shorts asked are tried. Each limit is checked before every request: past one, the run ends with the shorts made, `shorts.json` says `"stopped": "cost"`, and the `done` line says which limit; with none made, it fails saying so. The output folder must be new or empty. `estimateShortsCost` in [`plan/estimate.ts`](src/plan/estimate.ts) gives a range for the run.
- **Failures** that the inputs cause say what to change: a length outside 15 s to 1 h, a link that cannot be imported, saying why, no video among the inputs, an audio file among the footage, a track without a licence, an image FFmpeg cannot decode, a file vework cannot read, a missing or wrong key, an output path that holds footage, and a length the footage cannot reach ([how](#planning)). A Claude request that fails after the analysis says the analysis is kept, so running the edit again starts at the plan. A reply that breaks off mid-stream is asked for again twice before that.

## Planning

```bash
pnpm --filter @video-editor/engine plan footage/ --length 60 --aspect 9:16 -o edit/project.json \
  --music music/
```

The inputs are media indexes, or folders whose `*.index.json` and `index.json` files are read; each index's source file is the one it names, next to it, and an index without it fails before any request. From code, `{ index, source }` names an index kept apart from its file, as `pnpm edit` keeps them, and `{ image }` a still to show as B-roll. The length is 15 s to 1 h. `--music` offers background music: music indexes from [`vework analyze-music`](../../worker/README.md#music), or folders of `*.music.json`, each next to its track. Claude needs `ANTHROPIC_API_KEY`, which the command also reads from the git-ignored `.env` at the repository root. It prints the project's path, its length and what the requests cost.

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

**What Claude reads.** Each file is packed into `[start-end] text` lines, split on 0.5 s of silence and also at a sentence end with room to cut, so a short edit can start or stop at any sentence. Each line is numbered, and words that are often fillers (嗯, 呃, 那個, 就是, um, uh and a few more) are marked with an id. A header gives the file's length, frame size and rate, shot changes, share of speech and long pauses, loudness peaks and audio events. The index has no speakers, so lines carry no `S0` tag; a file without speech is offered as B-roll, and so is a still image, by its name alone. A file's id is its name. Names that repeat take their folders' names, as corpus clips are all `source.mp4`, or keep their extensions when they share a folder, as a video and its thumbnail do; a name with no character an id allows, such as `訪談.mp4`, becomes `file-1`, `file-2` and so on, and the header keeps the name. The packed transcripts are a cached prefix: a second request for the same footage reads them at a twentieth of the price with Opus, a tenth with Sonnet.

**What Claude decides,** with `claude-opus-5-5` at high effort (`claude-sonnet-5-5` with `quality: "economy"`) and a JSON Schema for its answer: the segments to play, as runs of lines in story order rather than file order, each with a priority from 1 to 5; lines it leaves out as retakes, mistakes or off-topic; which marked words are fillers (那個 is often a real word); fillers the marks missed and false starts inside a line; B-roll over long talking stretches; a visual for each point it carries (below); the moments to emphasise (`plan.emphasis`), which get a push-in ([Framing](#planning)); and the effects over them (below). A target under half the footage's speech asks for its strongest self-contained moments, judged by hook, standalone, arc and ending; a longer one keeps the whole story with the best take of each line. Code checks every line number and id it gets back and ignores what does not resolve; a line also listed as removed does not play.

**What code does.** Code places every cut in silence (`place.ts`): the time between words, less the speech the transcript missed.
- **Speech the transcript missed** (`stem.ts`): where the denoised speech in the source's [voice stem](../../worker/README.md#voice), read in 10 ms frames, is within 30 dB of the median level of the source's words and 10 dB or more over the median level where no word is, for 50 ms or more, and no word covers it. On the real footage measured, the quietest 5 % of the words' frames sit 23 to 45 dB under that median; noise the denoiser leaves in the pauses does not count. In noisy footage the speech model can miss whole phrases the denoiser still keeps ([#104](https://github.com/zcxy-dev/fineframe/issues/104)), and a word's sound can run on past the time its word was given. That speech plays with the words beside it: no cut falls in it, and a pause is measured by the silences around it.
- A cut stays at least 40 ms from the sound on both sides, with up to 0.15 s of silence kept before it and 0.25 s after it, less in a shorter silence. Where words are left out, a clip ends in the first silence after its last word that a cut fits in and starts in the last one before its first; a silence at the source's start or end always fits, and where none fits, the cut goes in the longest. A silence of more than 0.75 s inside kept speech is dead air, cut down to that breath.
- A filler or false start is cut only where both gaps beside it hold a silence a cut fits in: 0.13 s, or both margins and a frame for a source slower than 20 fps. Otherwise it stays, since cutting there would clip the words it runs into.
- A clip whose opening silence, from its in point to its first sound, holds a click in its source's sound or one of the shot changes in its media index starts on the first frame after the last of them; one whose closing silence holds one ends on the last output frame before the first. A splice the source was edited with is both ([#105](https://github.com/zcxy-dev/fineframe/issues/105)): a cut on it clicks however it is faded, and a clip that starts before it opens on frames of the take before. Where the move would leave less than 40 ms before the sound, or after it, the cut stays where it was. A click is a 5 ms stretch of the recording whose largest jump between samples (its second difference) is more than four times the median of the 5 ms peaks within 0.1 s around it. `vebench render` reads a click at a cut the same way against the 99th percentile of the samples around it; at 12,000 points of two real sources this test flagged all 23 that `vebench render`'s did, and 514 more, which in silence only move a cut later inside it.
- Each clip starts on one of its source's frames and lasts whole output frames, so the renderer moves neither end of it. Otherwise a cut could move by half a source frame plus an output frame, enough to clip a word beside a short gap.

**Length** (`fit.ts`). A target longer than all of the footage's speech, with every pause cut to the longest breath, fails before any request and says the longest the footage allows, or to add footage when that is under 15 s. Claude is asked for about 1.25 times the target. Code then aims for the target itself, not just ±5 %. It weighs each way to shorten the edit in priority order: drop the segment with the highest priority number, the later one among equals, or keep only that segment's first lines; a segment whose dropping would undershoot stays whole, and the next is tried. For each, it stretches or shrinks the breath at every join, by 0.6 to 1.6 times, to come nearest the target, and keeps the nearest within ±5 %; of those within 0.5 % of it, the one that keeps the most. A choice that trims a segment while a less important one plays whole counts only when none in priority order lands within ±5 %. An edit that is still short gets one more request, with what the first answer came to; still short after two, the planner fails, says how long the edit came out, and what to ask for instead. An edit that cannot get short enough without cutting inside a line fails saying the shortest length its lines allow. `plan.fit` records the length and how many steps it took, and `plan.dropped` every stretch of a source left out, whole files included, with why: a filler, a pause, a retake or mistake, a lower priority, or not chosen.

**Captions** are the kept words on the output timeline, as they were said, one line per transcript line or sentence, tagged `zh-TW` or `en` by the language most of their words are in, with any word in the other language tagged too. A line runs on past a pause or a full stop where it would otherwise end inside a word (ICU's, as in 打。開) or on a word that leads into the next (要不然會 | 太冷), and a mark the transcript put inside a word makes no pause. A Chinese line drops its commas and full stops, as Taiwanese subtitles do, with a full-width space where one fell inside it; question and exclamation marks and quotes stay, half-width after an English word, and English words stay in English. An English line sets its punctuation half-width. Edits start with the `bold` style unless `pnpm edit --captions` names another. Fitting lines to the screen is the [caption renderer's](#captions).

**Music** comes only from tracks the user supplies, each analysed with the licence it is used under. Claude picks the track whose mood fits the content, from its name, tempo and how loud each section is, and the section the edit opens on, or none. Code fits it (`music.ts`):
- **Phrases.** A phrase is 4 bars from the start of a section. The music ends on the track's own ending, the end of its sound, at the edit's last frame. It enters on a bar line of the chosen section within a bar of the edit's start, and skips whole phrases forward, or loops back to the section's first phrase from where the track's last section starts, to reach the length, each join a 40 ms cross-fade 50 ms before the downbeats it joins, so the beat runs on as one grid. An entry on a phrase fades in over a beat; one a bar or more into a phrase fades in until the next phrase starts. Only when no such path fits, as in an edit shorter than the track's last phrase, does the music start at the section and fade out from the last bar line at least 2 s before the end. Paths with fewer joins win, then entries on a phrase.
- **Level.** The music sits 6 LU under the speech's loudness in pauses and is ducked 12 dB more, to 18 LU under, while anyone speaks: down over 250 ms before speech starts and back up over 750 ms after it ends. The renderer takes it further down under a stretch of quieter speech, such as a guest far from the microphone ([below](#how-it-renders)). The speech's loudness is the gated mean of the kept seconds in the media indexes, which weigh each channel as BS.1770 does, as the render's sound is weighed. A source with measured speech plays through its [voice chain](#voice), which brings its speech to -20 LUFS, so its seconds count moved by -20 LUFS minus its speech's measured loudness. A quiet track is raised by at most 12 dB.
- **Beats.** B-roll cuts need not fall between words, so its start moves to the nearest beat within 150 ms of its line, and its end to the last beat its length allows, both on the frame grid. Each music range records the track's licence and, when its beats keep one tempo within 20 ms, the beat grid they were snapped to.

**Effects** come from the [effect templates](../effects/), sparingly: Claude decides which moments get one and what it says, and code times and checks it (`effects.ts`).
- **A title** over the opening of an edit of a minute or more that keeps the whole story, from its first word for 3 s. A short edit opens on its hook instead, and in an edit under a minute a title would take too much of it.
- **Chapters** in an edit of two minutes or more: Claude names each and gives the line that opens it, and code marks it with the chapter template (its name and number, for 3.5 s from that line's first word, or from the opening for the first chapter) and hides the cut into each after the first with a wipe centred on it. The shortest section joins the one before it until each runs 30 s or more and there are at most 12; a chapter whose name runs past the template's 20 characters is left out before they are numbered, and with fewer than three there are none. The first marker waits up to 4 s for the title to leave. A shorter edit is not told of chapters at all.
- **Lower thirds** with a person's name and role, 4 s from a second after the line where they first speak, only when names are given (`pnpm edit --names`) and only a name from that list. It shows in the first shot, while that line is said, where the index's faces show someone on screen talking for at least 2 s (all of a source without faces counts), and ends before that shot or that talking does, coming in sooner than a second, but not before they speak, to fit; with no such shot it is left out, so a cut to the listener never carries the speaker's name. One waits up to 3 s for an effect already on screen, or B-roll covering the speaker, to leave.
- **Callouts** on screen recordings, where a file's header says it shows one (its framing's `screen` and `screen_cam` shots): Claude gives the line, the words that name the thing, what to look for in a few words and a label, at most one every 20 s. Code (`locate.ts`) sends `claude-haiku-5-5` the frame on screen as the first of those words is said, when that falls in a screen shot, at most 1280 pixels wide, with the line, and gets back the thing's box in pixels, or none. The answer is cached on disk under `~/.cache/video-editor/regions/` by the file's SHA-256, the moment, the target and the line, so planning the footage again asks nothing; a request Claude declines or that fails leaves that callout out. Code then outlines the box from 0.3 s before the words for 3 s, at most three a minute, and only when the box is between 0.05 % and 25 % of the frame, no B-roll covers it, and the clips under it all play that source's screen recording under one still crop with the whole box inside, so it runs on across a jump cut. At the first and last frame each of them plays, the box must look as on the frame it was found on: its pixels change by under 4 grey levels on average, or still correlate by 0.8, so a pointer passing over it is fine and scrolling is not. A screen recording keeps a still crop in the middle, so in a 9:16 edit most of a 16:9 screen is outside it.
- **One at a time,** title first, then chapters, then lower thirds, then callouts: at 9:16 the lower third and the chapter marker share the top of the frame. Only a wipe and the chapter marker after it overlap. An effect that would overlap another, run shorter than its template's minimum before the edit ends, or break its template's params (a chapter name over 20 characters, say) is left out; a subtitle, role or label too long is left out alone.

**Output.** The requested aspect at the largest of 1080, 720, 540 or 360 lines that the footage fills, at the frame rate of the file with the most speech, or at 30 fps when that file runs slower than 23.976 fps, whose frames do not fit in a cut's gap.

**Framing.** Each clip, B-roll included, is framed by [`cropPath`](#framing); an index without faces leaves the renderer's centred crop. Then (`punch.ts`) the planner sets each main-track clip's `framing.scale`. In a 9:16 edit, footage the crop already enlarges to fill the frame, as it enlarges landscape 1080p footage 1.78 times, is never zoomed further: no punch-in and no push-in. Otherwise the scale goes up to the punch-in or the footage's headroom, whichever is more. The headroom is the largest scale at which the crop still holds as many source pixels as the output, across and down; up to it, a punch-in adds no softness. Footage with less, such as 1080p edited at 1080 lines or 720p in a 1080p edit, softens a little more at 1.25 times, while a jump cut left in shows. Punch-ins and push-ins zoom so the face of whoever speaks most during the clip sits in the middle across, with its eyes a third of the way down (`framing.anchor`), or as near as the crop's edges allow, and only as far as keeps that face's whole head in view with room above it. A shot of a screen recording (with or without a webcam in a corner) or without a face shows wide, scale 1: a screen's edges hold text and controls, and a product's edges are part of it. A clip that runs on into such a shot steps back to wide at the shot change, and a push-in that would run into it is left out. A clip whose crop reaches past the picture or splits the frame ([Framing](#framing)) keeps its framing. The shot classes in the media index's faces say where the screens are, so an index without them leaves screens treated as camera footage; a source whose index has no faces at all zooms about the crop's centre.
- **Jump cuts.** A hard cut between two clips of one shot of one source, skipping more than a frame, makes the picture jump, as after a removed filler, pause or retake. The framing alternates between wide and the punch-in at such cuts, the way an editor hides them: 125 % at 16:9, 112 % at 9:16 and 1:1, whose crop is already close. A clip that plays on from where the one before it stopped keeps the framing that one ended at, since a change there would be a jolt rather than a cut.
- **Long shots.** At 16:9, a shot with a face, one person's or several people's, held in one framing for more than 8 s changes to the other framing between two words: at the longest gap between words 4 to 8 s after the last change, or the first one after that, never within 2 s of the clip's end, during a push-in or in a shot without a face. A shot change in the source starts the count again. The change is a step in `framing.scale`: two keyframes a tick apart.
- **Push-ins.** A clip pushes in slowly on each `plan.emphasis` moment that starts in it, from 0.5 s before the moment to its end and for at least 2 s: up to 6 %, at most 3 % a second, eased along half a cosine so it starts and stops without a jolt. A second moment in the clip pushes on from where the first push ended, as far as the footage has room. A push under 2 %, because its clip ends or the room runs out first, is left out, and a moment during a dissolve belongs to the clip coming in. A jump cut after a push-in changes the framing by 8 % or more where the footage has room: when neither wide nor the punch-in is that far from where the push ended, the cut punches in once more from there.
- **How far footage is enlarged.** 1080p footage edited at 16:9 fills a 1080p output exactly, so a punch-in enlarges it up to 1.25 times. Footage with pixels to spare goes as far as they allow: 1440p 1.33 times at 16:9, and 4K 2 times at 16:9 and 1.125 times in portrait (its crop is 1215 pixels wide for a 1080-pixel frame).

**Colour.** `grade.auto` is measured for each clip with `autoGrade`, then the main track's sources are matched to the one it uses longest and the look goes on every clip: `clean` unless `plan()` is given another `look` (`--look` on the command line), or `null` for none (`--look none`). [Colour](#colour) says how.

**Self-review** (`review.ts`). After each render, every cut gets a picture of the two seconds around it: eight frames over the waveform, the cut marked and silences shaded. `claude-haiku-5-5` reads it with the words on both sides and reports a clipped word, a broken sentence, a long silence or a bad frame, with a fix. A check under 0.7 sure, or one that would drop a clip, goes to the planning model, whose answer stands. A fix keeps more silence beside a clipped word, moves the cut to the next pause, puts back a filler whose cut clipped its neighbours, or drops a clip; the length is then fitted again. A review that changes nothing ends the loop, and an edit gets at most three.

### Visuals

A rich edit (`visuals: "rich"`, the default; `pnpm edit --visuals`) shows what the speaker talks about, as a creator's editor would: the real thing they name, as footage or as its page zoomed into the part talked about, and motion graphics for the keywords, numbers, comparisons and lists they say. The plan proposes the footage and the pages (`visuals.ts`); once the cut is known, Claude writes the graphics for that video (`graphics.ts`). What code cannot use is left out, so its line keeps the speaker.

- **What the plan may propose.**
  - `stock`, a search in English for footage of a physical thing or scene. It is offered only when `PEXELS_API_KEY` or `PIXABAY_API_KEY` is set.
  - `web`, the page of a product, model, project, paper or organisation the speaker names in that line, the words on it to zoom into, and its name as the speaker says it. A page for a place or brand only mentioned in passing is not one.
  - `sfx`, a sound for a visible action; none for most.
- **Checks.**
  - A page must be http or https, public, not a search page, and come with words on it to show ([web capture](#b-roll-sourcing)): a first screen is a home page or an ad, not the part talked about.
  - Its line must name it: the name Claude gives, said whole (a Chinese name as said, a Latin one never inside a longer word), or the name in its address (dcard in www.dcard.tw).
  - A search needs a key.
  - Each is sourced once per plan. Footage is searched and downloaded with the clips the edit already shows excluded. A page is captured in Chrome Headless Shell at twice the pixels of the box it fills, in a viewport of that box's shape, and kept under `~/.cache/video-editor/broll/captures/`.
  - A capture or search that fails says why on stderr and is left out, as is a page without the words it was asked for, or one that turns the capture away.
- **Timing.** A visual cuts in on the first frame of the first of its words. It lasts 4 s for a capture, or up to 3.5 s of footage, which always fills the frame, running on over the words after its own.
  - Visuals come at most one every 5 s of the edit, with at least 1 s of the speaker between two, earliest first.
  - One that would start inside the title, a chapter marker, a lower third, a callout or other B-roll waits for it to end if its line is still being said, and is left out otherwise.
  - One runs until the next of them starts. Each visual left out is reported with its reason.
- **Layout.** Full frame for at most 3.5 s, the longest the speaker is away in short-form edits. At 9:16 a capture, or a visual that runs longer, splits the screen for up to 6 s:
  - The visual fills the top 880 of 1920 rows and the speaker the rest, as B-roll of the main track's own source in step with it, framed for that shape as [Framing](#framing) frames a clip and graded as the main clip it plays beside.
  - A split across a cut is one speaker clip per main clip.
  - Other aspects have no split.
  - A still is cropped in its box's shape around the words it was captured for, at most 0.75 of their width and never past its own pixels, and pushes in by 8 % over its time on screen. Every change is a hard cut.
- **Effects** are planned first, and the visuals keep clear of them.
- **Sound.** A visual that asks for a sound gets the next file of that kind from the [CC0 set](#b-roll-sourcing) on its first frame, at most one every 6 s: -16 dB for a click, tap or stop, -14 for a tone or air, -12 for paper, under the voice. They play with the music bed, not ducked.

**Graphics** (`graphics.ts`). Once the edit is fitted, one request writes all of its graphics, or one for each 3 minutes of a longer edit, with the planning model at medium effort. The request carries:
- the edit's words on its own timeline, each with its time;
- where the captions are drawn and where faces are, in output pixels;
- where the picture already changes, at its cuts, framing steps, B-roll and effects;
- the stretches no graphic may cover.

Claude answers, for each graphic:
- its [layout](../effects/README.md#graphics): a corner label, a lower third, a panel at 9:16, or the full frame;
- the words it lands on, and the spoken phrases it shows;
- how long it stays, and a sound;
- its HTML and CSS in the [house look](../effects/README.md#look).

It is told the rules:
- A graphic shows only keywords, numbers, comparisons or lists the speaker says, never the sentence being said. It may mark them with the bundled icons, and show a brand's logo only when the speaker names the brand.
- At 16:9 the picture changes at least every 5 to 8 s, and labels and lower thirds carry most points with the speaker in shot.
- At 9:16 it changes every 2 to 4 s, mostly with panels: the graphic on top and the speaker below.
- Full-frame graphics are for a thesis, a list, a number or a comparison that reads on its own, and take at most a quarter of the edit.

Code then times and checks each graphic:
- **Timing.** A graphic starts 0.4 s before the words it lands on are said, for as long as it asked within its layout's range (`GRAPHIC_SECONDS`), until whatever it may not cover starts. Ends fall on the frame grid.
  - A graphic depends on the words it lands on and each phrase it shows; one whose phrases the edit does not say is left out, and so is one whose words were cut, or that would come within 0.4 s of the one before or start over B-roll or an effect.
  - A label gives way to a panel or a full-frame graphic that wants its time.
  - Full-frame graphics past a quarter of the edit are left out, latest first.
  - A panel splits the screen with the speaker below it, as a capture's split does.
- **Checks.** Each graphic is drawn in Chrome against the captions as they will be laid out, with its panel's split in place, and the faces under it ([checks](../effects/README.md#graphics)). Its text is also checked against the speech:
  - each word it shows must be said in the 20 s before it or the 10 s after it, a Latin word or a number whole (20 is not in 2024, nor art in start), a number in digits or in Chinese numerals (a lone 十 among them), joined at most by small words such as 的 and 不 or by a unit said right after a number, such as 歲 in 二十七歲;
  - it may not restate what is said while it shows: no run of eight Chinese characters or four Latin words of it, and not most of one phrase with a small word or two left out (害怕 becoming thirty for 會害怕 becoming thirty 嗎), while two keywords of a phrase that leave its subject out still pass;
  - each logo it shows must be of a brand named whole in the 20 s before it or the 10 s after it (X is not in next, nor Meta in metadata).
- **Cadence.** After placement, code finds where nothing new comes into the picture (no cut, shot change, B-roll, effect or graphic) for longer than the shape allows: 8 s at 16:9, 4 s at 9:16.

  The graphics that fail, and those stretches with the words said in them, go to Claude once, together: each failing graphic with its problems and a half-size screenshot, to fix, and each stretch for one new graphic where its words carry a point. A fix that still fails is left out, and its line keeps the speaker; a new graphic is placed and checked with the rest, and left out without another request when it fails. After a review fits the edit again, the graphics are placed on the words that remain and checked again, and one that fails is left out without another request.
- **Sound.** A graphic that asks for a sound gets one on its first frame, at most one every 6 s with the visuals' sounds, and none when a cut falls from 0.1 s before it to 0.5 s into it, where the sound would ring across the cut.
- **Credits.** The render adds each icon and logo a graphic draws to `<name>.broll.txt`, a logo with its trademark note.

A request that fails leaves the edit without graphics there.
- **Credits.** Each capture, clip and sound is a source with its `credit`; the renderer writes those the video plays to `<name>.broll.txt`.

## Rendering

```bash
pnpm render edit/project.json -o out/edit.mp4
```

The command renders a project as it is, after validating it: a project changed by hand that breaks the schema, or what the schema cannot express (see [`packages/schema`](../schema/README.md#using-it)), fails with every problem by its JSON path. `--cut` takes stretches out first ([changing an edit](#changing-an-edit)). From code:

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
- **`edit_cuts.json`:** where each main-track edit falls in the video, in seconds, as [vebench](../../bench/) reads it: the cut itself, or the middle of a dip or a dissolve.
- **`<name>.srt`:** the captions as SubRip, when `captions.srt` is set: the same text in the same rows on the same frames as the picture shows.
- **`<name>.music.txt`,** with music: each track's file, licence and the credit its licence asks for, ready to paste where the video is published.
- **`<name>.broll.txt`,** when the video shows B-roll or plays sound effects whose sources carry a `credit`: where each came from, its licence and any note it must carry, in the order they first play.

The `stems` option also writes the mix's parts into a folder, before loudness normalisation scales them alike: `voice.wav`, the main track and B-roll sound, and `music.wav`, the music as ducked. `vebench mix` measures the voice's lead over the music from them, and the review draws its cut strips from `voice.wav`, so music does not fill the pauses it looks for.

A video only B-roll shows, muted, such as stock footage or a scrolling capture, needs no media index: it is read as BT.709 SDR from its container's time zero. Every other video source needs its media index from `vework analyze`: the renderer reads the sound, the colour tags and the frame rate from it, and a voice chain that denoises plays the denoised speech the index names. A source whose size or SHA-256 differs from its fingerprint fails the render.

### Changing an edit

A finished edit changes by changing its `<name>.project.json` and rendering it again, which takes as long as a render, without analysing or planning again. The [agent skill](../../skills/video-editor/SKILL.md) has the recipes an agent follows for each kind of change.

```bash
pnpm render out/edit.project.json --cut 29-33 -o out/edit-v2.mp4
```

`--brand <folder>` renders the edit in that [brand kit's](#brand-kits) look, its files copied into `brand/` beside the video, and `--brand none` in the house look; the kit's custom captions draw in place of the edit's caption style, which taking the kit off brings back. Either is a render alone, with no new plan, as a caption style is. The edit as changed is written to `<name>.project.json` beside the video.

`--cut <from>-<to>`, in seconds or minutes:seconds of the video the project renders, takes that stretch out ([`cut.ts`](src/cut.ts)), any number of times:

- **Words:** a word goes when its middle falls in a stretch, and a clip goes when a stretch covers it or none of its words is left. A stretch that takes out no word fails.
- **Cuts:** an edge of the words going that falls between two words said without a pause a cut fits in (0.13 s, or more beside a slow source) moves inward to the nearest such pause inside the stretch, so no word goes that was not asked for, though a few asked for may stay. Only a stretch with no such pause inside grows outward to the nearest ones, and stderr says which words that took beyond it. A clip that loses words from inside it splits around them, and each new end is placed in the pause beside the words kept as the planner places cuts: at least 40 ms from a word, on a source frame, with whole output frames between them. The ends a cut does not touch, and the pauses between the words kept, stay as they were.
- **The rest moves up with the speech:** caption words that went leave their lines, and the rest keep their times against the speech; overlays and B-roll clips start at the first moment left of their time, and go when all of it went; music plays on without a gap and ends where the edit does.
- **What went:** stderr lists the words cut from each clip, the overlays and B-roll removed, and the ones that overlapped a cut, which may now stand over other words.
- **Length:** a cut that leaves the edit outside the tolerance of `output.target` fails and prints the new length, as the renderer would; `--retarget` makes that length the target instead, for a shorter edit wanted as it is.

The edit as cut is written to `<name>.project.json` beside the video, which may not be the project it was cut from.

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

**Sources:** phone footage with a rotation matrix comes out upright, and footage with non-square pixels in its displayed shape. Every frame rate, variable rates included, is retimed to the project's. PQ and HLG footage is tone-mapped to BT.709 (zscale and Hable). Footage that does not say which colour matrix it uses is read as BT.709 at HD sizes and BT.601 below, as players read it. A source without sound, or with a silent track, plays silence.

**Output:** H.264 High at CRF 18, 4:2:0, tagged BT.709; AAC at 192 kb/s and 48 kHz; the index at the front of the file for streaming.

## Framing

`cropPath` turns the faces and speakers in a media index's [`framing`](../schema/media-index.schema.json) into the crop for one clip, in the shape of the box it fills: the output frame, or a B-roll rect. The planner writes it into every clip it places, as:

```ts
import { cropPath } from "@video-editor/engine";

const crop = cropPath(index, clip, project.output); // clip.in and clip.out in source ticks
if (crop) clip.framing = { crop };
```

It returns nothing when the index has no `framing` or the box already has the source's shape. Otherwise the crop has the box's shape, moved by a virtual camera. The source's shape is as displayed, from the index's `sample_aspect`: HDV's 1440 × 1080 with 4:3 pixels is 16:9. The planner and the renderer refuse an index written before vework recorded it.

- **What it frames,** shot by shot, from the shot's layout:
  - a shot without a face, such as a product, scenery or a screen recording, with or without a webcam in a corner (`screen`, `screen_cam`): the whole picture, still, in the middle of the box, over a blurred copy of itself that fills the rest;
  - one person (`talking_head`): the face that speaks, or the biggest one;
  - two people side by side (`two_shot`) who both take turns to talk, in a portrait box: a split screen, the one on the left in the top half and the one on the right in the bottom half, each crop keeping its person's whole head as a face is framed below, at least half the picture's height and leaving out the other's face; two people too close for that are followed in turn, as below;
  - two people (`two_shot`) or more (`group`): everyone, when their faces fit in the crop with room around them; otherwise whoever speaks, held through pauses until someone else speaks for a second and a half, so a quick reply or a laugh does not swing the camera there and back. One person's phrases less than a second apart count as one turn;
  - a video call's layout, whatever its people's layout: the window of whoever speaks, as large as the box's shape fits in it ([below](#video-calls)).
- **How it frames a face:** the whole head stays in, with room above it, eyes a third of the way down. The crop is the largest of the box's shape inside the picture. Where that leaves less room above the head than 6 % of the crop's height, as when the picture cuts the head off at the top, the crop moves up past the picture's top edge, to put the eyes a third of the way down. A face too close for the whole head to fit, sides included, widens the crop past the picture's edges until it does, eyes a third of the way down; the picture then fills the box's width but not its height. Past the picture, the blurred copy shows. The detector's box runs from the brow to the chin: the eyes are taken at 0.38 of its height and the top of the head at 0.25 of its height above it, the head's width at 1.25 times the box's, filling at most 80 % of the crop, with 6 % of the crop's height above it.
- **How it moves:**
  - It holds still while the subject stays within a dead zone around the crop's centre.
  - Beyond it, it re-centres with a pan that eases in and out under a top speed, so a subject who walks off is caught up with at that speed.
  - A switch to a speaker more than a crop's width away, or to one framed with another size of crop, cuts instead of panning across the space between them.
  - At a shot change, it cuts to the new shot's framing.
  - A median over a few samples drops single-sample detector jumps.

The path depends only on the source, so two clips cut from one shot frame it the same way. `CAMERA` holds the dead zone, top speed and acceleration; the fourth argument overrides them, and the fifth gives each face's window in a video call.

**Video calls.** For each shot the edit plays with two or more faces, and no screen, the planner reads its middle frame in grey, 320 pixels wide (`plan/windows.ts`). The background is the commonest plain grey level, one whose 3 × 3 neighbourhoods vary by 3 levels at most, over a tenth of the frame or more. A face's window is the run of columns, then of rows, around its centre that the region of non-background pixels joined to it mostly fills, so a caption box joined to it does not widen it. It counts when at most half of each of its edge lines is background and at least 80 % of each line two pixels outside it (scaling blends the one between into the window's edge), and it covers less than 80 % of the frame: a person in front of a plain wall has wall inside the top of their outline, and is no window. Windows are found once per shot and planning.

**Rendering a path:** FFmpeg's crop filter evaluates the path at every output frame. Frame *n* of a span shows source time `start + n` frames, so the keyframes become frame numbers, and the crop's centre is linear between them. A cut is two keyframes one tick apart, so no frame falls between them. The crop moves in whole source pixels. The path is read a millisecond after each frame's time, as the picture is, so a cut lands on the frame that shows the new shot. FFmpeg reads each piece's filter graph from a file, so a path of any length fits. Where a cut changes the crop's size, splits the frame or stops splitting it, moves a crop that reaches past the picture, or steps the scale, the clip's picture is drawn in stretches, one for each side of the cut with its own crop, joined end to end (`concat`) at the output's frame rate and time base, in a dissolve too; the sound is not split there.

**Past the picture and split screens:** the part of a crop that lies on the picture is scaled to where it falls in the box, over the whole picture scaled to cover an eighth of the box, cropped to its middle, blurred (`gblur`, sigma 6) and scaled up to the box. A path past the picture moves only along an axis on which it lies inside the picture, and is not zoomed. A split screen fills the top half and the bottom half of the box, each from its own crop narrowed to the half's shape, stacked. The renderer refuses a split screen whose halves reach past the picture, and a zoom on either.

## Captions

`captions.lines` are drawn over the finished picture by libass in the style `captions.preset` names:

| Style | Type | Words |
|---|---|---|
| `bold` | Heavy white type with a dark stroke and a soft shadow; a caption settles in from 90 % | the word being spoken turns amber |
| `creator` | 1.4 × the size, heavy white type in a dark rounded box, one row of at most 6 Chinese characters' width and 3 English words; each caption pops in from 80 % | numbers, and English words in a Chinese line, are amber |
| `minimal` | 0.72 × the size, bold white type with a thin dark stroke and a soft shadow | no highlight |
| `pop` | As `bold`, 1.05 × the size | each word appears as it is said, shrinking from 125 % to its size over 140 ms, where the finished row puts it, so the row never moves |
| `none` | Nothing on the picture | the SubRip file is still written, broken as `bold` breaks it |

A number is digits, or Chinese numerals with 十, 百, 千, 萬 or 億 in them (三十, 二十七), never the 一 of 一直. The styles share the effect templates' palette (white, near-black and one amber accent) and one motion. Fades bracket silence: a caption after a pause fades in over 160 ms, easing out, and one before a pause fades out over 100 ms, while back-to-back captions switch at full strength so the text never dims between phrases. The values are in [`src/captions/presets.ts`](src/captions/presets.ts).

**Changing the style.** The style is the render's alone: changing `captions.preset` re-renders with no new plan. So graphics are planned clear of the captions of every style: the area they keep off, in each stretch, holds where each style would draw.

**Size and place.** The type is sized from the frame's shorter side, times the style's size, and each aspect has its place and row length (the longest row in `bold`'s size; every style keeps to the same width and place):

| Aspect | Type size | Longest row | Rows | Bottom of the last row |
|---|---|---|---|---|
| 9:16 | 7 % of the width | 10 Chinese characters | 2 | 72 % down |
| 1:1 | 6 % | 12 | 2 | 86 % down |
| 16:9 | 5.8 % of the height | 16 | 1 | 90 % down |

At 9:16 the rows keep to about the middle 70 % of the width, and even when moved stay above the bottom 22 %, clear of the buttons and the description that short-form apps draw over the video. A caption that would cover a face moves just above or below it, whichever is nearer, within its aspect's band: the faces are the media index's `framing`, seen through each clip's crop and punch-in, the speaker beside a split screen included, and a face that B-roll or a panel or full-frame graphic covers does not count. A caption also keeps off a split screen's panel and a full-frame graphic, and covers part of a face before it covers them. The next caption in the same shot keeps that place, so captions do not hop between phrases.

**Line breaking.** Each line is split into captions of one or two rows:
- at its pauses first (a full-width space or punctuation), so a caption holds whole phrases;
- otherwise between words: Chinese where ICU's dictionary ends a word (`Intl.Segmenter`), English at spaces. An English word is never split, and a Chinese word only when it is wider than a row;
- never with closing punctuation (，。」？！… and the like) at the start of a row or opening punctuation at its end, nor inside a number (二 | 十);
- into two rows as close in width as those breaks allow, rather than end a row on a word that leads into the next (都不, 最, 在) or start one with a particle (的, 了, 嗎).

**Timing.** A caption shows from the first frame of its first word. One caption shows at a time; a line's last caption stays up 0.5 s after its last word unless the next line starts sooner. Each word is lit from the first output frame at or after its start until the next word starts, and a line's last word for 150 ms after its sound ends. ASS counts centiseconds and FFmpeg hands libass each frame's time cut to a whole millisecond, so every event time is rounded down from a millisecond before its frame: each caption and highlight appears and leaves on exactly the frame it was laid out on, at every common frame rate from 23.976 to 60 fps.

**Font.** Noto Sans CJK TC (OFL-1.1), Bold and Black: the full CJK font rather than the smaller Noto Sans TC, which lacks rarer ideographs such as 𠮷. It is downloaded on first use from a pinned commit, checked against its SHA-256 and kept in `~/.cache/video-editor/`. The render hands libass the face files itself, so captions are drawn in the faces their layout was measured in whatever fonts the machine has; a line with a character they lack fails the render, naming the line, before anything is rendered.

**Samples.** `node scripts/caption-samples.ts <project.json> <folder>` renders a planned edit in every style that draws, at every aspect, each with a strip of eight frames on which a word starts, labelled with the frame, its time and the word.

## Brand kits

A kit is a folder: `kit.json`, which [`project.json`'s `brand`](../schema/project.schema.json) has the shape of, and the logo and fonts it names ([`src/brand/kit.ts`](src/brand/kit.ts)). The render applies it alone, so an edit's kit changes with a render and no new plan.

- **Checks:** each file must lie inside the kit's folder. A logo is a PNG of up to 10 MB and 4096 pixels a side, or an SVG of up to 2 MB that holds only shapes, text, gradients, clips and references inside itself: a style, a script, an event handler, a `foreignObject`, an image, a doctype, a processing instruction but the XML declaration, or a reference to another file, read with its entities and CSS escapes decoded, is refused ([`svgProblem`](../effects/src/logo.ts)). As the edit renders, an SVG is drawn to a PNG 1024 pixels on its longer side in the guarded Chrome the graphics render in ([`rasterizeSvg`](../effects/src/raster.ts)), as an image, which runs and loads nothing, and kept in `~/.cache/video-editor/brand-logos/`. A font is a TrueType or OpenType file of up to 64 MB whose tables, glyph widths and character map lie inside it, read by the engine's own parser ([`readFace`](src/captions/fonts.ts)); its family name goes into the caption script, so one holding a comma, a brace or a backslash is refused.
- **Copies:** an edit copies the files into `brand/`, each named by its content's SHA-256, and records the hashes in `brand`; a render fails on a file changed since.
- **Colours:** primary replaces the amber accent (`#ffb547`); secondary and accent replace its deeper and lighter tones, made from the primary by the house tones' differences in lightness when left out. The [effects](../effects/README.md#brand-kits) recolour every amber of their pages, and the captions light their word and keywords in the primary. Text in a colour that falls under 3:1 contrast against what is behind it is white or black instead.
- **Fonts:** a kit names one of eight open faces that cover Traditional Chinese, downloaded on first use from a pinned commit and checked against its SHA-256 into `~/.cache/video-editor/brand-fonts/` ([`src/brand/faces.ts`](src/brand/faces.ts)), or a file of its own. Graphics and titles are set in the first; captions in the second, its characters measured as drawn. A character a face lacks is drawn in Noto Sans TC: in the graphics by the browser, in the captions in Noto Sans CJK TC at the same em, by a font change around that character in the script.
- **Watermark:** with `logo.show`, the logo is laid over every frame, over the B-roll, graphics and overlays and under the captions, in its corner of the overlays' safe area (at 9:16 clear of the header and the buttons, and 22 % above the bottom), as large as a square whose side is `logo.size` of the frame's shorter side, at `logo.opacity`. It is left out of the frames a graphic or a template overlay whose box meets its own shows (a label, a lower third, a panel, a full-frame graphic, a title, a name, a chapter marker or a callout), so it never covers their text ([`src/graph/watermark.ts`](src/graph/watermark.ts)).
- **Custom captions:** one of the four drawn styles with its size (80, 100 or 125 %), its text and highlight colours, a dark outline or the creator style's box, its place (the aspect's bottom, the middle, or the top of its band) and one or two rows; a page whose row would be wider than the aspect keeps captions to, such as a long word in a large size, is set smaller to fit. Graphics were checked clear of the house captions alone, so custom captions also keep clear of the labels, lower thirds, titles, chapter markers and callouts on screen, as they keep off a panel.

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
- **Bounded memory.** One FFmpeg process opening every clip at once decodes ahead on all of them before the first frame is out. Each piece opens at most two clips plus the B-roll and effect overlays over it.
- **Exact lengths.** Clip boundaries are rounded to output frames along the whole edit, so rounding never adds up. A span's samples follow the frame grid. Every span is retimed to exactly its frame count, holding its source's last frame if the source ends first, and the render fails if the encoder counts any other number. Output frame *n* shows the source frame on screen at that instant.
- **Overlays counted onto frames.** An overlay is on frame *n* when its time covers the frame's start, so both its ends round up to a frame. It is rendered for exactly those frames, and each piece it spans takes its share by frame count and lays it over the B-roll. The file's own timestamps play no part, so overlay frame *k* lands on output frame start + *k* at any rate, NTSC included. One that runs past the edit is cut where the edit ends, and its render is that much shorter, so it still plays its exit; if what is left is shorter than its template allows, the render fails.
- **Sound placed by timestamps.** As vework hears it, a late start or a gap of more than 20 ms in the source becomes silence. Every span is trimmed or padded to exactly its sample count. A clip's sound split between pieces, by a dissolve or by a cut under B-roll, is cut from one decode that starts where the clip starts, so the halves join sample for sample; a seek of their own would shift one by a sample or two and click.
- **One time zero.** Each source is opened with a seek to a container timestamp counted from the time zero its media index records, not from where FFmpeg starts the file. FFmpeg 7.0 starts AAC in Matroska, as OBS records it, at the codec priming and Opus in WebM before its pre-skip: 21 and 7 ms before vework's zero, which would put picture and sound that much after the index's word times. Matroska times packets in whole milliseconds, so after a seek the sound can still sit up to 1 ms from where vework places it.
- **AAC framing.** FFmpeg's MP4 reader skips the encoder's priming at the start but keeps its padding at the end. The encoder therefore leads the sound with silence that the edit list skips, so the samples fill whole AAC frames. Otherwise the sound would decode up to 21 ms longer than the picture.
- **Graphics** are rendered at the size of what they fill, for exactly their frames, and laid over the B-roll as overlays are, frame by frame by count:
  - A label or a lower third is rendered at its box, with its alpha, and laid at its box.
  - A panel is rendered at the panel's size, and a full-frame graphic at the frame's; both are opaque.
  - A full-frame graphic is pushed in from the right over its first 0.35 s, and a panel down from the top. FFmpeg's overlay moves the rendered graphic on a curve that starts fast and settles, over whatever shows under it.
- **Music.** Each range of a track is clocked from its source like a clip's sound, faded (quarter sine; ranges without a fade get the 5 ms cut fade) and set to its gain. Ducking follows where the media indexes found speech in the clips and heard B-roll the edit plays, mapped onto the output timeline: a gain envelope computed beforehand, at 1 kHz, which FFmpeg resamples and multiplies in. It starts down before speech starts, which a compressor listening to the voice cannot, and stays down through pauses too short to come back up for half a second. Under each stretch of speech whose momentary loudness in the rendered sound, gated as BS.1770 gates, falls under that of all the edit's speech, the music goes down by the difference too, up to 12 dB, over the attack before the stretch starts: the planner set it under the speech as a whole, and a quiet speaker would otherwise have it that much closer. The bed is added to the main sound before loudness is measured, so normalisation covers both and keeps the voice's lead.
- **Loudness.** Two-pass loudnorm to the project's target. The second pass is a linear gain when the true-peak ceiling allows it; otherwise loudnorm falls back to dynamic normalisation, and `result.loudness.linear` says which happened. Neither loudnorm's limiter nor the AAC encoder holds the true peak: sharp transients in noise came out at up to +2.2 dBTP against a -1 target. So the finished sound is encoded as the video encodes it and its true peak measured; while it is over the target, the mix is normalised again through a limiter on the sound oversampled 4×, its ceiling lowered by the overshoot. The encoder's overshoot does not always fall as the ceiling does, so a try that lands more than 1 dB under the target is followed by ceilings halfway between it and the nearest one that peaked over; the render keeps the passing try nearest the target, after at most six tries, or if none passes the one that peaked lowest rather than fail. `result.loudness.truePeakDbtp` is the encoded sound's true peak. Silence measures `-inf` and passes through unchanged.
- **Auto grade.** It is measured on up to ten frames of each clip after tone mapping, converted to 8 bits: signalstats' `YBITDEPTH` counts the bits the picture uses, so scaling by it would make dark footage read twice as bright. Every value stays within a few percent of 1.
- **Push-ins.** The crop is taken at the smallest scale the push reaches within the piece and filled into a frame larger than the output by how far it zooms within the piece. `perspective` zooms that frame about the anchor, placing the corners of each frame's rectangle to 1/256 of a pixel, so the zoom glides where crop and scale would step it a whole pixel at a time. The frame is then brought to the output's size, with square pixels though the enlarged frame, rounded to even pixels, is not quite its shape, so even the push's last frame shows the footage's own pixels rather than enlarged output pixels. Each frame's scale follows from the source time it shows, so a push split between pieces carries on where it left off.
- **Match and look.** Each different pair of a match and a look becomes one 33-point 3D LUT, written for the render, which `lut3d` applies after the auto grade in 32-bit float RGB; the conversion there and back loses no 8-bit level.

### Clicks at cuts

Every hard cut gets a 5 ms raised-cosine (`hsin`) fade out and in. The curve and length were chosen by rendering the synthetic 14-clip edit of the [render measurements](MEASUREMENTS.md#render-measurements) at 320×180, with every cut splicing two different tones, and scoring it with `vebench render`:

| Fade at each cut | 0 | 1 ms | 2.5 ms | 5 ms | 10 ms |
|---|---|---|---|---|---|
| Triangle | 12/13 clicks | 6 | 0 | 0 | 0 |
| Quarter sine (equal power) | 12 | 4 | 1 | 0 | 0 |
| Raised cosine | 12 | 0 | 0 | 0 | 0 |

A raised cosine starts and ends with zero slope, so it leaves no corner in the waveform. 5 ms is twice what it needed, and far too short to hear. Dissolves cross-fade the sound with quarter-sine curves, which keep two unrelated takes at an even power.

## Colour

### Matching

Shots from different cameras or phones in one edit are brought toward one reference: the video source the main track uses longest (`match.ts`).

- **Measured as shown.** Ten frames of each clip the edit uses, or one every two seconds of a clip over 20 s, framed as the output frames them, after the clip's auto grade, at 128 pixels on the long side.
- **A camera run backwards.** The correction is a luma-keeping saturation matrix, then a gain and an offset per channel, which covers white balance, exposure, contrast and saturation: `grade.match`'s matrix and offset. For each saturation tried, the gains and offsets are the least-squares fit of the source's channel quantiles (2 % to 98 %) to the reference's; the saturation whose fit leaves the least residual wins. No pixel of one source needs to correspond to a pixel of the other. Quantiles within 1 % of black or white are clipped in one of the two and are left out.
- **Only what a camera could do.** A source is left as it is when the best fit still leaves a residual over 0.02, which means the two show different things rather than one thing through two cameras, or when it needs gains outside ×0.67–1.5, a white balance shift past ×0.67–1.5 between channels, a saturation outside ×0.7–1.4 or an offset over 0.15. One scene through different cameras fits within 0.005; every pair of different footage in the synthetic corpus left 0.037 or more, even two files drawn with the same colours, so none of it was matched. A wide shot and a close-up of one scene also show different things: in a real interview cut from three cameras, a wide two-shot and a close-up of each person, the wide shot left 0.056 against the close-up used most and the other close-up 0.033, so neither was matched ([measurements](MEASUREMENTS.md#colour-measurements)).

### Skin tones

A colour counts as skin by its CIELAB hue (within 20° of 50°, fading out by 35°), chroma (10 to 45) and lightness (20 to 90), ranges that hold skin from very light to very deep, with soft edges so the protection draws no contours. Saturated oranges, greens, blues and greys fall outside them. Where a colour is skin, a turn of its hue and a change of its chroma are limited, and its lightness is not:

- **By a match:** 15° and ×0.5–2. Undoing a camera's white balance turns skin by up to 12° and changes its chroma by ×0.7–1.8 on the synthetic cameras of the [colour measurements](MEASUREMENTS.md#colour-measurements), and faces are what has to agree; further than that, the statistics were misled.
- **By a look:** 3° and ×0.9–1.1. Its warmth reaches the face without turning it orange, grey or green.

### Looks

One look over the whole edit, from `looks.ts`, at an intensity from 0 to 1 that blends from the matched picture to the whole look. Each is a tone curve on L*, a chroma trim and at most a gentle split between shadow and highlight colour. Colour thins out towards black and white, as film's does, so shadows and highlights stay clean instead of tinted.

| Look | For | What it does |
|---|---|---|
| `clean` (default) | Any edit | A gentle S-curve, about 4 % more mid-tone contrast, 3 % more chroma, white kept white, no tint |
| `warm` | Vlogs, lifestyle, people on camera | Lifted blacks, softer contrast, amber highlights (b* +5) and slightly warm shadows |
| `cool` | Tech, business, screen recordings | Firmer contrast, shadows towards blue (b* −4), 5 % less chroma |
| `film` | Story pieces | Matte blacks (L* 5), highlights rolled off to L* 96, teal shadows and amber highlights, 12 % less chroma |

## Voice

[`voice.ts`](src/voice.ts) chooses each source's chain from what vework measured on its speech, as recorded and denoised ([worker](../../worker/README.md#voice)), and `planVoice` writes the decision with those measurements into `audio.voice`. Every stage after the denoiser is chosen from the denoised speech, which is what it receives.

| Stage | When | How hard |
|---|---|---|
| Denoise | The speech is less than 55 dB above the room, or the room reverberates for 0.4 s or more (DeepFilterNet lowers reverberation too); where noise hides the room's reverberation, when the denoised speech still reverberates for 0.21 s or more; and when the recording has under a second of pause to measure the room in | Noise lowered by 55 dB minus the gap between speech and room: 6 to 30 dB, at least 20 dB in a reverberant room, and 30 dB where the room was not measured, since the denoiser takes only 0.2 dB off clean speech |
| De-reverb | The denoised speech still reverberates for 0.35 s or more | An expander 25 dB under the speech, 2:1, its cut deeper the longer the tail: 1.2 dB per 0.1 s past 0.3 s, at most 12 dB |
| High-pass | Always | 80 Hz |
| EQ | Low-mids above their target; presence 0.5 dB or more off its target | A cut at 300 Hz down to the target, at most 4 dB; at 3.5 kHz towards the target, from -3 to +4 dB, never a lift on a clipped recording |
| Leveller | A loudness range of 8 LU or more: a speaker who moves or turns away | Evened over 3 s windows, raising by at most 12 dB, without lifting a phrase's end into the pause after it |
| Compressor | Always | 2 dB over the speech's level, 2:1 to 3:1 as the loudness range grows from 4 to 8 LU; makeup brings every source's speech to -20 LUFS |
| De-esser | Always | Above 6 kHz, harder after a presence lift |
| Limiter | Always | Peaks held 11 dB over the speech, so the loudness pass reaches -14 LUFS with one gain instead of limiting dynamically |

The EQ targets put the low-mids (150–500 Hz) 1 dB over the body (500 Hz–2 kHz), where a long-term average speech spectrum has them, and presence (2–5 kHz) 11 dB under it, a dB brighter than that average. They, like every threshold above, are starting points set on synthetic speech, for the hand-checked corpus to tune.

`loudnessFor(aspect)` gives the loudness the loudness pass normalises to: -14 LUFS for 9:16 and 1:1, which social platforms play at about that level, and -16 for 16:9 long-form, both at -1 dBTP.

**Rendering a chain.** A clip of a source with a decision runs the chain in its piece's sound graph ([`graph/voice.ts`](src/graph/voice.ts)), on the mono mix of its sound, and then plays in both channels:

- **Denoise:** the clip plays from the stem instead of the source, clocked the same way. The stem's recording is mixed back under its denoised speech at the attenuation limit, so nothing is lowered further than that. DeepFilterNet's output is linear in its spectrum, so this is the same as its own limit. The recording comes from the stem, not from the source, because both channels come from one decode; the renderer's own decode need not line up with it sample for sample (see **One time zero** under [How it renders](#how-it-renders)).
- **The other stages** are FFmpeg's agate as a downward expander, highpass, equalizer and its shelves, dynaudnorm, acompressor followed by a volume gain, a fourth-order crossover at the de-esser's frequency whose upper band is compressed and summed back, and alimiter with its look-ahead's delay taken out.
- **Settled at every cut:** the chain starts on the source a second before the clip, or the leveller's window plus a second when there is one, or at the source's start when the clip begins sooner, so its filters are where they would be partway through the source by the clip's first sample and the level does not swell up after a cut. Every piece of a clip starts the chain at that same instant, so a clip split between pieces still joins sample for sample through filters that carry state.

## B-roll sourcing

`@video-editor/engine/broll` finds B-roll from free sources for the planner to place ([visuals](#visuals)). Each capture, clip and icon comes with a `Credit`, and `writeCredits` writes them to `<name>.broll.txt` beside the video, as the music's licences go to `<name>.music.txt`. In order of preference, as an edit should use them:

- **Web capture:** `capturePage` opens a page the speaker names in Chrome Headless Shell, the one the effects render in, at 2x. With `selector` or `text` it crops to that element with 24 px around it and returns its box as `focus`, for a zoom or a highlight to aim at; without, it shows the first screen. With `scroll` it writes an MP4 of that many seconds that eases down the page, panned by FFmpeg over one tall screenshot. Cookie and consent banners and other fixed overlays are hidden, never accepted, and a scroll lock they set is undone. Each capture has a fresh profile and a 20 s limit to load; it never logs in, and never reaches a local or private address, through a redirect or a WebSocket included ([security](../../SECURITY.md#scope)). A page that answers with an error, or a short page that turns the visitor away (a bot check, a block or a captcha), fails instead of being shown. The planner names the page: a product's own address, not a search.
- **Stock footage:** `findStock` searches Pexels, then Pixabay, for a landscape or portrait clip at least `minSeconds` long that the video has not shown yet, and downloads its smallest file whose short side reaches 1080 px, else its largest, to `~/.cache/video-editor/broll/stock/`. It needs the user's own free key, `PEXELS_API_KEY` or `PIXABAY_API_KEY`, in the `.env` as [`.env.example`](../../.env.example) lists; without either it finds nothing and B-roll comes from the other sources. As Pixabay asks, each search is kept for 24 hours, without the key, and clips are downloaded, never linked to. A rejected key or a rate limit (Pexels allows 200 requests an hour, Pixabay 100 a minute) is reported through `onProblem` and the other provider is tried. The credit names the creator and links to the clip's page.
- **Icons and logos:** `findIcon` returns an SVG by name: a symbol from [Lucide](https://lucide.dev) or [Tabler](https://tabler.io/icons) by its name or tags ("rocket", "shopping cart", "idea"), or a brand's logo from [Simple Icons](https://simpleicons.org) in the brand's colour ("GitHub", "Notion"). A symbol named exactly so comes before a brand of the same name; `kind: "logo"` or `"symbol"` asks for one. The three sets are their npm packages' tarballs, pinned by SHA-256 and downloaded on the first lookup, about 15 MB, and kept as 48 MB of SVGs and names in `~/.cache/video-editor/broll/icons/`. A logo's credit notes that it is a trademark, to show only to refer to its brand ([notices](../../THIRD_PARTY_NOTICES.md#icons-and-logos)).
- **Sound effects:** `sfxOf(kind)` lists the CC0 sounds of a kind and `pickSfx(kind, nth)` takes the next one for each use, so a list of items does not repeat one sound. They are for visible actions, not every cut: `click`, dry, for small UI; `tap`, damped, for something landing, such as a logo; `paper`, for a document; `whoosh`, soft air, only for a real move across the frame; `tone`, one short warm note, for a check; `stop`, dry, for an X. 22 files, 144 KB, in `assets/sfx/`: most from Kenney's packs, the air and warm tones drawn by [`scripts/sfx.ts`](scripts/sfx.ts) ([sources](../../THIRD_PARTY_NOTICES.md#sound-effects)).

## FFmpeg

On first use the renderer downloads its pinned FFmpeg build ([which one](../../THIRD_PARTY_NOTICES.md#ffmpeg)), checks it against its SHA-256 and keeps it in `~/.cache/video-editor/` (`%USERPROFILE%\.cache\video-editor\` on Windows). The Linux arm64 build has every library the renderer needs but is not tested.

The effects also need ffprobe, which [HyperFrames](../effects/README.md#rendering) runs to check what it wrote, and Chrome Headless Shell. Both download on the first render with effects:
- **ffprobe:** the static build for the system from the npm packages of [@ffprobe-installer](https://www.npmjs.com/org/ffprobe-installer), pinned by SHA-256 and kept in `~/.cache/video-editor/ffprobe-*/`. `VIDEO_EDITOR_FFPROBE` points at another one.
- **Chrome Headless Shell:** Google's Chrome for Testing build, pinned by version (`CHROME_BUILD` in [`src/chrome.ts`](src/chrome.ts)) and kept in `~/.cache/video-editor/chrome/`. Web capture uses the same one. Chrome for Testing has no Linux arm64 build; `VIDEO_EDITOR_CHROME` points at a Chrome or Chromium there.

`VIDEO_EDITOR_FFMPEG` points the renderer at another FFmpeg instead. Whichever binary it uses must be FFmpeg 7.0 or later, which reads a filter graph from a file (`-/filter_complex`), and must have every filter, encoder and decoder the renderer needs: libass, libx264, zimg, loudnorm and libvpx's VP9 decoder, which reads the overlays' alpha, among them. If it is older or one is missing, the first render fails before any work and names each one.

## Tests

`pnpm --filter @video-editor/engine test` runs every test here except the one that asks Claude, which needs your own key; with `CI` set it skips the ones that need Chrome too ([CONTRIBUTING](../../CONTRIBUTING.md#setup)). The first run downloads the pinned FFmpeg and the caption fonts. Planning tests replay `src/plan/fixtures/talk-plan.json`.
