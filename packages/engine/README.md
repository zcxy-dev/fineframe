# @video-editor/engine

Turns footage into a finished video with one command, [`pnpm edit`](#editing-footage): it has each file analysed, plans the edit with Claude from the media indexes, frames each clip for the output's shape, renders the resulting [`project.json`](../schema/README.md#projectjson) to an MP4 with burned-in captions by driving FFmpeg, and reviews every cut.

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
         ─▶ out/edit.mp4, edit.project.json, edit.srt, edit_cuts.json, edit.music.txt
```

- **Inputs:** files and folders, where a folder stands for the files directly in it. Videos are cut. Still images (JPEG, PNG, WebP, BMP, TIFF) can show as B-roll for up to 8 s, which Claude places by their names alone. Audio files among the footage fail: music comes with `--music`. A video with a `<name>.project.json` beside it is an earlier edit and is not read as footage. The length is 15 s to 1 h, written as 60s, 90, 3m, 1m30s, 1:30, 1h or 1h30.
- **Look:** `--look` names the [look](#colour) over the edit: `clean` unless another is named, or `none`.
- **Analysis** runs `vework analyze` in `worker/` with `uv run --extra ml` on the Python version in `.python-version`, so uv installs the models' packages first if `uv sync --extra ml` ([quick start](../../README.md#quick-start)) has not, and again if a Python upgrade makes it rebuild the environment. `--names terms.txt` reaches vework as `--glossary` with `--asr-context`, and gives the planner the names a lower third may show, and `--correct` turns on [transcript correction](../../worker/README.md#transcript-correction). `--asr cloud` has the speech heard on OpenRouter with `OPENROUTER_API_KEY`, which the command reads from the `.env` as it reads Anthropic's key ([cloud speech](../../worker/README.md#cloud-speech)); `--names` then reaches vework without `--asr-context`, which OpenRouter does not take. Each index is kept in `~/.cache/video-editor/indexes/`, named by the file's SHA-256 and a hash of those options, where the speech was heard, and the worker's code and lockfile, with its [denoised speech](../../worker/README.md#voice) beside it. Another edit of the same footage, at any length or aspect, starts at the plan; a change to the worker analyses again.
- **Music** (`--music`, any number of times): audio files, or folders of them, that Claude may put under the edit ([how](#planning)); without it the edit has no music. Use only music you have the right to use. Each track's licence is the first line of `<name>.txt` beside it, which may go on with a web address where its terms are and a credit line, for example:

  ```text
  CC BY 4.0
  https://creativecommons.org/licenses/by/4.0/
  "Song" by Artist
  ```

  `--music-license "CC0 1.0"` gives the licence of every track without its own file; a track with neither fails before any analysis. Each track is analysed with `vework analyze-music` and its index cached like the footage's, keyed also by its licence. The licences of the music the video plays go to `<name>.music.txt` beside it.
- **Claude:** the key is read as for [planning](#planning). Before any analysis the command looks up the planning model, which costs nothing, so a missing or wrong key fails at once. `estimateCost` in [`plan/estimate.ts`](src/plan/estimate.ts) gives a range for what Claude will cost from the footage's length and the edit's, fitted to the runs below. `--quality economy` plans, and judges the cut checks the review doubts, with `claude-sonnet-5-5` instead of `claude-opus-5-5`, for half the cost; `best` is the default ([measurements](#quality-measurements)).
- **Outputs**, beside the video: `<name>.project.json`, which renders the same video again; `<name>.srt`, the captions burned into the video; the renderer's `edit_cuts.json`; and with music, `<name>.music.txt`. Work files go to `.<name>.edit/` beside the video, removed when the edit ends. A file already at the output path fails the edit unless it is an earlier edit, with its `<name>.project.json` beside it, so footage is never written over.
- **Progress:** each step is one JSON line on stdout, as [progress.schema.json](../schema/README.md#progress-lines) defines it. The line names its stage (`analyze`, `plan`, `render`, `check`) and, while a file is analysed, the file as given. While vework downloads a model on its first use, the lines carry its name and bytes as `download`, at the fraction reached before. The `done` line, and an `error` line after a Claude request, carry what Claude cost so far by stage as `claude`: planning, with the callouts it finds on screen, and the cut checks with what they escalate. After an `error` line the command exits with 1, or with 2 for arguments it cannot use. When every file needs analysis, it takes 90 % of the fraction, shared by file size, as it took 89 to 96 % of a first edit in the runs below. Lines for a person go to stderr: each step, whatever vework prints besides its progress, the review's findings and what each review pass's checks cost, and at the end the time each stage took and what Claude cost in all and by stage; transcript correction's requests are not counted. pnpm prints a banner on stdout first, which `pnpm -s edit` leaves out.
- **Failures** that the inputs cause say what to change: a length outside 15 s to 1 h, no video among the inputs, an audio file among the footage, a track without a licence, an image FFmpeg cannot decode, a file vework cannot read, a missing or wrong key, an output path that holds footage, and a length the footage cannot reach ([how](#planning)). A Claude request that fails after the analysis says the analysis is kept, so running the edit again starts at the plan. A reply that breaks off mid-stream is asked for again twice before that.

### Edit measurements

Each row is one `pnpm edit` run with the real API on 8 cores of an EPYC 9355P shared with other jobs (load average 8 to 10). Every file was analysed with the 0.6B speech model and no transcript correction; the analysis time is from the first edit of that footage, the rest from a later one that found the indexes cached. The synthetic group comes from the [synthetic corpus](../../bench/README.md#synthetic-corpus) (seed 0); the other two are openly licensed web recordings whose transcripts nobody has corrected yet, so their cuts are checked against the words as the analysis timed them. `vebench edit` scores each project and `vebench render` each video:

```bash
pnpm -s edit bench/synthetic/chat-b{1,2,3}/source.mp4 --length 60s --aspect 9:16 \
  -o bench/synthetic/chat-b1/runs/edit-60s/output.mp4 > progress.jsonl
cd bench
uv run vebench edit --project synthetic/chat-b1/runs/edit-60s/output.project.json
uv run vebench render --media synthetic/chat-b1/runs/edit-60s/output.mp4 \
  --cuts synthetic/chat-b1/runs/edit-60s/edit_cuts.json
```

| Footage | Asked | Made | Cuts inside words | Dead air ≥ 1 s | Clicks, drift | Analysis | Plan, render, check | Claude |
|---|---|---|---|---|---|---|---|---|
| chat-b: synthetic conversation, 3 clips, 6.7 min | 60 s, 9:16 | 61.8 s (+2.9 %) | 0 of 10 | 0 | 0 of 4, 0.0 ms | 7.9 min for 2 of the clips | 25 s, 9 s, 7 s | $0.10 |
| chat-b again, with the corpus's three synthetic tracks (`--music`, stated CC0) and a names file naming the guest (`--names`) | 60 s, 9:16 | 60.2 s (+0.3 %) | 0 of 10 | 0 | 0 of 4, 0.0 ms | 11.0 min for the 3 clips | 28 s, 35 s, 8 s | $0.10 |
| Two-person interview, 5 clips from three cameras, 11.9 min | 60 s, 9:16 | 60.6 s (+1.0 %) | 0 of 4 | 0 | 0 of 2, 0.0 ms | 23.9 min | 29 s, 28 s, 5 s | $0.10 |
| Live talks with slides, 3 clips, 8.8 min | 5 min, 16:9 | 301.5 s (+0.5 %) | 0 of 57 | 0 | 0 of 28, 0.0 ms | 16.0 min | 52 s, 60 s, 21 s | $0.13 |

- **Music and effects:** in the second chat-b edit Claude chose the 96 BPM track, which plays under the whole edit with the voice 20.9 dB over it while anyone talks (15.3 dB in the quietest 5 %, `vebench mix` on the render's stems); it showed the guest's name in a lower third and popped three keywords; the sound measures -13.9 LUFS at -3.3 dBTP. It was rendered before punch-ins could enlarge footage past its own detail, so it has none.
- **Time:** the analysis takes about twice the footage's length and is nearly all of a first edit: shot detection about a fifth of it, faces an eighth, transcribing and aligning the rest. Another edit of the same footage starts at the plan and took 41 s to 2.3 min here.
- **Pictures:** in the 9:16 edits the crop follows whoever is on screen, and cuts to the listener's shot with the source. The interview's cuts join two answers inside one camera's shot, so they show as jump cuts; the talks cut between the host and the speaker at a pause.
- **Captions:** on the synthetic edit, each caption appears within 23 ms of its first word's true start at the median and 118 ms at the 95th percentile, and stays up about 0.4 s past its last word.

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
              ─▶ place.ts    clips cut only in pauses, on the frame grids
              ─▶ fit.ts      the length nearest the target, by priority
              ─▶ music.ts    the chosen track on its phrases, under the speech, B-roll on its beats
              ─▶ effects.ts  the effects timed on the speech, one at a time
              ─▶ captions, plan.dropped, colour (grade), punch-ins (framing.scale),
                 a voice chain per source and the loudness for the aspect (see Voice)
              ─▶ project.json
render ─▶ review.ts  a strip around each cut ─▶ claude-haiku-5-5, doubtful ones to the planner's model
                     ─▶ fixes ─▶ fit again ─▶ project.json
```

**What Claude reads.** Each file is packed into `[start-end] text` lines, split on 0.5 s of silence and also at a sentence end with room to cut, so a short edit can start or stop at any sentence. Each line is numbered, and words that are often fillers (嗯, 呃, 那個, 就是, um, uh and a few more) are marked with an id. A header gives the file's length, frame size and rate, shot changes, share of speech and long pauses, loudness peaks and audio events. The index has no speakers, so lines carry no `S0` tag; a file without speech is offered as B-roll, and so is a still image, by its name alone. A file's id is its name. Names that repeat take their folders' names, as corpus clips are all `source.mp4`, or keep their extensions when they share a folder, as a video and its thumbnail do; a name with no character an id allows, such as `訪談.mp4`, becomes `file-1`, `file-2` and so on, and the header keeps the name. The packed transcripts are a cached prefix: a second request for the same footage reads them at a twentieth of the price with Opus, a tenth with Sonnet.

**What Claude decides,** with `claude-opus-5-5` at high effort (`claude-sonnet-5-5` with `quality: "economy"`) and a JSON Schema for its answer: the segments to play, as runs of lines in story order rather than file order, each with a priority from 1 to 5; lines it leaves out as retakes, mistakes or off-topic; which marked words are fillers (那個 is often a real word); fillers the marks missed and false starts inside a line; B-roll over long talking stretches; the moments to emphasise (`plan.emphasis`), which get a push-in ([Framing](#planning)); and the effects over them (below). A target under half the footage's speech asks for its strongest self-contained moments, judged by hook, standalone, arc and ending; a longer one keeps the whole story with the best take of each line. Code checks every line number and id it gets back and ignores what does not resolve; a line also listed as removed does not play.

**What code does.** Code places every cut in the silence between words (`place.ts`):
- A cut stays at least 40 ms from the words on both sides, with up to 0.15 s of silence kept before a word and 0.25 s after it, less in a shorter gap. A pause of more than 0.75 s inside kept speech is dead air, cut down to that breath.
- A filler or false start is cut only where both gaps beside it hold a cut: 0.13 s, or both margins and a frame for a source slower than 20 fps. Otherwise it stays, since cutting there would clip the words it runs into.
- Each clip starts on one of its source's frames and lasts whole output frames, so the renderer moves neither end of it. Otherwise a cut could move by half a source frame plus an output frame, enough to clip a word beside a short gap.

**Length** (`fit.ts`). A target longer than all of the footage's speech, with every pause cut to the longest breath, fails before any request and says the longest the footage allows, or to add footage when that is under 15 s. Claude is asked for about 1.25 times the target. Code then aims for the target itself, not just ±5 %. It weighs each way to shorten the edit in priority order: drop the segment with the highest priority number, the later one among equals, or keep only that segment's first lines; a segment whose dropping would undershoot stays whole, and the next is tried. For each, it stretches or shrinks the breath at every join, by 0.6 to 1.6 times, to come nearest the target, and keeps the nearest within ±5 %; of those within 0.5 % of it, the one that keeps the most. A choice that trims a segment while a less important one plays whole counts only when none in priority order lands within ±5 %. An edit that is still short gets one more request, with what the first answer came to; still short after two, the planner fails, says how long the edit came out, and what to ask for instead. An edit that cannot get short enough without cutting inside a line fails saying the shortest length its lines allow. `plan.fit` records the length and how many steps it took, and `plan.dropped` every stretch of a source left out, whole files included, with why: a filler, a pause, a retake or mistake, a lower priority, or not chosen.

**Captions** are the kept words on the output timeline, as they were said, one line per transcript line or sentence, tagged `zh-TW` or `en` by the language most of their words are in, with any word in the other language tagged too. A Chinese line drops its commas and full stops, as Taiwanese subtitles do, with a full-width space where one fell inside it; question and exclamation marks and quotes stay, and English words stay in English. Edits start with the `bold` preset. Fitting lines to the screen is the [caption renderer's](#captions).

**Music** comes only from tracks the user supplies, each analysed with the licence it is used under. Claude picks the track whose mood fits the content, from its name, tempo and how loud each section is, and the section the edit opens on, or none. Code fits it (`music.ts`):
- **Phrases.** A phrase is 4 bars from the start of a section. The music ends on the track's own ending, the end of its sound, at the edit's last frame. It enters on a bar line of the chosen section within a bar of the edit's start, and skips whole phrases forward, or loops back to the section's first phrase from where the track's last section starts, to reach the length, each join a 40 ms cross-fade 50 ms before the downbeats it joins, so the beat runs on as one grid. An entry on a phrase fades in over a beat; one a bar or more into a phrase fades in until the next phrase starts. Only when no such path fits, as in an edit shorter than the track's last phrase, does the music start at the section and fade out from the last bar line at least 2 s before the end. Paths with fewer joins win, then entries on a phrase.
- **Level.** The music sits 6 LU under the speech's loudness in pauses and is ducked 12 dB more, to 18 LU under, while anyone speaks: down over 250 ms before speech starts and back up over 750 ms after it ends. The renderer takes it further down under a stretch of quieter speech, such as a guest far from the microphone ([below](#how-it-renders)). The speech's loudness is the gated mean of the kept seconds in the media indexes, which weigh each channel as BS.1770 does, as the render's sound is weighed. A source with measured speech plays through its [voice chain](#voice), which brings its speech to -20 LUFS, so its seconds count moved by -20 LUFS minus its speech's measured loudness. A quiet track is raised by at most 12 dB.
- **Beats.** B-roll cuts need not fall between words, so its start moves to the nearest beat within 150 ms of its line, and its end to the last beat its length allows, both on the frame grid. Each music range records the track's licence and, when its beats keep one tempo within 20 ms, the beat grid they were snapped to.

**Effects** come from the [effect templates](../effects/), sparingly: Claude decides which moments get one and what it says, and code times and checks it (`effects.ts`).
- **Keyword pops** on a few of the moments to emphasise, at most three a minute: the word or number, as said, at the top of the frame, its swipe starting 0.15 s before the word is said and lasting 1.5 s.
- **A title** over the opening of an edit of a minute or more that keeps the whole story, from its first word for 3 s. A short edit opens on its hook instead, and in an edit under a minute a title would take too much of it.
- **Chapters** in an edit of two minutes or more: Claude names each and gives the line that opens it, and code marks it with the chapter template (its name and number, for 3.5 s from that line's first word, or from the opening for the first chapter) and hides the cut into each after the first with a wipe centred on it. The shortest section joins the one before it until each runs 30 s or more and there are at most 12; a chapter whose name runs past the template's 20 characters is left out before they are numbered, and with fewer than three there are none. The first marker waits up to 4 s for the title to leave. A shorter edit is not told of chapters at all.
- **Lower thirds** with a person's name and role, 4 s from a second after the line where they first speak, only when names are given (`pnpm edit --names`) and only a name from that list. One waits up to 3 s for an effect already on screen, or B-roll covering the speaker, to leave.
- **Callouts** on screen recordings, where a file's header says it shows one (its framing's `screen` and `screen_cam` shots): Claude gives the line, the words that name the thing, what to look for in a few words and a label, at most one every 20 s. Code (`locate.ts`) sends `claude-haiku-5-5` the frame on screen as the first of those words is said, when that falls in a screen shot, at most 1280 pixels wide, with the line, and gets back the thing's box in pixels, or none. The answer is cached on disk under `~/.cache/video-editor/regions/` by the file's SHA-256, the moment, the target and the line, so planning the footage again asks nothing; a request Claude declines or that fails leaves that callout out. Code then outlines the box from 0.3 s before the words for 3 s, at most three a minute, and only when the box is between 0.05 % and 25 % of the frame, no B-roll covers it, and the clips under it all play that source's screen recording under one still crop with the whole box inside, so it runs on across a jump cut. At the first and last frame each of them plays, the box must look as on the frame it was found on: its pixels change by under 4 grey levels on average, or still correlate by 0.8, so a pointer passing over it is fine and scrolling is not. A screen recording keeps a still crop in the middle, so in a 9:16 edit most of a 16:9 screen is outside it.
- **One at a time,** title first, then chapters, then lower thirds, then callouts, then keywords: at 9:16 the lower third, the chapter marker and a keyword share the top of the frame. Only a wipe and the chapter marker after it overlap. An effect that would overlap another, run shorter than its template's minimum before the edit ends, or break its template's params (a keyword over 12 characters, say) is left out; a subtitle, role or label too long is left out alone.

**Output.** The requested aspect at the largest of 1080, 720, 540 or 360 lines that the footage fills, at the frame rate of the file with the most speech, or at 30 fps when that file runs slower than 23.976 fps, whose frames do not fit in a cut's gap.

**Framing.** Each clip, B-roll included, is framed by [`cropPath`](#framing); an index without faces leaves the renderer's centred crop. Then (`punch.ts`) the planner sets each main-track clip's `framing.scale`, up to 1.2 or the source's headroom, whichever is more. The headroom is the largest scale at which the crop still holds as many source pixels as the output, across and down; up to it, a punch-in adds no softness. Footage with less, such as 1080p edited at 1080 lines, is enlarged by at most 1.2 times more than its framing: the picture softens a little, while a jump cut left in shows. Punch-ins and push-ins zoom about the face of whoever speaks most during the clip (`framing.anchor`), so the face keeps its place on screen and the punch-in closes in on it; without faces in the index, about the crop's centre.
- **Jump cuts.** A hard cut between two clips of one shot of one source, skipping more than a frame, makes the picture jump, as after a removed filler, pause or retake. The framing alternates between wide and 112 % at such cuts, the way an editor hides them. A clip that plays on from where the one before it stopped keeps the framing that one ended at, since a change there would be a jolt rather than a cut. A clip that shows a screen recording at any point, with or without a webcam in a corner, keeps its jump cuts and gets no push-in: a screen's edges hold text and controls. The shot classes in the media index's faces say where the screens are, so an index without them leaves screens treated as camera footage.
- **Push-ins.** A clip pushes in slowly on each `plan.emphasis` moment that starts in it, from 0.5 s before the moment to its end and for at least 2 s: up to 6 %, at most 3 % a second, eased along half a cosine so it starts and stops without a jolt. A second moment in the clip pushes on from where the first push ended, as far as the footage has room. A push under 2 %, because its clip ends or the room runs out first, is left out, and a moment during a dissolve belongs to the clip coming in. A jump cut after a push-in changes the framing by 8 % or more where the footage has room: when neither wide nor 112 % is that far from where the push ended, the cut punches in 12 % from there.
- **How far footage is enlarged.** 1080p footage edited at 16:9 fills a 1080p output exactly, and a portrait edit of landscape 1080p footage already enlarges it 1.78 times, so a punch-in on either enlarges it further, up to 1.2 times. Footage with pixels to spare goes as far as they allow: 1440p 1.33 times at 16:9, and 4K 2 times at 16:9 and 1.125 times in portrait (its crop is 1215 pixels wide for a 1080-pixel frame). On the [synthetic corpus](../../bench/README.md#synthetic-corpus) (720p, seed 0), six edits re-rendered from the same plans (talk-a and chat-b at 60 s, 9:16 and 16:9; phone-c at 30 and 60 s, 9:16) gained 3 punch-ins and 18 push-ins, at most 1.19 times; their lengths, cuts, clicks (0) and drift (0.0 ms) did not change.

**Colour.** `grade.auto` is measured for each clip with `autoGrade`, then the main track's sources are matched to the one it uses longest and the look goes on every clip: `clean` unless `plan()` is given another `look` (`--look` on the command line), or `null` for none (`--look none`). [Colour](#colour) says how.

**Self-review** (`review.ts`). After each render, every cut gets a picture of the two seconds around it: eight frames over the waveform, the cut marked and silences shaded. `claude-haiku-5-5` reads it with the words on both sides and reports a clipped word, a broken sentence, a long silence or a bad frame, with a fix. A check under 0.7 sure, or one that would drop a clip, goes to the planning model, whose answer stands. A fix keeps more silence beside a clipped word, moves the cut to the next pause, puts back a filler whose cut clipped its neighbours, or drops a clip; the length is then fitted again. A review that changes nothing ends the loop, and an edit gets at most three.

### Planner measurements

These runs use the [synthetic corpus](../../bench/README.md#synthetic-corpus) (seed 0), each clip analysed with `vework analyze` and no transcript correction. Each footage was planned, rendered and reviewed at each length its speech allows: the two groups at 16:9, the single clips at 9:16 except the screen recording. The baseline keeps every clip whole, in file order, cut off at the target. `vebench edit` scores both, and `vebench render` the planner's renders.

```bash
# Each clip analysed first: vework analyze <clip>/source.mp4 -o <clip>/index.json
node scripts/plan-corpus.ts ../../bench/synthetic --group talk-a --lengths 30,60,300 --naive
cd ../../bench && uv run vebench report synthetic/
```

| Footage | Target | Length error, naive / planner | Cuts inside words: naive / planned → reviewed | Fillers cut | Retakes right | Dead air ≥ 1 s, naive / planner | Clicks, drift | Claude |
|---|---|---|---|---|---|---|---|---|
| talk-a (3 clips, 7.0 min) | 30 s | +0.0 % / +2.7 % | 0 / 0 → 0 of 6 | 1 of 1 | – | 1 (2 s) / 0 | 0 of 2, 0.0 ms | $0.06 |
| talk-a (3 clips, 7.0 min) | 60 s | +0.0 % / -2.3 % | 1 / 0 → 0 of 12 | 2 of 3 | 1 of 1 | 1 (2 s) / 0 | 0 of 5, 0.0 ms | $0.07 |
| talk-a (3 clips, 7.0 min) | 300 s | +0.0 % / -0.5 % | 1 / 1 → 0 of 28 | 1 of 19 | 3 of 3 | 12 (25 s) / 0 | 0 of 13, 0.0 ms | $0.12 |
| chat-b (3 clips, 6.7 min) | 30 s | +0.0 % / +3.6 % | 0 / 0 → 0 of 4 | 2 of 4 | – | 1 (1 s) / 0 | 0 of 1, 0.0 ms | $0.07 |
| chat-b (3 clips, 6.7 min) | 60 s | +0.0 % / +0.4 % | 0 / 0 → 0 of 10 | 1 of 7 | – | 3 (8 s) / 0 | 0 of 4, 0.0 ms | $0.06 |
| chat-b (3 clips, 6.7 min) | 300 s | +0.0 % / -0.5 % | 1 / 0 → 0 of 48 | 3 of 22 | 3 of 3 | 13 (30 s) / 0 | 0 of 23, 0.0 ms | $0.11 |
| talk-a2 (2.4 min) | 30 s | +0.0 % / -3.1 % | 0 / 0 → 0 of 6 | 0 of 3 | – | 2 (3 s) / 0 | 0 of 2, 0.0 ms | $0.06 |
| talk-a2 (2.4 min) | 60 s | +0.0 % / -3.2 % | 0 / 0 → 0 of 6 | 0 of 4 | – | 3 (5 s) / 0 | 0 of 2, 0.0 ms | $0.06 |
| talk-a3 (2.1 min) | 30 s | +0.0 % / -0.1 % | 1 / 0 → 0 of 6 | 0 of 1 | 1 of 1 | 2 (3 s) / 0 | 0 of 2, 0.0 ms | $0.06 |
| talk-a3 (2.1 min) | 60 s | +0.0 % / +0.9 % | 1 / 0 → 0 of 6 | 0 of 3 | 1 of 1 | 3 (4 s) / 0 | 0 of 2, 0.0 ms | $0.05 |
| phone-c (77 s, 9:16) | 30 s | +0.0 % / -2.7 % | 1 / 0 → 0 of 10 | 2 of 5 | 1 of 1 | 2 (7 s) / 0 | 0 of 4, 0.0 ms | $0.07 |
| phone-c (77 s, 9:16) | 60 s | +0.0 % / +3.8 % | 0 / 0 → 0 of 8 | 0 of 7 | 1 of 1 | 4 (11 s) / 0 | 0 of 3, 0.0 ms | $0.03 |
| screen-d (75 s) | 30 s | +0.0 % / -0.4 % | 0 / 0 → 0 of 12 | 1 of 2 | 1 of 1 | 1 (2 s) / 0 | 0 of 5, 0.0 ms | $0.06 |
| screen-d (75 s) | 60 s | +0.0 % / +2.1 % | 1 / 0 → 0 of 6 | 0 of 5 | 1 of 1 | 2 (6 s) / 0 | 0 of 2, 0.0 ms | $0.02 |

- **Length:** all 14 edits land within ±5 %, 1.9 % off on average and 3.8 % at most.
- **Cuts inside words:** none of 168 after review. As planned, one of 170 was: the index put 0.18 s of silence between 呃 and 講 where the speaker left none, so the cut after the removed filler clipped 講 by 115 ms. The review heard it in the strip and put the filler back. In a separate check, the review passed a cut 30 ms before a word and caught one 100 ms into it.
- **Retakes:** the kept take was the right one in all 13 groups the edits used.
- **Dead air:** none left, against 50 silences of a second or more in the baseline.
- **Fillers:** recall is low, 13 of 86, and precision 1 of 1. Claude marked 38 of the 86 as fillers, some the speech model had written as other characters (您大家好 for 嗯，大家好); code cut those it could. The synthetic voice runs each filler straight into the next word: the median gap after one is 0 s, and only 2 of 69 leave the 0.13 s a cut needs. Whether real speech leaves more room is not measured yet.
- **Cost:** $0.90 for all 14 edits, $0.02 to $0.12 each. Planning is most of it: $0.05 to $0.07 for the first plan of a footage at high effort, and $0.02 to $0.10 for later ones, which read the cached transcripts. The 84 cut checks cost $0.025 together, and the 9 escalated to Opus $0.11.
- **With effects:** the talk-a and chat-b edits were planned, rendered and reviewed again at 30, 60 and 300 s, with the code before the planner placed effects and after it, on the same indexes. Lengths stay within ±5 % (0.5 to 3.6 % off before, 0.5 to 4.1 % after), retakes stay right (8 of 8 both times) and no dead air is left; renders have 0 clicks and 0.0 ms of drift. Each edit now carries one to three keyword pops a minute, and the two 300 s edits open on a title. Cuts inside words, after review: 1 of 110 before and 2 of 114 after. Both are the index's timing, as above: a gap it heard between two words the speaker joined. One is the 115 ms cut into 講 in both runs. The other is new: a cut the review moved, 28 ms into 個.
- **With callouts:** on six frames of the synthetic screen recording screen-d, each where a thing on screen is named, `claude-haiku-5-5` boxed the API key, model and output folder fields and the Save button at 0.98 to 1.00 intersection over union with the generator's truth (`truth/regions.json`), answered not found for an `edit` command the terminal never shows, and boxed the timecodes of a scrolling editor, which the stillness check then rejects. Each request costs $0.0002: about 1,600 tokens in, for a 1280 × 720 frame. screen-d was planned at 45 s and 16:9 once with the code before callouts and four times after, on the same index. Each time after, Claude asked for the same three callouts: the API key field, the length in the terminal command and the subtitle file's timecodes. The length was never found and the timecodes were left out as moving. The API key callout, on target at 0.977 IoU (`vebench edit`), played in both edits made since a callout may run on across a jump cut; of the two before that, one left it out because a cut inside the settings screen came 1.2 s after the field was named. Finding the things cost $0.0008 in three requests the first time, then $0.0002, $0.0003 and nothing, as the cache answered, on top of plans of $0.036 to $0.062 ($0.051 before). Every edit lands within ±5 % (0.7 % off before, at most 0.07 % after), with no cut inside a word, the retake chosen right and no dead air, and the render with its callout has 0 clicks and 0.0 ms of drift. At 9:16 the same field was found but left out: the still middle crop of a 16:9 screen shows a third of its width. An edit of footage without a screen recording is planned from the same instructions, request and schema as before, byte for byte.
- **Nearest length:** the talk-a and chat-b edits were planned, rendered and reviewed again at 15, 30, 60 and 300 s, with the fit that took the first length within ±5 % and with the one that aims for the target, replaying the same plans from Claude. Length off, on average and at most: 2.6 and 2.7 % → 1.6 and 1.6 % at 15 s, 2.7 and 3.5 % → 1.8 and 2.8 % at 30 s, 1.4 and 2.1 % → 0.4 and 0.8 % at 60 s, 1.7 and 2.3 % → 0.0 % at 300 s. A short edit stays a little off where its lines, 2 to 4 s each, allow nothing nearer, and the breath moves a 30 s edit by only about 0.3 s. Both fits leave the same cut inside a word, 1 of 120 (the 115 ms into 講), and have 0 clicks at 52 cuts and 0.0 ms of drift. talk-a3 alone is still too short for 15 s after two requests, and the planner now says to add footage.
- **With chapters:** the talk-a and chat-b edits were planned, rendered and reviewed again at 300 s, with the code before chapters were planned and after, on the same indexes. They now carry 4 and 5 chapters, each marked as it starts, and 2 and 4 wipes; one chapter of talk-a starts inside a clip, where there is no cut to hide, so it has none. Lengths stay within ±5 % (2.5 % off on average after, 4.1 % before), retakes stay right (6 of 6), no dead air is left, and renders have 0 clicks and 0.0 ms of drift. The one cut inside a word in each run is the 115 ms cut into 講, as above. An edit under two minutes is planned from the same instructions, request and schema as before, byte for byte.

### Quality measurements

The talk-a and chat-b groups were planned, rendered and reviewed at 60 and 300 s, at 9:16 and 16:9, twice each, at both qualities: 32 edits, from indexes of the 720p corpus (seed 0) that `vework analyze` wrote on this commit's worker. `best` here is the code before `--quality` existed, which sends the same requests.

```bash
node scripts/plan-corpus.ts <corpus> --group talk-a --group chat-b --lengths 60,300 \
  --aspect 9:16 --quality economy --system economy-916-r1
cd ../../bench && uv run vebench report <corpus>
```

| Footage | Target | Quality | Length error, mean / most | Cuts inside words | Fillers cut | Other words cut between clips | Retakes right | Dead air ≥ 1 s | Clicks, drift | Claude per edit, mean (range) |
|---|---|---|---|---|---|---|---|---|---|---|
| talk-a | 60 s | best | 1.5 / 2.1 % | 0 of 42 | 9 of 13 | 11 | 2 of 2 | 0 | 0 of 17, 0.0 ms | $0.105 ($0.065–0.132) |
| talk-a | 60 s | economy | 0.2 / 0.7 % | 0 of 56 | 11 of 17 | 44 | 4 of 4 | 0 | 0 of 24, 0.0 ms | $0.053 ($0.042–0.063) |
| talk-a | 300 s | best | 0.4 / 1.6 % | 0 of 102 | 4 of 74 | 0 | 12 of 12 | 0 | 0 of 47, 0.0 ms | $0.164 ($0.143–0.188) |
| talk-a | 300 s | economy | 0.1 / 0.1 % | 0 of 114 | 8 of 80 | 28 | 12 of 12 | 0 | 0 of 53, 0.0 ms | $0.090 ($0.059–0.137) |
| chat-b | 60 s | best | 0.5 / 1.8 % | 0 of 44 | 4 of 25 | 6 | – | 0 | 0 of 18, 0.0 ms | $0.106 ($0.090–0.115) |
| chat-b | 60 s | economy | 0.0 / 0.0 % | 0 of 60 | 3 of 21 | 7 | 5 of 5 | 0 | 0 of 26, 0.0 ms | $0.052 ($0.040–0.061) |
| chat-b | 300 s | best | 0.1 / 0.2 % | 0 of 206 | 9 of 92 | 0 | 12 of 12 | 0 | 0 of 99, 0.0 ms | $0.178 ($0.151–0.209) |
| chat-b | 300 s | economy | 0.1 / 0.3 % | 0 of 206 | 10 of 92 | 0 | 12 of 12 | 0 | 0 of 99, 0.0 ms | $0.076 ($0.071–0.087) |

- **Cost:** $0.138 an edit on average at `best` and $0.068 at `economy`, 49 % of it. At `best`, the plan is 78 % of the cost and the judging of doubtful checks 18 %: Opus writes 2,000 to 6,000 tokens for a plan, mostly thinking, at $20 a million. Sonnet writes about as many at half the price, and judges a doubtful check for $0.005 against Opus's $0.013. The Haiku checks cost $0.001 to $0.007 an edit. Every edit was reviewed once: no review changed it.
- **Quality:** every edit lands within ±5 %, with no cut inside a word, no dead air, no clicks and no drift. Each kept take is the right one, at both qualities. Sonnet's edits land nearer the target length. Other words cut between clips are timed truth words that are not fillers, cut out between clips under 3 s apart in their source, which `vebench` counts against filler precision. Here they are short whole lines a 60 s edit leaves out of the story, such as 「所以這個 project 想做的事情很單純，」; `best` leaves out such lines in some runs too. Which moments each quality picks, and how the story reads, is not measured: people have not rated these edits yet.
- **Caching:** the system prompt and the packed transcripts, 7,200 to 8,300 tokens, are the only prefix requests repeat. A plan's first request writes them at 1.25 times the input price; another plan of the same footage within 5 minutes, at another aspect or asking for more material, reads them at a twentieth of Opus's input price or a tenth of Sonnet's. A 60 s and a 300 s plan differ in their instructions and schema, so they do not share it. Over these runs, 7 of 17 economy plans and 3 of 16 best plans read it: caching saved 6 % of economy's planning cost and cost best 1 % more. The cut checks and judgements each send a different picture after an instruction too short to cache.

### Music measurements

The two synthetic groups, each with a silent 20 s test pattern added as B-roll, were planned, rendered and reviewed at 16:9 with the corpus's three synthetic tracks offered; so was a two-clip talk show from the corpus (5.5 min, Mandarin, three people on a sofa) with four licensed tracks: a jazz trio and an orchestral piece and a synth track (CC BY 4.0), and a chill electronic groove (CC0). `vebench report` scores them from the stems the renderer writes.

```bash
# Each track analysed first: vework analyze-music <track> -o <track>.music.json --license "CC0 1.0"
node scripts/plan-corpus.ts ../../bench/synthetic --group talk-a --lengths 30,60,300 \
  --music ../../bench/synthetic/music --system music
cd ../../bench && uv run vebench report synthetic/
```

| Footage | Target | Music Claude chose | Length error | Voice over music while talking: all, quietest 5 % | B-roll edges on a beat |
|---|---|---|---|---|---|
| talk-a | 30 s | 112 BPM, its main section | +2.7 % | 21.7 dB, 16.2 dB | 4 of 4 |
| talk-a | 60 s | 112 BPM, its main section | -3.6 % | 21.3 dB, 16.3 dB | 3 of 4 |
| talk-a | 300 s | 96 BPM, its intro | -3.2 % | 21.1 dB, 15.6 dB | 4 of 6 |
| chat-b | 30 s | 96 BPM, its intro | +1.9 % | 21.0 dB, 15.6 dB | 3 of 4 |
| chat-b | 60 s | 96 BPM, its intro | +3.7 % | 21.0 dB, 15.4 dB | 1 of 2 |
| chat-b | 300 s | 96 BPM, its intro | -1.3 % | 20.8 dB, 14.5 dB | 3 of 4 |
| talk show | 60 s | the chill groove, its first section | +1.6 % | 19.9 dB, 12.6 dB | – |
| talk show | 150 s | the chill groove, its first section | +0.8 % | 21.9 dB, 13.9 dB | – |

- **Speech over music:** the voice, through each source's [voice chain](#voice), stays at least 19.9 dB over the music while anyone talks, against the 18 dB aimed for. The quietest 5 % of 400 ms windows, the ends of phrases, keep 12.6 dB or more. Under the talk show's quieter guests the render rides the music further down.
- **Beats:** every B-roll end lands on a beat, and so does every start with a beat within 150 ms of its line, 18 of 24 edges in all, at most 25 ms from the true beat on the 25 fps frame grid. The other 6 starts had no beat that near.
- **Clicks and drift:** none at the 65 cuts, measured in the sound without the music, nor at the music's 15 joins; no drift. Planned without music, the same footage and lengths had no clicks at 66 cuts either, and lengths within ±4.2 % (±3.7 % with music).
- **Choice:** Claude put the 112 BPM track under the energetic short talks and the 96 BPM one, from its quiet intro, under the conversations and the long talk; under the talk show it chose the chill groove. A 300 s edit plays the 71 s track's intro and main part five times, then its outro, and ends on the track's ending.
- **Not measured yet:** how people rate the result.

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

The `stems` option also writes the mix's parts into a folder, before loudness normalisation scales them alike: `voice.wav`, the main track and B-roll sound, and `music.wav`, the music as ducked. `vebench mix` measures the voice's lead over the music from them, and the review draws its cut strips from `voice.wav`, so music does not fill the pauses it looks for.

Each video source needs its media index from `vework analyze`: the renderer reads the sound, the colour tags and the frame rate from it, and a voice chain that denoises plays the denoised speech the index names. A source whose size or SHA-256 differs from its fingerprint fails the render.

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
| `captions`: [animated, word by word](#captions), and as SubRip | ✅ |
| `audio.voice`: each source's [voice chain](#voice) on the main track | ✅ |

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

It returns nothing when the index has no `framing` or the box already has the source's shape. Otherwise the crop is the largest region of the source with the box's shape, moved by a virtual camera. The source's shape is as displayed, from the index's `sample_aspect`: HDV's 1440 × 1080 with 4:3 pixels is 16:9. The planner and the renderer refuse an index written before vework recorded it.

- **What it follows,** shot by shot, from the shot's layout:
  - one person (`talking_head`): the face that speaks, or the biggest one;
  - two people (`two_shot`) or more (`group`): everyone, when their faces fit in the crop with room around them; otherwise whoever speaks, held through pauses until someone else speaks for a second and a half, so a quick reply or a laugh does not swing the camera there and back. One person's phrases less than a second apart count as one turn;
  - a screen recording, with or without a webcam in a corner (`screen`, `screen_cam`): a still crop in the middle, so text never slides.
- **How it moves:**
  - It holds still while the subject stays within a dead zone around the crop's centre.
  - Beyond it, it re-centres with a pan that eases in and out under a top speed, so a subject who walks off is caught up with at that speed.
  - A switch to a speaker more than a crop's width away cuts instead of panning across the space between them.
  - At a shot change, it cuts to the new shot's framing.
  - A crop that moves up and down leaves headroom above the face.
  - A median over a few samples drops single-sample detector jumps.

On the synthetic corpus's three conversations, framed 9:16, the face of the person talking is inside the crop 99.4 % of the time it is on screen, missing only replies too short to turn to; a centre crop holds it 80.5 % of the time, and in the wide shots shows the empty space between the two people. Cut together from eight clips, the moving crops add no clicks and no drift (`vebench render`: 0 of 7 cuts, 0.0 ms).

The path depends only on the source, so two clips cut from one shot frame it the same way. `CAMERA` holds the dead zone, top speed and acceleration; the fourth argument overrides them.

**Rendering a path:** FFmpeg's crop filter evaluates the path at every output frame. Frame *n* of a span shows source time `start + n` frames, so the keyframes become frame numbers, and the crop's centre is linear between them. A cut is two keyframes one tick apart, so no frame falls between them. The crop moves in whole source pixels. The path is read a millisecond after each frame's time, as the picture is, so a cut lands on the frame that shows the new shot. FFmpeg reads each piece's filter graph from a file, so a path of any length fits. A path whose crop changes size fails the render with its JSON path.

## Captions

`captions.lines` are drawn over the finished picture by libass, word by word, in the preset `captions.preset` names:

| Preset | Type | The word being spoken |
|---|---|---|
| `bold` | Heavy white type with a dark stroke and a soft shadow; a caption settles in from 90 % | turns amber |
| `spotlight` | Heavy white type on a soft dark halo | sits on an amber pill |
| `sweep` | As `bold`, without the settle | amber sweeps through it as it is said (karaoke) |
| `boxed` | Bold white type on a dark rounded plate | brightens: words not said yet show at half strength |

The presets share the effect templates' palette (white, near-black and one amber accent) and one motion. Fades bracket silence: a caption after a pause fades in over 160 ms, easing out, and one before a pause fades out over 100 ms, while back-to-back captions switch at full strength so the text never dims between phrases. The highlight moves to the next word in 80 ms. The values are in [`src/captions/presets.ts`](src/captions/presets.ts).

**Size and place.** The type is sized from the frame's shorter side, and each aspect has its place and row length:

| Aspect | Type size | Longest row | Rows | Bottom of the last row |
|---|---|---|---|---|
| 9:16 | 7 % of the width | 10 Chinese characters | 2 | 72 % down |
| 1:1 | 6 % | 12 | 2 | 86 % down |
| 16:9 | 5.8 % of the height | 16 | 1 | 90 % down |

At 9:16 the rows keep to about the middle 70 % of the width, and even when moved stay above the bottom 22 %, clear of the buttons and the description that short-form apps draw over the video. A caption that would cover a face moves just above or below it, whichever is nearer, within its aspect's band: the faces are the media index's `framing`, seen through each clip's crop and punch-in, and a face under full-frame B-roll does not count. The next caption in the same shot keeps that place, so captions do not hop between phrases.

**Line breaking.** Each line is split into captions of one or two rows:
- at its pauses first (a full-width space or punctuation), so a caption holds whole phrases;
- otherwise between words: Chinese where ICU's dictionary ends a word (`Intl.Segmenter`), English at spaces. An English word is never split, and a Chinese word only when it is wider than a row;
- never with closing punctuation (，。」？！… and the like) at the start of a row or opening punctuation at its end;
- into two rows as close in width as those breaks allow, rather than end a row on a word that leads into the next (都不, 最, 在) or start one with a particle (的, 了, 嗎).

**Timing.** A caption shows from the first frame of its first word. One caption shows at a time; a line's last caption stays up 0.5 s after its last word unless the next line starts sooner. Each word is lit from the first output frame at or after its start until the next word starts, and a line's last word for 150 ms after its sound ends. ASS counts centiseconds and FFmpeg hands libass each frame's time cut to a whole millisecond, so every event time is rounded down from a millisecond before its frame: each caption and highlight appears and leaves on exactly the frame it was laid out on, at every common frame rate from 23.976 to 60 fps.

**Font.** Noto Sans CJK TC (OFL-1.1), Bold and Black: the full CJK font rather than the smaller Noto Sans TC, which lacks rarer ideographs such as 𠮷. It is downloaded on first use from a pinned commit, checked against its SHA-256 and kept in `~/.cache/video-editor/`. The render hands libass the face files itself, so captions are drawn in the faces their layout was measured in whatever fonts the machine has; a line with a character they lack fails the render, naming the line, before anything is rendered.

**Samples.** `node scripts/caption-samples.ts <project.json> <folder>` renders a planned edit in every preset at every aspect, each with a strip of eight frames on which a word starts, labelled with the frame, its time and the word.

**Measured.** The planner's edits of the [synthetic corpus](../../bench/README.md#synthetic-corpus) (seed 0) talk-a2, 30 s at 9:16, and chat-b, 60 s at 16:9, rendered with their captions score as they do without them in `vebench report`: 1.7 % and 2.3 % off the length, no cut inside a word, 0 clicks and 0.0 ms drift. On a 62.6 s 9:16 edit of a corpus interview, libass draws the `bold` captions (1,260 events over 1,566 frames at 1080×1920) in 3.2 s more than decoding the frames alone takes, about 2 ms a frame. Captions were not rendered with Remotion for comparison: its effect overlays take about 0.2 s a frame at 1080p ([effects](../effects/README.md#rendering)), about a hundred times as long, so captions are drawn by libass. The two have not been compared by look.

## How it renders

```text
project.json ─▶ timeline.ts  every clip and overlay on the output frame grid, in whole frames
                             and samples
             ─▶ effects      each overlay rendered by @video-editor/effects, or taken from its cache
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
- **Music.** Each range of a track is clocked from its source like a clip's sound, faded (quarter sine; ranges without a fade get the 5 ms cut fade) and set to its gain. Ducking follows where the media indexes found speech in the clips and heard B-roll the edit plays, mapped onto the output timeline: a gain envelope computed beforehand, at 1 kHz, which FFmpeg resamples and multiplies in. It starts down before speech starts, which a compressor listening to the voice cannot, and stays down through pauses too short to come back up for half a second. Under each stretch of speech whose momentary loudness in the rendered sound, gated as BS.1770 gates, falls under that of all the edit's speech, the music goes down by the difference too, up to 12 dB, over the attack before the stretch starts: the planner set it under the speech as a whole, and a quiet speaker would otherwise have it that much closer. The bed is added to the main sound before loudness is measured, so normalisation covers both and keeps the voice's lead.
- **Loudness.** Two-pass loudnorm to the project's target. The second pass is a linear gain when the true-peak ceiling allows it; otherwise loudnorm falls back to dynamic normalisation, and `result.loudness.linear` says which happened. Neither loudnorm's limiter nor the AAC encoder holds the true peak: sharp transients in noise came out at up to +2.2 dBTP against a -1 target. So the finished sound is encoded as the video encodes it and its true peak measured; while it is over the target, the mix is normalised again through a limiter on the sound oversampled 4×, its ceiling lowered by the overshoot, at most four times. The encoder's overshoot does not always fall as the ceiling does, so if no try meets the target the render keeps the one that peaked lowest rather than fail. `result.loudness.truePeakDbtp` is the encoded sound's true peak. Silence measures `-inf` and passes through unchanged.
- **Auto grade.** It is measured on up to ten frames of each clip after tone mapping, converted to 8 bits: signalstats' `YBITDEPTH` counts the bits the picture uses, so scaling by it would make dark footage read twice as bright. Every value stays within a few percent of 1.
- **Push-ins.** The crop is taken at the push's smallest scale and filled into a frame larger than the output by the push's whole zoom. `perspective` zooms that frame about the anchor, placing the corners of each frame's rectangle to 1/256 of a pixel, so the zoom glides where crop and scale would step it a whole pixel at a time. The frame is then brought to the output's size, so even the push's last frame shows the footage's own pixels rather than enlarged output pixels. Each frame's scale follows from the source time it shows, so a push split between pieces carries on where it left off.
- **Match and look.** Each different pair of a match and a look becomes one 33-point 3D LUT, written for the render, which `lut3d` applies after the auto grade in 32-bit float RGB; the conversion there and back loses no 8-bit level.

### Clicks at cuts

Every hard cut gets a 5 ms raised-cosine (`hsin`) fade out and in. The curve and length were chosen by rendering the synthetic 14-clip edit below at 320×180, with every cut splicing two different tones, and scoring it with `vebench render`:

| Fade at each cut | 0 | 1 ms | 2.5 ms | 5 ms | 10 ms |
|---|---|---|---|---|---|
| Triangle | 12/13 clicks | 6 | 0 | 0 | 0 |
| Quarter sine (equal power) | 12 | 4 | 1 | 0 | 0 |
| Raised cosine | 12 | 0 | 0 | 0 | 0 |

A raised cosine starts and ends with zero slope, so it leaves no corner in the waveform. 5 ms is twice what it needed, and far too short to hear. Dissolves cross-fade the sound with quarter-sine curves, which keep two unrelated takes at an even power.

### Measurements

These runs use synthetic footage from `scripts/synthetic-edit.ts`. The script renders two edits from test patterns at 1920×1080, the first also with effect overlays across its cuts. The sources cover 24, 25, 30 and 60 fps, a variable rate, a rotated phone clip, 10-bit PQ, a file without sound and a silent track, each with its own tone.

```bash
node scripts/synthetic-edit.ts /tmp/synthetic-edit --width 1920 --height 1080
cd ../../bench && uv run vebench report /tmp/synthetic-edit
```

| `vebench report` | Cuts | Clicks | Max \|drift\| |
|---|---|---|---|
| This renderer: 14 hard cuts, then dissolves, a dip, B-roll and framing | 18 | 0 | 0.0 ms |
| The same 14 cuts with each clip encoded alone with 30 ms fades and joined with `-c copy` | 13 | 0 | 57.6 ms |
| The same 14 cuts with seven effect overlays across them | 13 | 0 | 0.0 ms |

Peak memory of the whole render without overlays, every FFmpeg process included, on 0.4–0.5 s clips. Each overlay a piece spans adds one VP9 decoder ([its memory](../effects/README.md#format)).

| Source | Clips | One FFmpeg with an input per clip | Pieces |
|---|---|---|---|
| H.264 1080p30 | 10 / 50 / 150 | 1.3 / 4.6 / 11.3 GB (≈110 MB a clip) | 1.27 / 1.27 / 1.27 GB |
| HEVC 4K 10-bit PQ | 5 / 30 | ≈650 MB a clip | 1.63 / 1.68 GB |

## Colour

### Matching

Shots from different cameras or phones in one edit are brought toward one reference: the video source the main track uses longest (`match.ts`).

- **Measured as shown.** Ten frames of each clip the edit uses, or one every two seconds of a clip over 20 s, framed as the output frames them, after the clip's auto grade, at 128 pixels on the long side.
- **A camera run backwards.** The correction is a luma-keeping saturation matrix, then a gain and an offset per channel, which covers white balance, exposure, contrast and saturation: `grade.match`'s matrix and offset. For each saturation tried, the gains and offsets are the least-squares fit of the source's channel quantiles (2 % to 98 %) to the reference's; the saturation whose fit leaves the least residual wins. No pixel of one source needs to correspond to a pixel of the other. Quantiles within 1 % of black or white are clipped in one of the two and are left out.
- **Only what a camera could do.** A source is left as it is when the best fit still leaves a residual over 0.02, which means the two show different things rather than one thing through two cameras, or when it needs gains outside ×0.67–1.5, a white balance shift past ×0.67–1.5 between channels, a saturation outside ×0.7–1.4 or an offset over 0.15. One scene through different cameras fits within 0.005; every pair of different footage in the synthetic corpus left 0.037 or more, even two files drawn with the same colours, so none of it was matched. A wide shot and a close-up of one scene also show different things: in a real interview cut from three cameras, a wide two-shot and a close-up of each person, the wide shot left 0.056 against the close-up used most and the other close-up 0.033, so neither was matched ([measurements](#colour-measurements)).

### Skin tones

A colour counts as skin by its CIELAB hue (within 20° of 50°, fading out by 35°), chroma (10 to 45) and lightness (20 to 90), ranges that hold skin from very light to very deep, with soft edges so the protection draws no contours. Saturated oranges, greens, blues and greys fall outside them. Where a colour is skin, a turn of its hue and a change of its chroma are limited, and its lightness is not:

- **By a match:** 15° and ×0.5–2. Undoing a camera's white balance turns skin by up to 12° and changes its chroma by ×0.7–1.8 on the synthetic cameras below, and faces are what has to agree; further than that, the statistics were misled.
- **By a look:** 3° and ×0.9–1.1. Its warmth reaches the face without turning it orange, grey or green.

### Looks

One look over the whole edit, from `looks.ts`, at an intensity from 0 to 1 that blends from the matched picture to the whole look. Each is a tone curve on L*, a chroma trim and at most a gentle split between shadow and highlight colour. Colour thins out towards black and white, as film's does, so shadows and highlights stay clean instead of tinted.

| Look | For | What it does |
|---|---|---|
| `clean` (default) | Any edit | A gentle S-curve, about 4 % more mid-tone contrast, 3 % more chroma, white kept white, no tint |
| `warm` | Vlogs, lifestyle, people on camera | Lifted blacks, softer contrast, amber highlights (b* +5) and slightly warm shadows |
| `cool` | Tech, business, screen recordings | Firmer contrast, shadows towards blue (b* −4), 5 % less chroma |
| `film` | Story pieces | Matte blacks (L* 5), highlights rolled off to L* 96, teal shadows and amber highlights, 12 % less chroma |

### Colour measurements

`scripts/finishing-preview.ts` draws one synthetic scene, a colour chart and six skin tones beside a face, and records it through four cameras with known differences: the reference; one warm and dark (white balance R ×1.18, B ×0.80, −0.4 stop); one cool, flat and bright (R ×0.88, B ×1.15, +0.3 stop, saturation ×0.9, contrast ×0.85); and one punchy and green (G ×1.06, saturation ×1.2, contrast ×1.12). White balance and exposure act in linear light, saturation and contrast in R'G'B', and each is clipped to 8 bits as a camera records. The four are cut into one edit and graded as the planner grades it, and every patch's mean colour is compared with the reference camera's by CIEDE2000.

```bash
node scripts/finishing-preview.ts out/finishing --scene <clip folder>@<seconds> --edit <run folder>
```

ΔE00 of each camera's 30 patches from the reference camera's: mean / largest / mean of the 8 skin tones.

| Camera | Before matching (auto grade only) | Matched | Matched, with the `clean` look on both |
|---|---|---|---|
| Warm and dark | 6.38 / 11.74 / 4.54 | 1.01 / 2.83 / 0.96 | 0.92 / 2.88 / 0.76 |
| Cool, flat and bright | 5.48 / 7.03 / 6.29 | 1.11 / 3.61 / 1.00 | 1.28 / 3.20 / 1.64 |
| Punchy and green | 4.63 / 6.38 / 4.79 | 0.95 / 5.52 / 0.97 | 0.97 / 5.49 / 1.03 |

**The bar: a mean ΔE00 of 2 or less for each camera.** A ΔE00 of about 1 is the smallest difference seen with two colours side by side; display calibration commonly accepts an average under 2 as accurate. Shots in an edit are seen one after another, not side by side, so a camera within 2 of the reference on average reads as the same camera. Every matched camera meets it, and so do its skin tones. The largest differences left for the cool and punchy cameras are on the white patch, which they recorded past 255: no correction brings back what was not recorded.

**Real footage.** A corpus interview is cut from three cameras: a wide two-shot and a close-up of each person. Each camera's footage was cut into its own source, and an edit alternating between them was graded as the planner grades it. Both cameras were left unmatched (above), so each surface differs as much afterwards as before. One person's cheek, in the wide shot and in the close-up the edit uses most, differs by ΔE00 17.4, mostly in chroma (C* 39.6 against 15.0). The other person's cheek, in the wide shot and in that person's close-up, differs by 10.2. The angle of the light on a face changes with the camera, so not all of these differences are the cameras'.

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

The EQ targets put the low-mids (150–500 Hz) 1 dB over the body (500 Hz–2 kHz), where a long-term average speech spectrum has them, and presence (2–5 kHz) 11 dB under it, a dB brighter than that average. They, like every threshold above, are starting points set on synthetic speech, for the hand-checked corpus and a blind review to tune.

`loudnessFor(aspect)` gives the loudness the loudness pass normalises to: -14 LUFS for 9:16 and 1:1, which social platforms play at about that level, and -16 for 16:9 long-form, both at -1 dBTP.

**Rendering a chain.** A clip of a source with a decision runs the chain in its piece's sound graph ([`graph/voice.ts`](src/graph/voice.ts)), on the mono mix of its sound, and then plays in both channels:

- **Denoise:** the clip plays from the stem instead of the source, clocked the same way. The stem's recording is mixed back under its denoised speech at the attenuation limit, so nothing is lowered further than that. DeepFilterNet's output is linear in its spectrum, so this is the same as its own limit. The recording comes from the stem, not from the source, because both channels come from one decode; the renderer's own decode need not line up with it sample for sample (see **One time zero** under [How it renders](#how-it-renders)).
- **The other stages** are FFmpeg's agate as a downward expander, highpass, equalizer and its shelves, dynaudnorm, acompressor followed by a volume gain, a fourth-order crossover at the de-esser's frequency whose upper band is compressed and summed back, and alimiter with its look-ahead's delay taken out.
- **Settled at every cut:** the chain starts on the source a second before the clip, or the leveller's window plus a second when there is one, or at the source's start when the clip begins sooner, so its filters are where they would be partway through the source by the clip's first sample and the level does not swell up after a cut. Every piece of a clip starts the chain at that same instant, so a clip split between pieces still joins sample for sample through filters that carry state.

### Voice measurements

**Synthetic.** Two [synthetic-corpus](../../bench/README.md#synthetic-corpus) clips degraded on purpose: `phone-c` (voice B, 77 s, rendered 9:16 to -14 LUFS) and `screen-d` (voice A, 75 s, 16:9 to -16 LUFS). Each was given pink noise at 20 and 10 dB SNR against its speech, a synthetic room (exponentially decaying noise, as loud as the direct sound) of RT60 0.6 s, a 0.5 s room with noise at 15 dB, or its level stepped down by 12 dB and then up to -5 dB over half a second each, as a speaker turning away does. `vework analyze` measured each, `planVoice` chose its chain, and it was rendered whole and cut at its pauses, without a voice chain ("plain") and with one. The speech-only measures read the synthetic truth's word times; "room under the speech" is speech loudness minus the noise floor; a word's drop is its level against the clip as generated, less the median of all words' change.

| Degradation | Clip | Chain chosen | Room under the speech | Loudness range | Spread of the thirds | RT60 | Words over 6 dB down (worst) |
|---|---|---|---|---|---|---|---|
| As generated | phone | denoise 18.4 dB, EQ -3.4 / +3.4, 2:1 | 35 → 47 dB | 3.2 → 3.1 LU | 0.4 → 0.2 dB | 0.12 → 0.10 s | 0 (-3.9) → 1 (-6.0) |
| As generated | screen | denoise 17.8 dB, EQ +4, 2:1 | 36 → 49 dB | 2.4 → 1.9 LU | 0.2 → 0.1 dB | 0.10 → 0.09 s | 0 (-0.9) → 0 (-5.5) |
| Pink noise, 20 dB SNR | phone | denoise 30 dB, EQ -3.6 / +4, 2:1 | 18 → 39 dB | 3.6 → 3.1 LU | 0.4 → 0.2 dB | 0.14 → 0.10 s | 0 (-3.9) → 0 (-5.9) |
| Pink noise, 20 dB SNR | screen | denoise 30 dB, EQ +4, 2:1 | 19 → 44 dB | 2.7 → 1.9 LU | 0.2 → 0.1 dB | 0.09 → 0.09 s | 0 (-0.9) → 0 (-5.6) |
| Pink noise, 10 dB SNR | phone | denoise 30 dB, EQ -3.6 / +4, 2:1 | 9 → 32 dB | 2.8 → 3.2 LU | 0.2 → 0.3 dB | – → 0.10 s | 0 (-4.9) → 1 (-10.3) |
| Pink noise, 10 dB SNR | screen | denoise 30 dB, EQ +4, 2:1 | 10 → 35 dB | 2.4 → 1.9 LU | 0.6 → 0.1 dB | – → 0.09 s | 0 (-0.8) → 0 (-5.5) |
| Room, RT60 0.6 s | phone | denoise 20 dB, EQ -2.4 / +3.7, 2:1 | 35 → 48 dB | 3.1 → 3.1 LU | 0.5 → 0.4 dB | 0.58 → 0.33 s | 0 (-3.7) → 0 (-5.4) |
| Room, RT60 0.6 s | screen | denoise 20 dB, EQ +4, 2:1 | 34 → 48 dB | 2.4 → 1.8 LU | 0.2 → 0.2 dB | 0.58 → 0.36 s | 0 (-4.8) → 0 (-4.9) |
| Room 0.5 s and noise 15 dB | phone | denoise 30 dB, EQ -3.4 / +4, 2:1 | 16 → 38 dB | 3.3 → 3.3 LU | 0.4 → 0.6 dB | 0.38 → 0.25 s | 1 (-6.1) → 5 (-14.1) |
| Room 0.5 s and noise 15 dB | screen | denoise 30 dB, EQ +4, 2:1 | 17 → 40 dB | 3.0 → 1.9 LU | 0.4 → 0.1 dB | 0.47 → 0.23 s | 0 (-3.1) → 0 (-4.2) |
| Level steps of -12 and -5 dB | phone | denoise 25.1 dB, leveller, EQ -3.5 / +3.6, 2:1 | 27 → 41 dB | 7.0 → 3.2 LU | 5.0 → 0.3 dB | 0.13 → 0.09 s | 0 (-5.8) → 2 (-6.4) |
| Level steps of -12 and -5 dB | screen | denoise 23.5 dB, leveller, EQ +4, 2:1 | 28 → 43 dB | 10.6 → 2.9 LU | 7.7 → 0.8 dB | 0.10 → 0.09 s | 43 (-9.5) → 2 (-7.8) |

- **Noise:** the room ends 12 to 25 dB further under the speech than in the plain render, at the same loudness; the plain render's dynamic loudness pass lifts it by up to 4 dB over the source. DeepFilterNet lowers reverberation as well: the 0.6 s rooms read 0.25 s in its output and about 0.35 s after the chain, whose compression lifts the tail after each word again.
- **Levels:** every voice render reads its speech at -13.5 to -13.6 LUFS (9:16) or -15.6 (16:9) whatever was done to it; the plain renders spread over 1.4 LU. The leveller turns the stepped clips' 12 dB between their thirds into 0.3 and 0.8 dB, where the plain render's dynamic loudness pass leaves 5.0 and 7.7.
- **No word is gated, but heavy noise costs voice B a few soft syllables.** The denoised stem keeps every word of the clean clips within 0.2 dB of the rest, and voice A within 6 dB everywhere. Most drops in the table are the EQ's work on hummed words such as "um" under the low-mid cut. In noise at 15 dB or less, the denoiser also lowers a few of voice B's soft syllables, the nasal 名 by 9 dB at 10 dB SNR and by 15 dB in the noisy room; mixing the recording back by its limit does not bring them back. The plain renders' drops are the level steps themselves.
- **Peaks:** with the limiter, loudness normalisation reaches its target with one linear gain on every voice render (true peak -3.1 to -7.2 dBTP); every plain render needed loudnorm's dynamic mode. No render has a sample within 0.1 dB of full scale.

**Real recordings.** Three openly licensed [corpus](../../bench/README.md#corpus-layout) clips with audible rooms, measured the same way against their own recording and the words `vework` transcribed from it (their transcripts are not hand-checked yet): `wikilive-d1` and `wikilive-d2`, a webcam livestream talk show of one host and two guests (172 s and 159 s), and `wikidata-openrefine`, a meetup filmed across the room (176 s, about 60 % speech). All three are 16:9, rendered to -16 LUFS. "Room under the speech" is given for the recording, the plain render and the voice render; so is the loudness range.

| Clip | Chain chosen | Room under the speech | Loudness range | Spread of the thirds | True peak, plain → voice |
|---|---|---|---|---|---|
| `wikilive-d1` | denoise 30 dB, leveller, 2:1 | 9 / 6 → 22 dB | 13.2 / 11.3 → 3.6 LU | 1.3 / 2.7 → 0.4 dB | -3.8 → -5.8 dBTP |
| `wikilive-d2` | denoise 30 dB, leveller, 2:1 | 8 / 7 → 21 dB | 15.9 / 11.1 → 3.7 LU | 2.1 / 1.5 → 1.0 dB | -1.2 → -5.7 dBTP |
| `wikidata-openrefine` | denoise 30 dB, leveller, EQ +1.7, 2:1 | 21 / 17 → 32 dB | 16.9 / 13.5 → 10.5 LU | 8.5 / 5.3 → 2.1 dB | -1.0 → -5.4 dBTP |

- **Noise:** the room ends 14 to 16 dB further under the speech than in the plain render. `wikilive-d2` has under a second of pause away from speech, so its noise floor is not measured and it is denoised by the most, as its measured twin is.
- **Levels:** the host and guests come out at one level: the loudness range falls from 13 to 16 LU to 3.6 and 3.7 LU on the talk show, and the spread between the thirds of the speech to 1 dB or less. The meetup's range, over a track that is about 40 % without speech, stays at 10.5 LU, while its speech's thirds come within 2.0 dB of each other.
- **Words:** the denoiser keeps the words that stand clear of the room. Of the words 12 dB or more above it, it lowers 4 of 67, 7 of 63 and 11 of 290 by more than 6 dB against the rest; words within 6 dB of the room lose what was noise in them. After the denoiser, compression and the leveller take the loudest words down several dB towards the rest, as intended. No sample comes within 0.1 dB of full scale in any recording or render.
- **Peaks:** before the renderer checked the encoded true peak, the talk show's plain renders peaked at +2.2 and -0.8 dBTP, though their mastered sound was at -1.0: the AAC encoder added the rest. Re-rendered with the check, they peak at -3.8 and -1.2 dBTP. On `wikilive-d1` the encoder's overshoot fell from 3.2 dB to 0.5 dB as the limiter went lower, so the second try lands 2.8 dB under the target and its loudness 0.6 LU under -16 LUFS. The voice renders peak far enough under the target that they are not limited, and measure the same as before. The cut renders still have 0 clicks and 0.0 ms of drift.

**Cuts:** `vebench report` on the renders cut at every pause, both clips of each synthetic degradation pooled (124 cuts each way) and the three real clips pooled (57 cuts each way): 0 clicks and 0.0 ms of drift, plain and voice alike, in every group.

**Word timings** stay put. `vework analyze` transcribed the processed render of `phone-c` with 10 dB of noise, and `vebench report` scored it against the clip's truth beside the degraded audio's transcript; with the noise gone the aligner finds word ends better:

| `phone-c`, pink noise at 10 dB SNR, transcribed from | MER | Start error p50 / p95 | End error p50 / p95 | Within 50 / 100 ms |
|---|---|---|---|---|
| The degraded audio | 7.1 % | 27 / 85 ms | 69 / 167 ms | 23 / 70 % |
| The processed render | 4.9 % | 22 / 76 ms | 30 / 133 ms | 61 / 88 % |
| For reference, the clip as generated | 5.2 % | 27 / 75 ms | 27 / 75 ms | 65 / 93 % |

On the real clips, without a hand-checked transcript, the render's transcript was scored against the recording's. The two agree on word timings (starts 15 to 23 ms apart at the median) but not always on the words: the mixed-script error between them is 5.0 % on `wikilive-d2`, 13.1 % on `wikilive-d1` and 37.8 % on `wikidata-openrefine`, whose crosstalk the speech model misreads differently in each, in places hearing more words in the render. Which of each pair is right waits for the corrected transcripts.

## FFmpeg

On first use the renderer downloads its pinned FFmpeg build ([which one](../../THIRD_PARTY_NOTICES.md#ffmpeg)), checks it against its SHA-256 and keeps it in `~/.cache/video-editor/`. The Intel macOS build is built by the project from pinned sources ([how](../../THIRD_PARTY_NOTICES.md#ffmpeg)), since the one imageio-binaries publishes may not be redistributed. CI tests the Linux x64 and both macOS builds, rendering a [synthetic edit](scripts/synthetic-edit.ts) on Apple silicon and on Intel that vebench scores for clicks and drift; the Linux arm64 build has every library the renderer needs but is not tested.

`VIDEO_EDITOR_FFMPEG` points the renderer at another FFmpeg instead. Whichever binary it uses must be FFmpeg 7.0 or later, which reads a filter graph from a file (`-/filter_complex`), and must have every filter, encoder and decoder the renderer needs: libass, libx264, zimg, loudnorm and libvpx's VP9 decoder, which reads the overlays' alpha, among them. If it is older or one is missing, the first render fails before any work and names each one.

## Tests

`pnpm --filter @video-editor/engine test` unit-tests the graph builders without FFmpeg. It then renders synthetic footage made with FFmpeg's lavfi sources, at sizes small enough for CI. The render tests check that every frame and sample is exact, and that picture and sound stay in step at each frame rate. They also cover rotation, non-square pixels cropped where the plan puts the crop, untagged colour, a crop path moving frame by frame and one too long for a command line, a clip past its source's end, sound split between pieces, Matroska and WebM sound on the media index's timeline, silence, a mix louder than 0 LUFS, changed sources and fields that are not rendered yet. Overlays drawn by FFmpeg, numbered frame by frame, check that each lands on exactly its frames across cuts and dissolves at 30 and 29.97 fps. The caption tests break random mixed lines (every character kept, every row within its width, no closing punctuation starting a row), check frame by frame that the SubRip shows exactly what is burned in, for every preset and aspect at 30 and 29.97 fps, that each event lands on its own frame at every common rate, and that captions keep off faces seen through a crop; a render checks the pixels of captions on exactly their frames. `framing.test.ts` checks the camera on made-up detections: jitter, speaker switches near and far, quick replies, a clip ending on a switch, two or three faces that fit, a subject that runs, shot changes, screens, a portrait source and one with non-square pixels. The first run downloads the pinned FFmpeg and the caption fonts.

One test renders every effect template through Remotion and checks that each shows only within its own frames. It is skipped where `CI` is set, because Remotion downloads Chrome and bundles its page on the first run; run it locally when you change `packages/effects` or how overlays are composited.

Colour tests check CIEDE2000 against Sharma, Wu and Dalal's published pairs, the skin limits, each look's tone and tint, and that matching undoes known camera differences on synthetic pixels but leaves a screen recording unmatched against a talk. Render tests check that a push-in zooms by exactly its scale on every frame, centred, across pieces, and that a rendered match and look agree with the LUT's own colours to two 8-bit levels, written to a folder whose name has every character a filter graph treats specially.

The edit's tests run the whole command on a synthetic talk and a still, with a stand-in for vework (`src/edit/fixtures/vework.ts`) and Claude's recorded plan: the outputs, the progress lines, the index cache, and each failure the inputs can cause.

The planner's tests cover packing, filler candidates, cut placement (no cut inside a word over randomised timings, and every clip on both frame grids so the renderer moves no cut), length fitting, captions, punch-ins and push-ins, and the review's fixes; one renders a planned edit with its captions. Planning tests replay a reply Claude gave for a short synthetic talk (`src/plan/fixtures/talk-plan.json`), so they need no key. One test asks the real API and runs only with your own key, as [CONTRIBUTING](../../CONTRIBUTING.md#setup) says.
