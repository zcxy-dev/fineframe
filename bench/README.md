# vebench

Scores the editor's output against ground truth (the synthetic corpus's exact truth, or
hand-checked truth for real footage), so every pipeline change is measured on the same clips
with the same numbers.
A [blind review](#blind-review) covers what numbers cannot: people rate the finished edits.

## Corpus layout

Corpus footage is self-recorded or CC-licensed, and only its truth files may be committed. No real-footage corpus is published yet; the [synthetic corpus](#synthetic-corpus) is generated on demand.

```text
corpus/<clip>/
  source.mp4                      the footage (any extension)
  truth/transcript.json|srt|txt   corrected transcript; JSON may carry word timings
  truth/shots.json                {"transitions": [{"start": 12.4}, {"start": 30.0, "end": 30.8}]}
  truth/edit.json                 what a good edit removes and keeps (see below); optional
  truth/speakers.json             who talks when (see below); optional
  truth/regions.json              things on a screen recording a callout may point at; optional
  runs/<run>/                     one folder per run scored, e.g. one version or setting
    transcript.json|srt|txt
    shots.json                    detected cuts: [12.41, 30.2] or {"cuts": [...]}
    speakers.json                 who the run says talks when, under its own labels
    output.mp4                    a rendered edit
    edit_cuts.json                where that edit's cuts fall in its own timeline, in seconds
    voice.wav, music.wav          that edit's sound in two parts, from the renderer's stems
    project.json                  the planned edit; a group's lives with its first clip
```

Transcript JSON is `{"words": [{"text", "start", "end"}]}` in seconds; entries with a `type`
other than `word` are skipped. SRT is scored on text only.

A transition with `end` is gradual (dissolve or fade): a detected cut anywhere inside it counts.

Clips whose names share a prefix and end in a number (`talk-a1`, `talk-a2`) are one group:
footage of one shoot, edited together.

## Ground truth

- **Transcript text:** typed or corrected by a person in Traditional Chinese. Write numbers,
  English words and punctuation the way the subtitles should show them. Keep the fillers that
  were said (嗯, 那個, um).
- **Word timings:** checked by ear, not copied from an aligner. Otherwise the benchmark only
  measures agreement with that aligner. Timings may cover just part of a clip; only timed words
  are scored for timing.

To start a clip's transcript from a machine draft:

```bash
cd worker
uv run vework draft-truth ../bench/corpus/<clip>
```

It transcribes `source.<ext>` with Qwen3-ASR-1.7B, the most accurate model and the slowest on a
CPU ([speeds](../README.md#quick-start)); `--asr-model` picks another. It writes
`truth/transcript.json`: one entry per sentence, with `draft_time` saying roughly where it is in
the audio. `--force` lets it overwrite an existing `transcript.json`; it never writes beside a
`transcript.srt` or `.txt`, which the draft would replace as truth. Then:

1. **Correct the text.** Listen through the clip and fix each entry's `text`.
2. **Time a sample by ear.** For two or three entries per clip, find where each word starts and
   ends (an audio editor's label track works), and replace the entry with its words, each
   `{"text", "start", "end"}`. The other entries stay untimed: `draft_time` is the aligner's
   guess and is never scored.
3. **Delete the `draft` key.** vebench refuses a transcript that still has it, so an
   uncorrected draft never counts as truth.
4. **Mark the shot transitions** in `truth/shots.json`.

## Edit truth

`truth/edit.json` describes what an edit of the clip should do. Times are seconds in the clip.

```jsonc
{
  "group": "talk-a",
  // Filler words to cut: "那個" as a filler, not "那個 click 聲" (that click).
  "fillers": [{"start": 1.62, "end": 1.85, "text": "嗯"}],
  // Every stretch of at least 1 s without speech, the start and end of the clip included.
  "pauses": [{"start": 0.0, "end": 1.6}, {"start": 31.2, "end": 34.9}],
  // Attempts at one line, in order, each with the words that abandon it; `keep` is the take
  // the edit should use.
  "retakes": [{"takes": [{"start": 40.1, "end": 43.0}, {"start": 44.2, "end": 47.9}], "keep": 1}],
  // Stretches of the story; `order` is their place in the group's finished edit, which can
  // differ from recording order (a hook recorded last but shown first).
  "story": [{"start": 1.6, "end": 95.0, "order": 1, "topic": "開場與動機"}]
}
```

`vebench edit` and `report` score a planned edit against it (see [Metrics](#metrics)).

## Speaker truth

`truth/speakers.json` lists who talks when, for scoring whether framing follows the person
talking. Mark a turn for every stretch one person talks, from their first word to their last,
without the pauses of a second or more in it. Set `visible` to `false` while the person talking is
off screen, as in a voice-over or a shot of someone else listening; it defaults to `true`.

```json
{"turns": [{"start": 1.6, "end": 8.2, "speaker": "A"},
           {"start": 8.9, "end": 12.0, "speaker": "B"},
           {"start": 12.0, "end": 14.5, "speaker": "B", "visible": false}]}
```

A run's `speakers.json` has the same shape, without `visible`, naming people by its own labels:
`vework analyze --bench-run` writes one turn per speaking face, such as `face-3`.

## Synthetic corpus

`vebench synth` generates a corpus whose truth is known exactly, because every word, cut and
beat in it was placed by the generator. It needs no footage or permission to publish, and
stands in for real footage: no hand-checked corpus of it exists, and the measurements that would
need one (word timings, framing, captions and edits on real clips) are not made.

```bash
uv run vebench synthetic synthetic/    # the published seed-0 corpus, 64 MB
uv sync --extra synth                  # or generate it: Kokoro TTS, its G2P and Pillow
uv run vebench synth synthetic/ --seed 0
```

`vebench synthetic` downloads seed 0 as the
[`corpus-synthetic-seed0-v1`](https://github.com/zcxy-dev/fineframe/releases/tag/corpus-synthetic-seed0-v1)
release publishes it, checks its SHA-256 and unpacks it, so every machine measures on the same
files; measurements use it. `vebench synth` writes 16 minutes of clips and 85 MB to
`bench/synthetic/`, which git ignores, in 5 to 7 minutes on the
[reference machine](#reference-machine); the first run also downloads 330 MB of speech model.
The same seed gives the same files with the same lockfile on the same machine, not on another.

| Clips | Content |
|---|---|
| `talk-a1`–`talk-a3` (7.0 min) | One presenter: camera angles of a drawn set, a terminal, an editor and slides; a hook recorded after the outro |
| `chat-b1`–`chat-b3` (6.7 min) | Two people talking, cut between a wide shot and one camera on each, with a dissolve in each clip |
| `phone-c` (77 s) | A handheld walk in portrait, stored sideways with a display rotation; one unbroken shot |
| `screen-d` (75 s) | A 60 fps screen recording |

Every clip mixes Chinese and English within sentences, and has fillers (嗯, 那個, um, uh),
pauses of 2 to 5 s and retakes. The talk clips run at 25 fps, the others at 30 or 60.

- **Speech:** [Kokoro-82M-v1.1-zh](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh), offline
  on a CPU, voices `zf_001` (A) and `zm_010` (B). Each line is synthesized whole. Between two
  words, the boundary is the model's own phoneme durations, which the audio is decoded from, on
  its 25 ms frames. Where a word meets silence, the edge is where its sound starts or stops in
  the clean synthesized signal, to 5 ms: the model stretches a phrase's last syllable over the
  silence after it. Both voices are Mandarin speakers reading the English too.
- **Pictures:** drawn with numpy and Pillow. The presenters are cartoon figures whose mouths open
  with their own speech. Their faces have eye whites, brows, a nose and a shaded edge, which is
  enough for YuNet to find them, so who speaks can be scored here.
- **Truth:** `transcript.json` (each word also names its `speaker`), `shots.json` (a cut on the
  new shot's first frame; a dissolve from its first blended frame to the first frame of the new
  shot alone), `edit.json` and `speakers.json`, and for clips with screens `regions.json`: the
  things on them that hold still while they show (a settings form's fields and Save button, an
  editor's file list, a slide's lines), each `{"start", "end", "name", "rect"}` with the rect
  `{"x", "y", "w", "h"}` in fractions of the picture, from when the screen shows alone until the
  next shot starts coming in. A terminal's lines and an editor's code move, so they have none. A speaker is on screen in the wide shot, in their
  own close-up and on the phone; during a dissolve, in either shot.

`synthetic/music/` holds drum-and-bass tracks with known beats for beat-synced cuts,
`beat-<bpm>.wav` beside `beat-<bpm>.json`:

```jsonc
{"bpm": 112, "meter": 4, "duration": 71.142854, "beats": [0.5, 1.035714, 1.571429, …],
 "downbeats": [1.571429, 3.714286, …],
 "sections": [{"start": 0.0, "end": 18.714286, "parts": "hb"}, …]}
```

Kicks land on beats 1 and 3, snares on 2 and 4, hi-hats on every eighth and a bass note on 1
and 3; a track can start a beat or two of hi-hats before its first downbeat. Each track has an
intro, a main section with everything and an outro, each of whole 4-bar phrases; `parts` names
what plays in each: `k`ick, `s`nare, `h`i-hats and `b`ass.

## ASCEND

`vebench ascend` builds a transcription corpus from real speech with human transcripts:
[ASCEND](https://huggingface.co/datasets/CAiRE/ASCEND) by Lovenia et al. (CC BY-SA 4.0, [attribution](../THIRD_PARTY_NOTICES.md#ascend)), conversations in
Mandarin and English that switch between them, recorded in Hong Kong.

```bash
uv sync --extra synth          # OpenCC, for the Taiwan Traditional transcripts
uv run vebench ascend corpus/  # 200 utterances of the test split, seed 0
```

It takes a seeded sample of the test split's utterances of 1.5 s or more, downloads each from
Hugging Face's dataset viewer (15.8 minutes of speech), checks it against the SHA-256 in
[`ascend.json`](src/vebench/ascend.json) and joins each recording session's into a clip:
`corpus/ascend-s<session>/source.mp4`, the utterances in the order they were said, 1 s apart,
over a black picture, and `truth/transcript.txt`, their transcripts converted to Taiwan
Traditional Chinese with OpenCC's `s2twp`, as the worker converts its own. ASCEND has no word
timings, so only the error rates are scored. The transcripts stay under ASCEND's licence and are
never committed.

## Commands

```bash
uv run vebench report corpus/
uv run vebench synthetic synthetic/
uv run vebench tables
uv run vebench synth synthetic/ --seed 0
uv run vebench ascend corpus/
uv run vebench transcript --ref truth.json --hyp hyp.json
uv run vebench shots --ref truth/shots.json --hyp shots.json --tolerance 0.1
uv run vebench speakers --ref truth/speakers.json --hyp speakers.json
uv run vebench render --media output.mp4 --cuts edit_cuts.json
uv run vebench mix --voice voice.wav --music music.wav --project project.json
uv run vebench beats --ref synthetic/music/beat-112.json --hyp beat-112.music.json
uv run vebench edit --project runs/video-editor-60s/project.json
uv run vebench edit --project runs/video-editor-60s/project.json --edges picture
```

## Results tables

A measurement's table lives as data: `bench/results/<name>.json` holds
`{"doc": "<path from the repository root>", "columns": [...], "rows": [[...], ...]}`, and the
document shows it between `<!-- results:<name> -->` and `<!-- /results -->`.
`uv run vebench tables` writes every table into its document; CI runs it with `--check` and
fails when a document's table differs from its data. Change the JSON, never the table, and when
two pull requests touch the same document, run `vebench tables` again after the rebase. Older
tables are moved to data when they are next measured.

## Reference machine

Run times and memory in this repository's docs were measured on 8 cores of an EPYC 9355P.

## Metrics

- **`mer`:** mixed error rate. Every CJK character (Han, kana, bopomofo, Hangul) is one token, and
  every other run of letters or digits (an English word, a number) is one token. Text is
  NFKC-normalized and lowercased; punctuation is ignored. `cjk_error_rate` and `latin_error_rate`
  split the errors by script, so mistakes at code-switch points are visible.
- **`timing`:** start and end error of correctly recognized tokens. A unit that spans several
  characters is split evenly across them.
- **`shots`:** one-to-one matching within `--tolerance`, reported as precision, recall and F1,
  plus recall for hard cuts and gradual transitions separately.
- **`speakers`:** how much of the time exactly one person talks, on screen, the run names that
  person (`accuracy`), someone else (`wrong`) or no one (`missed`). Each of the run's labels counts
  as the person it overlaps most, so a label per face per shot works without linking faces across
  shots; a run making up a new label every second would be flattered, and so would one that always
  names the same wrong face of a pair. Off screen, `offscreen_named` is the share of that time it
  names anyone, which it should not. Times when two people talk at once are not scored.
- **`render.clicks`:** cuts where a sample jump stands far above the surrounding audio. In
  `report`, a run with a `voice.wav` stem is checked in it, since a drum hit of the music under
  a cut would read as a click in the finished sound.
- **`render.drift_ms`:** where the decoded audio ends minus where the last video frame ends;
  positive means the audio runs late. A late audio start and gaps are filled from the stream
  timestamps, so they count. Encoder padding kept at each cut makes the audio fall further
  behind the picture with every cut. ITU-R BT.1359 puts the detectable lag at about 125 ms.
- **`mix`:** whether speech stays clear over music, from a render's voice and music stems,
  each metered by FFmpeg's EBU R128 meter in 400 ms windows every 100 ms. Talking is the
  voice's windows within 10 LU of its own gated loudness, as BS.1770 gates. `over_music_db` is
  the voice's loudness over the music's while talking, and `p5_over_music_db` the 5th
  percentile of the windows, the quiet ends of phrases; `music_in_gaps_lufs` is the music where
  the voice is under -50 LUFS. With `--project` (in `report`, the run's `project.json`),
  `join_clicks` counts the music's joins, the middle of each cross-fade between two ranges, that
  click as a cut would. `report` gives the smallest margins over the edits and the joins'
  total.
- **`beats`:** a music index against beat truth: beat and downbeat F-measure, one-to-one
  matches within ±70 ms as mir_eval counts them, the matched beats' mean and largest offset,
  and the tempo's error.
- **`edit`:** a `project.json` against the edit truth of each clip its sources come from: a
  source at `<clip>/source.<ext>` is scored with `<clip>/truth/`. A clip is judged where its
  sound starts and ends: at `soundIn` and `soundOut` when it has them, the sound edges a cut
  in a pause too short for a frame sets inside the clip's first or last frame, and at
  `in` and `out` otherwise. `--edges picture` judges every clip at `in` and `out`, as `edit`
  did before sound edges.
  - `length`: the edit's length against its target, and whether it lands within the tolerance.
  - `cuts`: clip edges strictly inside a timed truth word, and the deepest, in milliseconds.
    The start and end of a source file are not cuts.
  - `fillers`: recall is the share of truth fillers within 1 s of a played clip that do not
    play. Precision is the share of fillers among the timed truth words cut out between clips
    less than 3 s apart in their source. Fillers and words of a take the truth does not keep
    are a retake decision and count toward neither.
  - `retakes`: a group is right when its `keep` take plays and no other does (each by at least
    half its length); a group with no take playing is `unused`.
  - `dead_air`: silences of 1 s or more on the output timeline, from the truth pauses and the
    gaps between consecutive timed truth words that the clips play. A silence ending one clip
    and one starting the next add up, so two short gaps joined at a cut can make dead air.
  - `beats`: B-roll edges and overlay starts, on the output frame grid as the renderer places
    them, against the true beats of the music under them (`<track>.json` beside a synthetic
    track). `near` counts the edges with a beat within 150 ms, which the planner should have
    put on one, and `max_abs_ms` and `mean_abs_ms` are how far those are from it.
  - `callouts`: each callout's box, taken back through its clip's framing to the source's
    picture 0.3 s after it starts, when the thing it points at is named, against the truth
    regions on screen then: `ious` holds each one's best intersection over union, and
    `on_target` counts those of 0.5 or more. A callout over a source without `regions.json`
    counts in `count` but is not scored; pooled, `scored` says how many were.

`report` pools each run's counts across clips, by folder name. It also lists, per run:
- **`missing`:** outputs absent for clips that have truth;
- **`errors`:** outputs that failed to score.

A run's pooled numbers cover only the clips it was scored on.

## Blind review

People rate the editor's finished edits without knowing which version of the pipeline made them. A round
is a folder with one subfolder per footage and target length:

```text
bench/review/<round>/             git-ignored
  <item>/<version>.mp4            e.g. talk-60s/main.mp4, or talk-60s/before.mp4 and after.mp4
  ratings.jsonl                   written by vebench review
```

```bash
uv run vebench review review/round-1 --rater alex   # prints the local address to open
uv run vebench review-report review/round-1          # prints the results as Markdown
```

- **Alone or A/B:** an item with one edit is rated alone. An item with two or more versions of
  its edit, such as before and after a pipeline change or two presets, is rated in pairs: every
  two versions side by side as Edit A and Edit B, then the one the rater would rather post, or
  no preference.
- **Shuffled:** each session shuffles the order, and which version sits on which side, with a
  seed (`--seed`, random by default) and saves the seed with every rating.
- **Blind:** the page shows neutral labels only; version names, items and file paths stay in the
  server. Check that no edit carries a title or watermark naming its version.
- **Ratings:** each edit gets 1–5 for story and pacing, cut quality, caption accuracy and look,
  framing, audio, effects, and overall "would post this".
- **Local:** the server listens on 127.0.0.1 only, so the footage stays on this machine. Edits
  must play in a browser; H.264 MP4 is the safe choice.
- **Captions:** the page shows the picture and sound only, not subtitle tracks, so an edit's
  captions must be burned into the picture. An edit whose captions exist only as a subtitle
  track would be scored as if it had none.
- **Resuming:** each rating is appended to `ratings.jsonl` when it is saved. Starting again with
  the same `--rater` continues with what that rater has not rated.

Two lines of `ratings.jsonl`, an edit rated alone and a pair, with the scores shortened:

```json
{"time": "2026-10-15T08:00:00+00:00", "rater": "alex", "seed": 2026, "item": "talk-60s",
 "versions": ["main"], "scores": {"main": {"story": 4, "…": 4}}}
{"time": "2026-10-15T08:04:00+00:00", "rater": "alex", "seed": 2026, "item": "talk-5min",
 "versions": ["after", "before"],
 "scores": {"after": {"story": 4, "…": 4}, "before": {"story": 3, "…": 3}}, "preferred": "after"}
```

`versions` lists the edits in the order shown: Edit A (left, or on top on a phone), then Edit B.
The scale keys are `story`, `cuts`, `captions`, `framing`, `audio`, `effects` and `overall`.
`preferred` is `null` for no preference.

`review-report` gives, for each version rated alone, the mean of each scale and the number of
ratings. Means pool by version name across items, so give every item's edit the same name (e.g.
`main.mp4`) to get the round's mean per category. For each two versions rated together, it gives the means on the ratings where they met
and the preference rate, which counts no preference as half for each.
