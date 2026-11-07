# Engine measurements

How the engine's behaviour, described in the [README](README.md), measures on the [synthetic corpus](../../bench/README.md#synthetic-corpus) and on openly licensed footage. Times are on the [reference machine](../../bench/README.md#reference-machine). Each section says whether its edits had rich visuals (the default, here always without stock footage) or `--visuals minimal`.

## Edit measurements

Each row is one `pnpm edit` run with the real API, every file analysed with the 0.6B speech model and no transcript correction; `vebench edit` scores each project and `vebench render` each video. The synthetic rows are the [synthetic corpus](../../bench/README.md#synthetic-corpus) (seed 0), edited at `--quality best` without a Pexels or Pixabay key; the second gives the corpus's three synthetic tracks and a names file, and its Visuals column says which visuals it had. The real rows are openly licensed web recordings without corrected transcripts, so their cuts are checked against the words as the analysis timed them, on the machine shared with other jobs.

```bash
PEXELS_API_KEY= PIXABAY_API_KEY= pnpm -s edit bench/synthetic/chat-b{1,2,3}/source.mp4 --length 60s --aspect 9:16 \
  -o bench/synthetic/chat-b1/runs/edit-60s/output.mp4 > progress.jsonl
cd bench
uv run vebench edit --project synthetic/chat-b1/runs/edit-60s/output.project.json
uv run vebench render --media synthetic/chat-b1/runs/edit-60s/output.mp4 \
  --cuts synthetic/chat-b1/runs/edit-60s/edit_cuts.json
```

<!-- results:engine-edit -->
| Footage | Visuals | Asked | Made | Cuts inside words | Dead air ≥ 1 s | Clicks, drift | Analysis | Plan, render, check | Claude |
|---|---|---|---|---|---|---|---|---|---|
| chat-b: synthetic conversation, 3 clips, 6.7 min | rich, without stock footage: 8 motion graphics (2 labels, 1 lower third, 3 panels, 2 full frame), 61 % of the edit | 60 s, 9:16 | 60.0 s (0.0 %) | 0 of 10 | 0 | 0 of 4, 0.0 ms | from the cache | 3.2 min, 71 s, 7 s | $0.57 |
| chat-b again, with the corpus's three synthetic tracks (`--music`, stated CC0) and a names file naming the guest (`--names`) | rich, measured with the cards before motion graphics: 5 cards, 29 % of the edit | 60 s, 9:16 | 59.3 s (-1.2 %) | 0 of 12 | 0 | 0 of 5, 0.0 ms | 9.9 min for the 3 clips and 3 tracks | 58 s, 44 s, 8 s | $0.20 |
| Two-person interview, 5 clips from three cameras, 11.9 min | minimal, measured before rich visuals | 60 s, 9:16 | 60.6 s (+1.0 %) | 0 of 4 | 0 | 0 of 2, 0.0 ms | 23.9 min | 29 s, 28 s, 5 s | $0.10 |
| Live talks with slides, 3 clips, 8.8 min | minimal, measured before rich visuals | 5 min, 16:9 | 301.5 s (+0.5 %) | 0 of 57 | 0 | 0 of 28, 0.0 ms | 16.0 min | 52 s, 60 s, 21 s | $0.13 |
<!-- /results -->

- **Music and effects:** in the second chat-b edit Claude chose the 96 BPM track, with the voice 21.0 dB over it while anyone talks (15.0 dB in the quietest 5 %, `vebench mix`), and its one join does not click; the sound measures -13.9 LUFS at -3.1 dBTP.
- **Visuals:** the first edit shows 8 of the 10 graphics Claude wrote, on screen for 61 % of the edit and full frame for 22 %; the placer left out one too close to the graphic before, and the checks a panel that filled too little of its area.
- **Cost:** $0.57 for the first edit, $0.47 of it for the graphics (writing them, $0.29, and one request to fix the ones the checks failed).
- **Time:** shot detection takes about a fifth of an analysis, faces an eighth, transcribing and aligning the rest. Another edit of the same footage starts at the plan: 4.5 min for the first edit, 3.2 min of it planning, writing and checking the graphics.
- **Captions:** on a synthetic edit with `--visuals minimal`, each caption appears within 23 ms of its first word's true start at the median and 118 ms at the 95th percentile, and stays up about 0.4 s past its last word.

## Shorts measurements

Each row is one `pnpm edit --shorts` run with the real API, with rich visuals and `--quality best`, from cached indexes: real-2 with `--asr cloud`, talk-a from the [synthetic corpus](../../bench/README.md#synthetic-corpus) (seed 0). `vebench render` scores each short's video and `vebench edit` its length; every clip edge is checked against the words as the analysis timed them. Times are not given: other jobs ran on the machine.

```bash
pnpm -s edit bench/corpus/real-2/source.mp4 --shorts 5 --length 30-60s --aspect 9:16 --asr cloud \
  -o out/shorts > progress.jsonl
cd bench
uv run vebench render --media ../out/shorts/01/edit.mp4 --cuts ../out/shorts/01/edit_cuts.json
uv run vebench edit --project ../out/shorts/01/edit.project.json
```

<!-- results:engine-shorts -->
| Footage | Asked | Made | Off the length planned | Clicks, drift | Edges inside a word | Claude: finding, each short, in all |
|---|---|---|---|---|---|---|
| real-2: Q&A vlog, Mandarin, 13.8 min | 5 of 30–60 s, 9:16 | 5: 45 to 51 s | -1.0 to +2.8 % | 0 of 6, 0.0 ms | 0 of 22 | $0.07, $0.35–0.41, $2.04 |
| talk-a: synthetic talk, 3 clips, 7.0 min | 5 of 30–60 s, 9:16 | 3 (3 moments found): 31 to 43 s | -3.4 to +2.4 % | 0 of 4, 0.0 ms | 0 of 14 | $0.05, $0.36–0.42, $1.20 |
| talk-a: synthetic talk, 3 clips, 7.0 min | 2 of 15–30 s, 9:16 | 2: 26 and 30 s | +0.7 and +4.8 % | 0 of 3, 0.0 ms | 0 of 10 | $0.05, $0.34–0.36, $0.75 |
<!-- /results -->

- **Moments:** Claude found 6 moments in real-2 and 3 in talk-a; the best five and all three were made. Each short plays only its stretch: 66 to 95 s of the source for real-2's shorts of 45 to 51 s.
- **Cost:** finding the moments reads every transcript once: $0.05 for 7 minutes and $0.07 for 14, at most about $0.30 an hour. Each short costs about what an edit of its length does, most of it the motion graphics. `estimateShortsCost` is fitted to these runs.

## Planner measurements

Each footage of the [synthetic corpus](../../bench/README.md#synthetic-corpus) (seed 0), analysed with the 0.6B speech model and no transcript correction, planned, rendered and reviewed at each length its speech allows, with rich visuals and `--quality best`: the two groups at 16:9, the single clips at 9:16 except the screen recording. The naive baseline keeps every clip whole, in file order, cut off at the target. `vebench edit` scores both, and `vebench render` the planner's renders. Costs are those of Claude's recorded replies, which the script replays.

```bash
# Each clip is analysed once into the index cache, then read from it
PEXELS_API_KEY= PIXABAY_API_KEY= node --env-file=../../.env scripts/plan-corpus.ts ../../bench/synthetic \
  --group talk-a --lengths 30,60,300 --naive --system after --live-claude
cd ../../bench && uv run vebench report synthetic/
```

<!-- results:engine-planner -->
| Footage | Target | Length error, naive / planner | Cuts inside words: naive / planned → reviewed | Fillers cut | Retakes right | Dead air ≥ 1 s, naive / planner | Clicks, drift | Graphics (on screen, full frame) | Claude |
|---|---|---|---|---|---|---|---|---|---|
| talk-a (3 clips, 7.0 min) | 30 s | +0.0 % / -1.7 % | 0 / 0 → 0 of 8 | 1 of 1 | 1 of 1 | 1 (2 s) / 0 | 0 of 3, 0.0 ms | 4 (52 %, full frame 16 %) | $0.34 |
| talk-a (3 clips, 7.0 min) | 60 s | +0.0 % / +0.5 % | 1 / 0 → 0 of 8 | 2 of 3 | – | 1 (2 s) / 0 | 0 of 3, 0.0 ms | 5 (38 %, full frame 22 %) | $0.25 |
| talk-a (3 clips, 7.0 min) | 300 s | +0.0 % / +0.9 % | 1 / 0 → 0 of 26 | 1 of 20 | 3 of 3 | 12 (25 s) / 0 | 0 of 12, 0.0 ms | 27 (36 %, full frame 11 %) | $0.98 |
| chat-b (3 clips, 6.7 min) | 30 s | +0.0 % / -3.3 % | 0 / 0 → 0 of 4 | 0 of 3 | – | 1 (1 s) / 0 | 0 of 1, 0.0 ms | 5 (58 %, full frame 16 %) | $0.25 |
| chat-b (3 clips, 6.7 min) | 60 s | +0.0 % / +1.9 % | 0 / 0 → 0 of 10 | 3 of 8 | – | 3 (8 s) / 0 | 0 of 4, 0.0 ms | 10 (66 %, full frame 22 %) | $0.41 |
| chat-b (3 clips, 6.7 min) | 300 s | +0.0 % / +0.0 % | 1 / 0 → 0 of 50 | 1 of 22 | 3 of 3 | 13 (30 s) / 0 | 0 of 24, 0.0 ms | 21 (34 %, full frame 18 %) | $1.19 |
| talk-a2 (2.4 min) | 30 s | +0.0 % / +1.3 % | 0 / 0 → 0 of 6 | 1 of 2 | – | 2 (3 s) / 0 | 0 of 2, 0.0 ms | 5 (62 %, full frame 0 %) | $0.32 |
| talk-a2 (2.4 min) | 60 s | +0.0 % / -2.3 % | 0 / 0 → 0 of 6 | 0 of 4 | – | 3 (5 s) / 0 | 0 of 2, 0.0 ms | 10 (64 %, full frame 0 %) | $0.59 |
| talk-a3 (2.1 min) | 30 s | +0.0 % / +2.7 % | 1 / 0 → 0 of 6 | 1 of 4 | – | 2 (3 s) / 0 | 0 of 2, 0.0 ms | 4 (53 %, full frame 0 %) | $0.37 |
| talk-a3 (2.1 min) | 60 s | +0.0 % / -0.5 % | 1 / 0 → 0 of 8 | 1 of 4 | 1 of 1 | 3 (4 s) / 0 | 0 of 3, 0.0 ms | 5 (39 %, full frame 0 %) | $0.57 |
| phone-c (77 s, 9:16) | 30 s | +0.0 % / -0.3 % | 1 / 0 → 0 of 12 | 2 of 6 | 1 of 1 | 2 (7 s) / 0 | 0 of 5, 0.0 ms | 4 (34 %, full frame 0 %) | $0.32 |
| phone-c (77 s, 9:16) | 60 s | +0.0 % / -0.4 % | 0 / 0 → 0 of 8 | 0 of 7 | 1 of 1 | 4 (11 s) / 0 | 0 of 3, 0.0 ms | 8 (45 %, full frame 0 %) | $0.51 |
| screen-d (75 s) | 30 s | +0.0 % / +0.0 % | 0 / 0 → 0 of 10 | 1 of 2 | 1 of 1 | 1 (2 s) / 0 | 0 of 4, 0.0 ms | 4 (43 %, full frame 15 %) | $0.22 |
| screen-d (75 s) | 60 s | +0.0 % / +1.3 % | 1 / 0 → 0 of 6 | 0 of 5 | 1 of 1 | 2 (6 s) / 0 | 0 of 2, 0.0 ms | 8 (49 %, full frame 19 %) | $0.30 |
<!-- /results -->

- **Length:** all 14 edits land within ±5 %, 1.2 % off on average and 3.3 % at most.
- **Cuts inside words:** none as planned and none of 168 after review; the baseline's cut at the target falls inside a word in 7 of 14 edits. In a separate check, the review passed a cut 30 ms before a word and caught one 100 ms into it.
- **Retakes:** the kept take was the right one in all 12 groups the edits used.
- **Dead air:** none left, against 50 silences of a second or more, 109 s in all, in the baseline.
- **Renders:** 0 clicks at 70 cuts, and 0.0 ms of drift.
- **Fillers:** recall is low, 14 of 91: the synthetic voice runs each filler straight into the next word, so only 2 of 69 leave the 0.13 s a cut needs. Real speech is under [Filler measurements](#filler-measurements).
- **Visuals:** 120 graphics: 50 labels, 26 lower thirds, 23 panels and 21 full-frame graphics, 43 with an icon, and 54 soft sounds; on screen for 34 to 66 % of an edit and full frame for at most 22 %. 23 more were left out: 17 by the checks (too little of their area filled, over a face, outside the safe area, restating the captions, under the captions, a word not said) and 6 for lack of room.
- **Cost:** $6.62 for all 14 edits, $0.22 to $0.59 for a 30 or 60 s edit and $0.98 and $1.19 for the 300 s ones. The graphics are $5.34 of it, planning $1.06, the cut checks $0.02 and the checks escalated to Opus $0.19.

## Callout measurements

With `--visuals minimal`. On six frames of the synthetic screen recording screen-d, `claude-haiku-5-5` boxed the named fields and button at 0.98 to 1.00 intersection over union with the generator's truth (`truth/regions.json`), answered not found for a command the terminal never shows, and boxed the timecodes of a scrolling editor, which the stillness check then rejects. Each request costs $0.0002 (about 1,600 tokens for a 1280 × 720 frame). Planned four times at 45 s and 16:9, screen-d's API key callout played on target at 0.977 IoU (`vebench edit`), across a jump cut, and at 0.974 IoU at 9:16; every edit lands within ±5 % with no cut inside a word, no dead air, 0 clicks and 0.0 ms of drift. A second plan of the same footage asks the cache rather than Claude.

## Speech the transcript missed

`place.ts` keeps cuts out of speech no word covers, and keeps clicks and shot changes out of the silence a clip opens or closes with ([What code does](README.md#planning)). On 10 CC BY clips of the [corpus](../../bench/README.md#corpus-layout), analysed with `--asr cloud`, the voice stems hold 2.8 to 193.7 s of speech no word covers, 2 to 23 % of each clip, the most in real-4, a street walk; 0 to 40 % of the gaps between words that a cut would fit in hold some of it and take no cut. The quietest 5 % of the words' frames sit 23 to 45 dB under the median level of the source's words.

Each edit below was made with `pnpm edit --asr cloud --quality best --visuals minimal`. Every edge was checked against scribe-v2's word timings on 3 s of source either side, and every edge inside a word looked at on a spectrogram. One is unclear: a real-4 clip starts 140 ms into a syllable faint under street noise, where the denoised speech is at the level of the pauses.

<!-- results:engine-unheard -->
| Footage | Asked | Made | Clicks, drift | Edges checked | Claude |
|---|---|---|---|---|---|
| real-4: street walk, Taiwanese Mandarin, 7.0 min | 60 s, 9:16 | 60.0 s (-0.0 %) | 0 of 6, 0.0 ms | 13: none inside a word; 1 unclear (above) | $0.22 |
| real-3: video call, Mandarin and English, 10.4 min | 60 s, 9:16 | 60.9 s (+1.4 %) | 0 of 6, 0.0 ms | 14: none inside a word | $0.17 |
| real-9: couch conversation, English, 16.5 min | 3 min, 16:9 | 171.3 s (-4.8 %) | 0 of 5, 0.0 ms | 12: none inside a word | $0.23 |
<!-- /results -->

## Quality measurements

The talk-a and chat-b groups of the 720p corpus (seed 0), planned, rendered and reviewed at 60 and 300 s, at 9:16 and 16:9, twice each, at both qualities: 32 edits with `--visuals minimal`, so their costs are those of edits without rich visuals.

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

- **Cost:** $0.138 an edit on average at `best` and $0.068 at `economy`, 49 % of it. At `best`, the plan is 78 % of the cost and judging doubtful checks 18 %; Sonnet judges a doubtful check for $0.005 against Opus's $0.013. The Haiku checks cost $0.001 to $0.007 an edit. No review changed an edit.
- **Quality:** every edit lands within ±5 %, with no cut inside a word, no dead air, no clicks and no drift, and each kept take is the right one, at both qualities. "Other words cut between clips" are whole short lines a 60 s edit leaves out of the story, which `vebench` counts against filler precision. How the story reads is not measured.
- **Caching:** the system prompt and packed transcripts (7,200 to 8,300 tokens) are the prefix requests repeat; another plan of the same footage within 5 minutes reads them at a twentieth of Opus's input price or a tenth of Sonnet's. Over these runs caching saved 6 % of economy's planning cost and cost best 1 % more.

## Filler measurements

Fillers cut with `--fillers natural`, the default. Each cell reads A → B: A cuts a filler only with 0.13 s of silence on each side; B, as the planner now cuts, also where the speech dips 20 dB under both words (`joinAt`). Each edit was planned, rendered and reviewed once at 16:9 with `--visuals minimal` and `--quality best`, from indexes the 0.6B speech model wrote without correction; the two real ones are cut from 3 min of their clip with `--within`.

- **Truth on real speech:** in 3 min of each of two openly licensed recordings, every filler, stutter and false start was marked against the audio and each edge set on a spectrogram: real-2 holds 21, real-9 27. `vebench edit` scores them as it scores synthetic truth.
- **What the speech model wrote:** all 21 of real-2's as words of their own; in real-9 it merged 5 into the word beside them, which no plan can cut.
- **What a cut allows:** by the aligner's timings and `joinAt`, 4 of real-2's 21 fillers and 2 of real-9's can be cut on both sides; the rest are said into the word beside them without a dip.

<!-- results:engine-fillers -->
| Footage | Target | Length | Fillers cut | Other words cut inside lines | Cuts inside words, strict / heard | Clicks, drift | Claude |
|---|---|---|---|---|---|---|---|
| real-2: talk to camera, Mandarin, 3 min of 13.8 min | 120 s | 116.6 → 120.1 s | 2 of 13 → 3 of 15 | 0 → 0 | 0 / 0 of 10 → 0 / 0 of 16 | 0 of 4 → 0 of 7, 0.0 ms | $0.11 → $0.10 |
| real-2: talk to camera, Mandarin, 3 min of 13.8 min | 150 s | 150.0 → 150.0 s | 4 of 19 → 4 of 19 | 0 → 4 | 0 / 0 of 14 → 0 / 0 of 18 | 0 of 6 → 0 of 8, 0.0 ms | $0.09 → $0.09 |
| real-9: couch conversation, English, 3 min of 16.5 min | 150 s | 155.5 → 155.0 s | 0 of 24 → 1 of 24 | 0 → 0 | 0 / 0 of 8 → 0 / 0 of 10 | 0 of 3 → 0 of 4, 0.0 ms | $0.06 → $0.07 |
| talk-a (3 clips, 7.0 min) | 60 s | 61.6 → 59.2 s | 4 of 4 → 2 of 2 | 0 → 0 | 0 / 0 of 10 → 0 / 0 of 12 | 0 of 4 → 0 of 5, 0.0 ms | $0.08 → $0.11 |
| chat-b (3 clips, 6.7 min) | 60 s | 60.6 → 60.0 s | 1 of 7 → 2 of 6 | 0 → 6 | 0 / 0 of 12 → 1 / 0 of 12 | 0 of 5 → 0 of 5, 0.0 ms | $0.09 → $0.09 |
| talk-a (3 clips, 7.0 min) | 300 s | 300.0 → 300.0 s | 0 of 18 → 6 of 20 | 0 → 0 | 0 / 0 of 24 → 0 / 0 of 32 | 0 of 11 → 0 of 15, 0.0 ms | $0.16 → $0.25 |
| chat-b (3 clips, 6.7 min) | 300 s | 300.9 → 300.0 s | 1 of 23 → 8 of 23 | 0 → 0 | 0 / 0 of 48 → 2 / 0 of 62 | 0 of 23 → 0 of 30, 0.0 ms | $0.14 → $0.25 |
<!-- /results -->

- **Cuts inside words:** "strict" counts sound edges strictly inside a truth word (`in_words`), "heard" those where the recording beside the edge on the side that plays is less than 20 dB under the quieter word (`in_words_heard`). The 3 strict ones are sound edges where two synthetic words meet, each in the dip between them.
- **Other words cut:** real-2 at 150 s leaves out the last line of a segment to fit the length, and chat-b at 60 s a line Claude did not choose; no edit cut a word inside a line that is not a filler.

## Music measurements

The two synthetic groups, each with a silent 20 s test pattern added as B-roll, planned, rendered and reviewed at 16:9 with the corpus's three synthetic tracks offered; and a two-clip talk show from the corpus (5.5 min, Mandarin, three people) with four licensed tracks. `--visuals minimal`. `vebench report` scores them from the stems the renderer writes.

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

- **Speech over music:** the voice stays at least 19.9 dB over the music while anyone talks, against the 18 dB aimed for; the quietest 5 % of 400 ms windows keep 12.6 dB or more.
- **Beats:** every B-roll end lands on a beat, and so does every start with a beat within 150 ms of its line, 18 of 24 edges in all, at most 25 ms from the true beat on the 25 fps frame grid.
- **Clicks and drift:** none at the 65 cuts, nor at the music's 15 joins; no drift.
- **Choice:** Claude put the 112 BPM track under the energetic short talks and the 96 BPM one under the conversations and the long talk. A 300 s edit plays the 71 s track's intro and main part five times, then its outro, and ends on the track's ending.

Every plan request lists the built-in library's 40 tracks, about 10,000 characters, when the user gives no music. These `pnpm edit` runs of the synthetic talk-a (seed 0), at 16:9 with `--visuals minimal` and the library offered, measure what that listing costs; `estimateCost` is fitted to them.

```bash
PEXELS_API_KEY= PIXABAY_API_KEY= node --env-file=../../.env src/edit/cli.ts ../../bench/synthetic/talk-a{1,2,3}/source.mp4 \
  --length 60s --aspect 16:9 --visuals minimal --music library -o out/edit.mp4 > progress.jsonl
```

<!-- results:engine-library -->
| Footage | Target | Made | Track Claude chose | Cuts inside words | Clicks, drift | Claude: plan (requests), cut checks |
|---|---|---|---|---|---|---|
| talk-a (3 clips, 7.0 min) | 30 s | 28.5 s (-4.9 %) | And Just Like That (upbeat) | 0 of 6 | 0 of 2, 0.0 ms | $0.104 (1), $0.012 |
| talk-a (3 clips, 7.0 min) | 60 s | 60.3 s (+0.5 %) | And Just Like That (upbeat) | 0 of 8 | 0 of 3, 0.0 ms | $0.080 (2), $0.012 |
| talk-a (3 clips, 7.0 min) | 300 s | 300.6 s (+0.2 %) | Study and Relax (calm) | 0 of 40 | 0 of 19, 0.0 ms | $0.197 (4), $0.016 |
<!-- /results -->

## Changing an edit

A 60 s 9:16 edit of the [synthetic](../../bench/README.md#synthetic-corpus) chat-b (seed 0) with music, a lower third and two keywords, `--visuals minimal`, changed by a fresh agent with only the skill from what a person would say, twice, and by hand for the other recipes. `vebench report` on every version:

| Version | Length | Cuts inside words | Clicks, drift |
|---|---|---|---|
| The planned edit | 59.57 s | 0 of 14 | 0 of 6, 0.0 ms |
| Segment cut, `--retarget` (both runs) | 55.47 s | 0 of 12 | 0 of 5, 0.0 ms; also 0 of 5 rendered without music |
| Caption fixed, then title added (both runs) | 55.47 s | 0 of 12 | 0 of 5, 0.0 ms |
| A sentence cut from inside a clip | 54.83 s | 0 of 16 | 0 of 7, 0.0 ms |
| The other recipes, two versions | 59.57 s | 0 of 14 | 0 of 6, 0.0 ms |

The planned edit rendered in 32 s. On frames from each version the captions showed the words then said, the keyword added landed on its word, and every frame after the cut matched the planned edit's frame 4.133 s later.

## Analysis measurements

Three openly licensed 1080p web recordings, each analysed cold (`vework analyze --asr cloud`) on the otherwise idle reference machine, one after another. Each step's time is from the progress lines; transcription is OpenRouter's response time.

| Source | Length | Codec, fps | Analysis | Shots | Faces | Transcription | Alignment |
|---|---|---|---|---|---|---|---|
| Recording A | 6.9 min | AV1, 60 | 309 s (0.75×) | 152 s | 46 s | 15 s | 69 s |
| Recording B | 13.9 min | H.264, 30 | 415 s (0.50×) | 135 s | 46 s | 54 s | 119 s |
| Recording C, two people talking | 20.9 min | AV1, 60 | 789 s (0.63×) | 403 s | 111 s | 31 s | 176 s |

- **Under the source's length:** every analysis took less than the source lasts. With three edits running at once, the same files took 2 to 5 times their length.
- **Shot detection** is the longest step, a third to a half of the run, and grows with the frame count: 60 fps footage takes twice as long a minute as 30 fps.

## Framing measurements

On the synthetic corpus's three conversations, framed 9:16, the face of the person talking is inside the crop 99.4 % of the time it is on screen, missing only replies too short to turn to; a centre crop holds it 80.5 % of the time. The share is the same with split screens, which show both people in 31 s of wide shots. Cut together from eight clips, the moving crops add no clicks and no drift (`vebench render`: 0 of 7 cuts, 0.0 ms).

## Caption measurements

The planner's edits of the [synthetic corpus](../../bench/README.md#synthetic-corpus) (seed 0) talk-a2, 30 s at 9:16, and chat-b, 60 s at 16:9, rendered with their captions score as they do without them in `vebench report`: 1.7 % and 2.3 % off the length, no cut inside a word, 0 clicks and 0.0 ms drift. On a 62.6 s 9:16 edit, libass draws the `bold` captions (1,260 events over 1,566 frames at 1080×1920) in about 2 ms a frame.

**Caption text.** Against the corpus's truth (`vebench transcript`), the six talk-a and chat-b clips, analysed with the local speech model and [Taiwan Traditional Chinese](../../worker/README.md#taiwan-traditional-chinese) conversion, have a mixed error rate of 6.34 % on talk-a2 and 3.27 % on talk-a1. The planner's edits of chat-b at 60 s 9:16 and talk-a at 60 s 16:9 land at 61.1 and 60.0 s, with no cut inside a word (0 of 12 and 0 of 14), 0 clicks and 0.0 ms of drift.

**Caption styles.** The same two edits rendered again in `creator`, `minimal`, `pop` and `none` with no new plan score as the `bold` render does: within 2.5 % of the length, no cut inside a word (0 of 22), 0 clicks at 9 cuts and 0.0 ms of drift. The SubRip file follows each style's captions (24 cues of chat-b in `bold`, 57 in `creator`, 18 in `minimal`, 25 in `pop`) and in `none` is `bold`'s. Over four edits one graphic was left out for lying under a style's captions.

## Render measurements

`scripts/synthetic-edit.ts` renders two edits from test patterns at 1920×1080, the first also with effect overlays across its cuts. The sources cover 24, 25, 30 and 60 fps, a variable rate, a rotated phone clip, 10-bit PQ, a file without sound and a silent track, each with its own tone.

```bash
node scripts/synthetic-edit.ts /tmp/synthetic-edit --width 1920 --height 1080
cd ../../bench && uv run vebench report /tmp/synthetic-edit
```

| `vebench report` | Cuts | Clicks | Max \|drift\| |
|---|---|---|---|
| 14 hard cuts, then dissolves, a dip, B-roll and framing | 18 | 0 | 0.0 ms |
| The same 14 cuts with five effect overlays across them | 13 | 0 | 0.0 ms |

**Fades at cuts.** The 14-clip edit at 320×180, every cut splicing two different tones, scored with `vebench render` for each fade at every cut. The renderer uses a 5 ms raised cosine, twice what it needs:

| Fade at each cut | 0 | 1 ms | 2.5 ms | 5 ms | 10 ms |
|---|---|---|---|---|---|
| Triangle | 12/13 clicks | 6 | 0 | 0 | 0 |
| Quarter sine (equal power) | 12 | 4 | 1 | 0 | 0 |
| Raised cosine | 12 | 0 | 0 | 0 | 0 |

**Memory.** Peak memory of the whole render without overlays, every FFmpeg process included, on 0.4–0.5 s clips, against one FFmpeg with an input per clip. Each overlay a piece spans adds one VP9 decoder ([its memory](../effects/README.md#rendering)).

| Source | Clips | One FFmpeg with an input per clip | Pieces |
|---|---|---|---|
| H.264 1080p30 | 10 / 50 / 150 | 1.3 / 4.6 / 11.3 GB (≈110 MB a clip) | 1.27 / 1.27 / 1.27 GB |
| HEVC 4K 10-bit PQ | 5 / 30 | ≈650 MB a clip | 1.63 / 1.68 GB |

## Effect measurements

The effects and motion graphics render with [HyperFrames](../effects/README.md#rendering) in Chrome Headless Shell (HyperFrames 0.8.164, Chrome Headless Shell 149).

**Speed.** Two full-frame checklists of 105 frames at 1080×1920 and 1920×1080, and two lower thirds of 120 frames with alpha. Each figure is seconds for both renders of a pair, with 4 workers.

| Machine | Full frame | Lower thirds |
|---|--:|--:|
| Reference machine, 8 cores | 10.8 | 10.1 |
| GitHub's Linux runner | 32–35 | 21–22 |
| GitHub's macOS runner (arm64) | 49–58 | 22–26 |
| GitHub's Windows runner | 44–46 | 31–32 |

- **Lower thirds at their own size:** a label or lower third renders only at the box it draws in: 9.5 s on Linux, 15 to 17 s on macOS and 18 s on Windows for the pair.
- **Opaque pages:** a full-frame graphic or panel renders as H.264 without alpha: 48 ms a frame for a 1080×1920 graphic on Linux, against 128 ms with alpha.
- **Same frames every time:** every file's decoded frames hashed the same over three renders on each system (`framemd5`). Frames differ between systems, each of which runs its own Chrome build.

**Graphics on real footage.** Six edits of CC BY clips of the [corpus](../../bench/README.md#corpus-layout) with `pnpm edit --asr cloud --quality best`. Claude wrote each edit's graphics in one request and fixed the ones the checks failed in one more; what still failed was left out.

| Edit | Written | Kept | With icons | Left out because | Claude: all, graphics |
|---|--:|--:|--:|---|---|
| real-2, 60 s at 9:16 | 15 | 13 | 3 | 1 too near the end, 1 too close to the one before | $0.51, $0.42 |
| real-10, 60 s at 9:16 (English) | 9 | 7 | 3 | 2 text under the captions | $0.48, $0.41 |
| real-8, 60 s at 9:16 | 11 | 9 | 3 | 1 too little of the panel filled, 1 text under the captions | $0.45, $0.35 |
| real-1, 60 s at 9:16 | 9 | 8 | 3 | 1 too close to the one before | $0.41, $0.30 |
| real-2, 3 min at 16:9 | 21 | 20 | 10 | 1 too near the end | $0.76, $0.63 |
| real-6, 3 min at 16:9 | 18 | 15 | 6 | 1 texts overlap, 1 a word not said, 1 too close to the one before | $0.93, $0.74 |

- **Cost:** a 60 s edit cost $0.41 to $0.51 in all, a 3 min one $0.76 and $0.93. The graphics are 75 to 85 % of it.
- **Hard rules:** every edit lands within ±5 % of its length (−3.2 to +4.4 %), with 0 clicks at 18 cuts and 0.0 ms of drift.
- **Icons and logos:** 28 of the 72 graphics kept mark their words with an icon. None shows a logo: no clip names a brand among the bundled logos.
- **What the checks do not see:** text already drawn into the footage. Some of real-6's lower thirds land on its own titles.

## Colour measurements

`scripts/finishing-preview.ts` draws one synthetic scene, a colour chart and six skin tones beside a face, and records it through four cameras with known differences: the reference; one warm and dark (white balance R ×1.18, B ×0.80, −0.4 stop); one cool, flat and bright (R ×0.88, B ×1.15, +0.3 stop, saturation ×0.9, contrast ×0.85); and one punchy and green (G ×1.06, saturation ×1.2, contrast ×1.12), each clipped to 8 bits as a camera records. The four are cut into one edit and graded as the planner grades it, and every patch's mean colour is compared with the reference camera's by CIEDE2000.

```bash
node scripts/finishing-preview.ts out/finishing --scene <clip folder>@<seconds> --edit <run folder>
```

ΔE00 of each camera's 30 patches from the reference camera's: mean / largest / mean of the 8 skin tones.

| Camera | Before matching (auto grade only) | Matched | Matched, with the `clean` look on both |
|---|---|---|---|
| Warm and dark | 6.38 / 11.74 / 4.54 | 1.01 / 2.83 / 0.96 | 0.92 / 2.88 / 0.76 |
| Cool, flat and bright | 5.48 / 7.03 / 6.29 | 1.11 / 3.61 / 1.00 | 1.28 / 3.20 / 1.64 |
| Punchy and green | 4.63 / 6.38 / 4.79 | 0.95 / 5.52 / 0.97 | 0.97 / 5.49 / 1.03 |

**The bar: a mean ΔE00 of 2 or less for each camera**, which reads as the same camera when shots are seen one after another. Every matched camera meets it, and so do its skin tones. The largest differences left are on the white patch, which the cool and punchy cameras recorded past 255.

**Real footage.** A corpus interview cut from three cameras, a wide two-shot and a close-up of each person: the wide shot leaves a residual of 0.056 against the close-up used most and the other close-up 0.033, so neither is matched ([matching](README.md#matching)). One person's cheek differs between the wide shot and the close-up by ΔE00 17.4, mostly in chroma; the other person's by 10.2. The angle of the light on a face changes with the camera, so not all of these differences are the cameras'.

## Voice measurements

**Synthetic.** Two [synthetic-corpus](../../bench/README.md#synthetic-corpus) clips degraded on purpose: `phone-c` (voice B, 77 s, rendered 9:16 to -14 LUFS) and `screen-d` (voice A, 75 s, 16:9 to -16 LUFS). Each was given pink noise at 20 and 10 dB SNR, a synthetic room of RT60 0.6 s, a 0.5 s room with noise at 15 dB, or its level stepped down by 12 dB and up to -5 dB, as a speaker turning away does. `vework analyze` measured each, `planVoice` chose its chain, and it was rendered whole and cut at its pauses, without a voice chain ("plain") and with one. "Room under the speech" is speech loudness minus the noise floor; a word's drop is its level against the clip as generated, less the median of all words' change.

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

- **Noise:** the room ends 12 to 25 dB further under the speech than in the plain render, at the same loudness. The 0.6 s rooms read about 0.35 s after the chain.
- **Levels:** every voice render reads its speech at -13.5 to -13.6 LUFS (9:16) or -15.6 (16:9); the plain renders spread over 1.4 LU. The leveller turns the stepped clips' 12 dB between their thirds into 0.3 and 0.8 dB.
- **Words:** no word is gated. Most drops in the table are the EQ's low-mid cut on hummed words such as "um"; in noise at 15 dB or less the denoiser also lowers a few of voice B's soft syllables, by up to 15 dB.
- **Peaks:** with the limiter, loudness normalisation reaches its target with one linear gain on every voice render (true peak -3.1 to -7.2 dBTP). No render has a sample within 0.1 dB of full scale.

**Real recordings.** Three openly licensed [corpus](../../bench/README.md#corpus-layout) clips with audible rooms, measured the same way against their own recording and the words `vework` transcribed from it: `wikilive-d1` and `wikilive-d2`, a webcam livestream talk show of one host and two guests (172 s and 159 s), and `wikidata-openrefine`, a meetup filmed across the room (176 s, about 60 % speech), all 16:9 at -16 LUFS. "Room under the speech" and the loudness range are given for the recording, the plain render and the voice render.

| Clip | Chain chosen | Room under the speech | Loudness range | Spread of the thirds | True peak, plain → voice |
|---|---|---|---|---|---|
| `wikilive-d1` | denoise 30 dB, leveller, 2:1 | 9 / 6 → 22 dB | 13.2 / 11.3 → 3.6 LU | 1.3 / 2.7 → 0.4 dB | -3.8 → -5.8 dBTP |
| `wikilive-d2` | denoise 30 dB, leveller, 2:1 | 8 / 7 → 21 dB | 15.9 / 11.1 → 3.7 LU | 2.1 / 1.5 → 1.0 dB | -1.2 → -5.7 dBTP |
| `wikidata-openrefine` | denoise 30 dB, leveller, EQ +1.7, 2:1 | 21 / 17 → 32 dB | 16.9 / 13.5 → 10.5 LU | 8.5 / 5.3 → 2.1 dB | -1.0 → -5.4 dBTP |

- **Noise:** the room ends 14 to 16 dB further under the speech than in the plain render.
- **Levels:** the host and guests come out at one level: 3.6 and 3.7 LU on the talk show, the thirds of the speech within 1 dB. The meetup's range, over a track about 40 % without speech, stays at 10.5 LU, its speech's thirds within 2.1 dB.
- **Words:** of the words 12 dB or more above the room, the denoiser lowers 4 of 67, 7 of 63 and 11 of 290 by more than 6 dB against the rest. No sample comes within 0.1 dB of full scale.

**Cuts:** `vebench report` on the renders cut at every pause, synthetic (124 cuts each way) and real (57 cuts each way): 0 clicks and 0.0 ms of drift, plain and voice alike.

**Word timings** stay put. `phone-c` with 10 dB of noise, transcribed by `vework analyze` and scored by `vebench report` against the clip's truth:

| `phone-c`, pink noise at 10 dB SNR, transcribed from | MER | Start error p50 / p95 | End error p50 / p95 | Within 50 / 100 ms |
|---|---|---|---|---|
| The degraded audio | 7.1 % | 27 / 85 ms | 69 / 167 ms | 23 / 70 % |
| The processed render | 4.9 % | 22 / 76 ms | 30 / 133 ms | 61 / 88 % |
| For reference, the clip as generated | 5.2 % | 27 / 75 ms | 27 / 75 ms | 65 / 93 % |

On the real clips, the render's transcript and the recording's agree on word timings (starts 15 to 23 ms apart at the median).
