# Engine measurements

How the engine's behaviour, described in the [README](README.md), measures on the [synthetic corpus](../../bench/README.md#synthetic-corpus) and on openly licensed footage. Times are on the [reference machine](../../bench/README.md#reference-machine). The edit table's synthetic rows and the planner table are measured with rich visuals, the default, without stock footage; every other measurement here was made before rich visuals and holds for `--visuals minimal`.

## Edit measurements

Each row is one `pnpm edit` run with the real API on the reference machine. Every file was analysed with the 0.6B speech model and no transcript correction. The table mixes two kinds of row, as its Visuals column says:

- **The two synthetic rows** come from the [synthetic corpus](../../bench/README.md#synthetic-corpus) (seed 0), edited with rich visuals, without stock footage (no Pexels or Pixabay key), and `--quality best`, one edit at a time. The first was edited with the motion graphics Claude writes for each edit, the second at 5dc8da9 with the motion-graphics cards they replaced. Claude asked for no web capture in either. The first edit found the clips analysed; the second analysed them again, since a names file changes the analysis.
- **The two real rows** are openly licensed web recordings whose transcripts nobody has corrected yet, so their cuts are checked against the words as the analysis timed them. They were measured before rich visuals, with what is now `--visuals minimal`, on the machine shared with other jobs (load average 8 to 10); their analysis time is from the first edit of that footage, the rest from a later one that found the indexes cached.

`vebench edit` scores each project and `vebench render` each video.

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

- **Music and effects:** in the second chat-b edit Claude chose the 96 BPM track, which plays from 1.9 s to the end with the voice 21.0 dB over it while anyone talks (15.0 dB in the quietest 5 %, `vebench mix` on the stems of the same project rendered again), and its one join does not click; it showed the guest's name and role in a lower third, popped two keywords and pushed in on 3 of the 6 clips, at most 1.19 times; the sound measures -13.9 LUFS at -3.1 dBTP.
- **Visuals:** the first edit shows 8 of the 10 graphics Claude wrote: 2 labels and 1 lower third over the speaker, 3 panels over the speaker and 2 full-frame graphics, on screen for 61 % of the edit and full frame for 22 %, 8 icons among them, with a soft sound on 4. The placer left out a lower third too close to the graphic before, and the checks a panel that filled too little of its area. The second, measured with cards, cuts to 5 full-frame cards, 3.0 to 3.5 s each and 29 % of the edit.
- **Cost:** $0.57 with motion graphics, $0.47 of it for the graphics (writing them, $0.29, and one request to fix the ones the checks failed), against $0.19 and $0.20 with cards and $0.10 before rich visuals ([effects](#effect-measurements)).
- **Time:** the second chat-b edit analysed its 6.7 min of footage and 3.7 min of music in 9.9 min; on its own, without the names, the footage took 3.2 min, all three clips at once. Shot detection takes about a fifth of an analysis, faces an eighth, transcribing and aligning the rest. Another edit of the same footage starts at the plan and took 4.5 min with motion graphics, 3.2 min of it planning, writing and checking the graphics; 1.8 min with cards, and 41 s to 2.3 min without rich visuals.
- **Pictures:** in the 9:16 edits the crop follows whoever is on screen, and cuts to the listener's shot with the source. The interview's cuts join two answers inside one camera's shot, so they show as jump cuts; the talks cut between the host and the speaker at a pause.
- **Captions:** on the synthetic edit measured before rich visuals, each caption appears within 23 ms of its first word's true start at the median and 118 ms at the 95th percentile, and stays up about 0.4 s past its last word. This was not measured again.

## Shorts measurements

Each row is one `pnpm edit --shorts` run with the real API, with rich visuals without stock footage and `--quality best`, from cached indexes: real-2 with `--asr cloud` on the command line, talk-a from the [synthetic corpus](../../bench/README.md#synthetic-corpus) (seed 0) through the web page. `vebench render` scores each short's video and `vebench edit` its length; no hand-checked transcript exists for these clips, so every main-track clip's edges are checked against the words as the analysis timed them. Times are not given: other jobs ran on the machine.

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

- **Moments:** Claude found 6 moments in real-2 and 3 in talk-a, at most one per 2 minutes of footage; the best five and all three were made. Each short plays only its stretch: 66 to 95 s of the source for real-2's shorts of 45 to 51 s. One talk-a short opens on a line from later in its stretch, then plays from its start: the hook first.
- **Fitting:** in an earlier real-2 run, the code before a short's plan was fitted to the length it reaches, 3 of 6 moments planned 1 to 3 s short of the length Claude picked after both requests and were left out, so 3 shorts were made. With the fit, and with Claude asked for a stretch of about 1.5 times the short's length rather than 1.25, none fell short here.
- **Cost:** finding the moments reads every transcript once: $0.05 for 7 minutes and $0.07 for 14, at most about $0.30 an hour. Each short costs about what an edit of its length does ([edit measurements](#edit-measurements)), most of it the motion graphics. `estimateShortsCost` is fitted to these runs.

## Planner measurements

These runs use the [synthetic corpus](../../bench/README.md#synthetic-corpus) (seed 0), each clip analysed at 5dc8da9 with the 0.6B speech model and no transcript correction. Each footage was planned, rendered and reviewed at each length its speech allows, with rich visuals and their motion graphics, without stock footage (no Pexels or Pixabay key), and `--quality best`, one edit at a time: the two groups at 16:9, the single clips at 9:16 except the screen recording. The baseline keeps every clip whole, in file order, cut off at the target. `vebench edit` scores both, and `vebench render` the planner's renders.

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

- **Before and after:** the same 14 edits were also planned, rendered and reviewed on the code before motion graphics (9dcdb83, with cards), on the same indexes. Every bullet gives both, before first. The after edits were made again on the final code, replaying the plans and the graphics Claude had written from its recorded replies; the costs are those of the replies when first asked.
- **Length:** all 14 edits land within ±5 % both times, 0.9 % and 1.2 % off on average, 3.1 % and 3.3 % at most.
- **Cuts inside words:** none as planned and none of 174 and 168 after review; the baseline's cut at the target falls inside a word in 7 of 14 edits. When these 14 edits were measured before rich visuals and before the analysis shrank each gap between two words to the silence in it (*Word gaps* below), one of 170 planned cuts was inside a word: the index put 0.18 s of silence between 呃 and 講 where the speaker left none, so the cut after the removed filler clipped 講 by 115 ms, and the review put the filler back. In a separate check, the review passed a cut 30 ms before a word and caught one 100 ms into it.
- **Retakes:** the kept take was the right one in all 13 and all 12 groups the edits used.
- **Dead air:** none left, against 50 silences of a second or more, 109 s in all, in the baseline.
- **Renders:** 0 clicks at 73 and 70 cuts, and 0.0 ms of drift.
- **Fillers:** recall is low, 11 of 86 and 14 of 91; no other word was cut between clips. The synthetic voice runs each filler straight into the next word: the median gap after one is 0 s, and only 2 of 69 leave the 0.13 s a cut needs. Real speech is measured under [Filler measurements](#filler-measurements).
- **Visuals:** before, the 14 edits cut to 87 full-frame cards, 16 to 47 % of an edit. After, they show 120 graphics Claude wrote: 50 labels and 26 lower thirds over the speaker, 23 panels over the speaker at 9:16 and 21 full-frame graphics, 43 of them with an icon and none with a logo, and 54 soft sounds. Graphics are on screen for 34 to 66 % of an edit and full frame for at most 22 %. 23 more were left out: 7 that filled too little of their area (2 of them with overlapping text), 4 over a face, 2 outside the safe area, 2 that showed the sentence the captions show, 1 under the captions and 1 with a word the speaker does not say; the other 6 had no room, too close to the graphic before, giving way to a panel or full-frame graphic, or too near the end. Claude asked for no web capture before, and for two after: talk-a at 300 s shows 3.5 s of the Claude product page as the speaker says Claude decides the cut, and the other page did not load in time and was left out.
- **Cost:** $2.46 for all 14 edits before, $0.10 to $0.44 each, and $6.62 after, $0.22 to $0.59 for a 30 or 60 s edit and $0.98 and $1.19 for the 300 s ones. The graphics are $5.34 of it: one request per 3 min of the edit to write them, and one to fix the ones the checks failed. Planning fell from $2.28 to $1.06, as the plan no longer writes cards or keyword pops. The cut checks cost $0.02 both times, and those escalated to Opus $0.16 and $0.19. One review changed an edit after.
- **Earlier comparisons:** every bullet below was measured before rich visuals, with what is now `--visuals minimal`.
- **With effects:** the talk-a and chat-b edits were planned, rendered and reviewed again at 30, 60 and 300 s, with the code before the planner placed effects and after it, on the same indexes. Lengths stay within ±5 % (0.5 to 3.6 % off before, 0.5 to 4.1 % after), retakes stay right (8 of 8 both times) and no dead air is left; renders have 0 clicks and 0.0 ms of drift. Each edit now carries one to three keyword pops a minute, and the two 300 s edits open on a title. Cuts inside words, after review: 1 of 110 before and 2 of 114 after. Both are the index's timing, as above: a gap it heard between two words the speaker joined. One is the 115 ms cut into 講 in both runs. The other is new: a cut the review moved, 28 ms into 個. The analysis now closes that gap (*Word gaps* below).
- **With callouts:** on six frames of the synthetic screen recording screen-d, each where a thing on screen is named, `claude-haiku-5-5` boxed the API key, model and output folder fields and the Save button at 0.98 to 1.00 intersection over union with the generator's truth (`truth/regions.json`), answered not found for an `edit` command the terminal never shows, and boxed the timecodes of a scrolling editor, which the stillness check then rejects. Each request costs $0.0002: about 1,600 tokens in, for a 1280 × 720 frame. screen-d was planned four times at 45 s and 16:9 on the same index. Each time, Claude asked for the same three callouts: the API key field, the length in the terminal command and the subtitle file's timecodes. The length was never found and the timecodes were left out as moving. The API key callout, on target at 0.977 IoU (`vebench edit`), played in both edits planned with callouts running on across a jump cut. Finding the things cost $0.0008 in three requests the first time, then $0.0002, $0.0003 and nothing, as the cache answered, on top of plans of $0.036 to $0.062. Every edit lands within ±5 % (at most 0.07 % off), with no cut inside a word, the retake chosen right and no dead air, and the render with its callout has 0 clicks and 0.0 ms of drift. At 9:16 the same field was found but left out while a 16:9 screen was cropped to its middle third; now that a screen shows whole at 9:16 (*Framing* below), it plays there too, on target at 0.974 IoU.
- **Nearest length:** the talk-a and chat-b edits were planned, rendered and reviewed again at 15, 30, 60 and 300 s, with the fit that took the first length within ±5 % and with the one that aims for the target, replaying the same plans from Claude. Length off, on average and at most: 2.6 and 2.7 % → 1.6 and 1.6 % at 15 s, 2.7 and 3.5 % → 1.8 and 2.8 % at 30 s, 1.4 and 2.1 % → 0.4 and 0.8 % at 60 s, 1.7 and 2.3 % → 0.0 % at 300 s. A short edit stays a little off where its lines, 2 to 4 s each, allow nothing nearer, and the breath moves a 30 s edit by only about 0.3 s. Both fits leave the same cut inside a word, 1 of 120 (the 115 ms into 講), and have 0 clicks at 52 cuts and 0.0 ms of drift. talk-a3 alone is still too short for 15 s after two requests, and the planner now says to add footage.
- **With chapters:** the talk-a and chat-b edits were planned, rendered and reviewed again at 300 s, with the code before chapters were planned and after, on the same indexes. They now carry 4 and 5 chapters, each marked as it starts, and 2 and 4 wipes; one chapter of talk-a starts inside a clip, where there is no cut to hide, so it has none. Lengths stay within ±5 % (2.5 % off on average after, 4.1 % before), retakes stay right (6 of 6), no dead air is left, and renders have 0 clicks and 0.0 ms of drift. The one cut inside a word in each run is the 115 ms cut into 講, as above. An edit under two minutes is planned from the same instructions, request and schema as before, byte for byte.
- **Several segments at once:** when no choice the fit made one segment at a time landed within ±5 %, it now changes several segments together and keeps the choice that loses the fewest important lines (#84). talk-a1 at 30 s used to fail: its lines last 3.4 to 5.2 s against a 3 s window, so dropping by priority went from 32.7 s straight to 27.4 s, a second request did no better, and the planner said to ask for at most 29 s. Replaying the same first plan, the fit now lands at 31.4 s without a second request. On the code after the change, five edits at 9:16 with `--visuals minimal` were planned, rendered and reviewed: talk-a1 at 15, 30 and 60 s, talk-a3 and chat-b1 at 30 s. All land within ±5 % (talk-a1 +2.4, +2.5 and −0.1 %, talk-a3 −2.9 %, chat-b1 0.0 %), retakes stay right (4 of 4), no dead air is left, and renders have 0 clicks at 12 cuts and 0.0 ms of drift. Two of 34 cuts land inside a word, both where the index heard a gap the speaker never left (#87): a review moved one 28 ms into 個 in talk-a1, the same cut as above, and chat-b1 ends a line 41 ms before the end of 誰, which the index times 0.5 s late. Claude cost $0.03 to $0.09 an edit.
- **Word gaps:** the analysis now shrinks each gap the aligner leaves between two words to the silence in it, where before a gap with sound in it stayed and a cut could land there ([word timings](../../worker/README.md#word-timings), #87). In the new indexes 這 and 個 in talk-a1 share a boundary at 97.28 s, and 切 in chat-b1 runs to 76.344 s over the 誰 the aligner timed late, so neither cut above has a gap to land in. Over the whole corpus, gaps a cut fits in that overlap a true word fell from 31 of 405 to 2 of 379, both in silence the truth counts as part of a word. Four edits at 9:16 with `--visuals minimal` were planned, rendered and reviewed on the new indexes: talk-a1 and chat-b1 at 30 s, talk-a3 and chat-b2 at 60 s. None of their 36 cuts lands inside a word; all land within ±5 % (−2.0, +0.1, +0.7 and −1.1 %), retakes stay right (3 of 3), no dead air is left, and renders have 0 clicks at 14 cuts and 0.0 ms of drift. Claude cost $0.07 to $0.11 an edit, $0.38 in all.
- **Punch-ins:** on the [synthetic corpus](../../bench/README.md#synthetic-corpus) (720p, seed 0), six edits re-rendered from the same plans (talk-a and chat-b at 60 s, 9:16 and 16:9; phone-c at 30 and 60 s, 9:16) gained 3 punch-ins and 18 push-ins, at most 1.19 times; their lengths, cuts, clicks (0) and drift (0.0 ms) did not change.
- **Framing:** eight edits of the [synthetic corpus](../../bench/README.md#synthetic-corpus) (720p, seed 0), talk-a and chat-b at 60 s at 9:16 and 16:9, and phone-c and screen-d at 30 and 60 s at 9:16, were planned and rendered without review with the code before the change, then rendered again from the same plans with the code after it. Lengths (0.9 % off on average, 1.8 % at most), cuts (none of 84 inside a word), clicks (0 of 34 cuts) and drift (0.0 ms) did not change. At 9:16 the landscape footage, already enlarged to fill the frame, no longer zooms: talk-a and chat-b each lose their 4 push-ins. phone-c, portrait footage at its own size, keeps its 3 and 2 punch-ins, now at 1.12 times rather than up to 1.19. screen-d shows its whole screen over a blurred copy in all 7 clips, and talk-a in the 1 clip that shows its slides, and each edit's callout on the API key field, left out before, now plays, on target at 0.974 IoU. In 3 of chat-b's 6 clips the drawn head touches the picture's top, so the picture moves down 10 to 11 % of the frame under a blurred band, eyes a third of the way down. At 16:9, the framing changes within shots 7 times in talk-a and 3 times in chat-b, between wide and 1.25 times or back to wide where a screen starts; talk-a keeps 3 of its 4 push-ins and chat-b 2 of its 4.
- **Speech the transcript missed, and clicks in the source:** `place.ts` now keeps cuts out of speech no word covers, and keeps clicks in a source's sound and its shot changes out of the silence a clip opens or closes with ([What code does](README.md#planning), #104, #105). The real-4 and real-9 edits were measured before shot changes and clicks anywhere in that silence were checked, on code otherwise the same; everything else with all of it.
  - **Synthetic corpus:** the 14 edits of the planner table were planned again on the code before the change ($2.54), then replayed from the same plans on the code after it. 11 of the 14 main tracks come out identical, clip for clip, as the synthetic voice leaves no speech outside its words; in each of the other 3, one clip moves by one to three frames: talk-a2 at 30 s now starts on its shot change at 81.96 s rather than 0.12 s before it. Both runs land within ±5 % (1.2 and 1.3 % off on average at 30 s, 1.1 % at 60 s, 0.0 % at 300 s), with 0 of 170 cuts inside words, 0 clicks at 71 cuts, 0.0 ms of drift, no dead air and the retakes right (12 of 12).
  - **Real footage:** on the 10 CC BY clips of the step 3 check (#103), analysed with `--asr cloud`, the voice stems hold 2.8 to 193.7 s of speech no word covers, 2 to 23 % of each clip, the most in real-4, a street walk. 0 to 40 % of the gaps between words that a cut used to fit in now hold some of it and take no cut (real-6, two people talking over each other, loses the most: 590 to 354).
  - **The same plans, placed again:** placing the words of the three step 3 edits that broke the hard rules again, with this code, moves every edge that fell inside a word by scribe-v2's timings: the five in real-4, each one syllable, now sit in silence, and real-9's pause around a false start is no longer cut, as speech fills it.
  - **The same footage, edited again:** each edit was made again with `pnpm edit --asr cloud --quality best`, a new plan from Claude. Every edge was checked against scribe-v2's own word timings on 3 s of source either side, and every edge inside a word was looked at on a spectrogram. One remains unclear: a real-4 clip starts 140 ms into a syllable that scribe-v2 hears and the recording shows faintly under street noise, while the denoised speech is at the level of the pauses there.

<!-- results:engine-unheard -->
| Footage | Asked | Made | Clicks, drift | Edges checked | Claude |
|---|---|---|---|---|---|
| real-4: street walk, Taiwanese Mandarin, 7.0 min | 60 s, 9:16 | 60.0 s (-0.0 %) | 0 of 6, 0.0 ms | 13: none inside a word; 1 unclear (above) | $0.22 |
| real-3: video call, Mandarin and English, 10.4 min | 60 s, 9:16 | 60.9 s (+1.4 %) | 0 of 6, 0.0 ms | 14: none inside a word | $0.17 |
| real-9: couch conversation, English, 16.5 min | 3 min, 16:9 | 171.3 s (-4.8 %) | 0 of 5, 0.0 ms | 12: none inside a word | $0.23 |
<!-- /results -->

  - **real-3's own splice:** the creator cut their call at about 472.3 s: the picture changes take at 472.305 s and the sound jumps at 472.443 s, where the next sound starts. TransNetV2 finds no shot change there (frame-to-frame change 4.2 at most, as in ordinary motion, against 25.7 at the shot change it finds at 473.106 s), and the jump sits at the start of that sound rather than in the silence before it, so neither rule moves the cut: the first frame after the jump, 472.473 s, is 30 ms into the sound. The re-edit starts that clip at 472.339 s, on the new take's picture, 0.1 s before the jump, which plays inside the clip as it does in the source; `vebench render` counts no click at the cut.

## Quality measurements

The talk-a and chat-b groups were planned, rendered and reviewed at 60 and 300 s, at 9:16 and 16:9, twice each, at both qualities: 32 edits, from indexes of the 720p corpus (seed 0) that `vework analyze` wrote at 277effa. `best` here is the code before `--quality` existed, which sends the same requests. They were measured before rich visuals, with what is now `--visuals minimal`, so their costs are those of edits without them.

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

## Filler measurements

How many fillers an edit cuts with `--fillers natural`, the default, before filler modes (ea6906f: hesitations, 那個 and 就是 marked, and a filler cut only with 0.13 s of silence on each side) and after them (4d65c73). Each edit was planned, rendered and reviewed once at 16:9 with `--visuals minimal` and `--quality best`, from indexes the 0.6B speech model wrote without correction; the two real ones are cut from 3 min of their clip with `--within`. `--fillers aggressive` and `off` were not measured.

- **Truth on real speech:** in 3 min of each of two openly licensed recordings, every filler, stutter and false start was marked against the audio. Each was found from the aligner's timings and a second transcript by ElevenLabs scribe-v2 (on OpenRouter), and each edge was set on a spectrogram crop; where a filler runs straight into the next word, scribe-v2 also heard the two sides cut apart. real-2 holds 21 (11 verbal tics, 5 hesitations, 3 false starts, 2 stutters), real-9 27 (16 verbal tics, 6 stutters, 4 false starts, 1 hesitation). The truth words beside each filler end where it starts; the others keep the aligner's timings. `vebench edit` scores them as it scores synthetic truth.
- **What the speech model wrote:** all 21 of real-2's as words of their own. In real-9 it left out 5, each merged into the word beside it (3 false starts, a hesitation and a verbal tic), which no plan can cut.
- **What a cut needs:** a filler is cut where each side holds a pause of 80 ms or more, so no cut falls inside a word. By the aligner's timings, 3 of real-2's 21 fillers and none of real-9's have one on both sides; the rest are said straight into the word beside them, as the synthetic voice says them. No edit here has a pause under 0.13 s beside a filler it cut, so none has a sound edge (`soundIn`, `soundOut`), and `vebench edit` gives the same counts at the sound edges and at the picture edges (`--edges picture`).

<!-- results:engine-fillers -->
| Footage | Target | Length | Fillers cut | Other words cut inside lines | Cuts inside words | Clicks, drift | Claude |
|---|---|---|---|---|---|---|---|
| real-2: talk to camera, Mandarin, 3 min of 13.8 min | 120 s | 116.6 → 121.7 s | 2 of 13 → 2 of 13 | 0 → 0 | 0 of 10 → 0 of 10 | 0 of 4 → 0 of 4, 0.0 ms | $0.11 → $0.06 |
| real-2: talk to camera, Mandarin, 3 min of 13.8 min | 150 s | 150.0 → 150.8 s | 4 of 19 → 2 of 18 | 0 → 0 | 0 of 14 → 0 of 12 | 0 of 6 → 0 of 5, 0.0 ms | $0.09 → $0.09 |
| real-9: couch conversation, English, 3 min of 16.5 min | 150 s | 155.5 → 150.0 s | 0 of 24 → 1 of 24 | 0 → 0 | 0 of 8 → 0 of 10 | 0 of 3 → 0 of 4, 0.0 ms | $0.06 → $0.07 |
| talk-a (3 clips, 7.0 min) | 60 s | 61.6 → 61.5 s | 4 of 4 → 2 of 3 | 0 → 0 | 0 of 10 → 0 of 10 | 0 of 4 → 0 of 4, 0.0 ms | $0.08 → $0.10 |
| chat-b (3 clips, 6.7 min) | 60 s | 60.6 → 60.5 s | 1 of 7 → 1 of 7 | 0 → 0 | 0 of 12 → 0 of 10 | 0 of 5 → 0 of 4, 0.0 ms | $0.09 → $0.09 |
| talk-a (3 clips, 7.0 min) | 300 s | 300.0 → 300.0 s | 0 of 18 → 1 of 19 | 0 → 0 | 0 of 24 → 1 of 24 (141 ms) | 0 of 11 → 0 of 11, 0.0 ms | $0.16 → $0.28 |
| chat-b (3 clips, 6.7 min) | 300 s | 300.9 → 300.2 s | 1 of 23 → 2 of 23 | 0 → 0 | 0 of 48 → 0 of 48 | 0 of 23 → 0 of 23, 0.0 ms | $0.14 → $0.24 |
<!-- /results -->

- **Mistakes:** no edit cut a word inside a line that is not a filler.
- **The one cut inside a word:** talk-a at 300 s starts a clip 141 ms into a word whose sound the synthetic voice stretches over a silence the index hears after it. The code before filler modes places that clip start at the same time.
- **Cost:** a 1-minute edit of real-2's 3 min with the defaults, rich visuals included, cost $0.32 before and $0.35 after, its plan $0.076 and $0.081. The after edits at 300 s were each reviewed twice, as a review moved a cut away from a wipe, so their checks cost $0.15 and $0.11 against $0.02 and $0.03; their plans cost $0.13 and $0.14 against $0.14 and $0.11.

## Music measurements

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

- **Speech over music:** the voice, through each source's [voice chain](README.md#voice), stays at least 19.9 dB over the music while anyone talks, against the 18 dB aimed for. The quietest 5 % of 400 ms windows, the ends of phrases, keep 12.6 dB or more. Under the talk show's quieter guests the render rides the music further down.
- **Beats:** every B-roll end lands on a beat, and so does every start with a beat within 150 ms of its line, 18 of 24 edges in all, at most 25 ms from the true beat on the 25 fps frame grid. The other 6 starts had no beat that near.
- **Clicks and drift:** none at the 65 cuts, measured in the sound without the music, nor at the music's 15 joins; no drift. Planned without music, the same footage and lengths had no clicks at 66 cuts either, and lengths within ±4.2 % (±3.7 % with music).
- **Choice:** Claude put the 112 BPM track under the energetic short talks and the 96 BPM one, from its quiet intro, under the conversations and the long talk; under the talk show it chose the chill groove. A 300 s edit plays the 71 s track's intro and main part five times, then its outro, and ends on the track's ending.
- **Not measured yet:** how people rate the result.

## Changing an edit

Measured before rich visuals, with what is now `--visuals minimal`, on a 60 s 9:16 edit of the [synthetic](../../bench/README.md#synthetic-corpus) conversation chat-b (seed 0) with music, a lower third and two keywords: a fresh agent with only the skill made three versions from what a person would say, twice. It cut the 4.1 s segment about clicks at the joins with `--cut 29.14-32.72` and `--retarget`, fixed a misheard caption (能比如說 to 嗯　比如說) and added a title, shortened to end where the first keyword starts. The planned edit rendered in 32 s on the reference machine; the agents' renders took 39 s to 2.8 min, with other renders running beside them. By hand, one more cut took a sentence out of the middle of a clip (`--cut 43.56-47.56 --retarget`), which split it in the pauses on either side, and two more versions covered the other recipes: a lower third's role, a keyword removed and one added, a chapter, the music 3 dB down, then no music, the `warm` look and the `sweep` captions (a preset since removed). `vebench report` on all of them:

| Version | Length | Cuts inside words | Clicks, drift |
|---|---|---|---|
| The planned edit | 59.57 s | 0 of 14 | 0 of 6, 0.0 ms |
| Segment cut, `--retarget` (both runs) | 55.47 s | 0 of 12 | 0 of 5, 0.0 ms; also 0 of 5 rendered without music |
| Caption fixed, then title added (both runs) | 55.47 s | 0 of 12 | 0 of 5, 0.0 ms |
| A sentence cut from inside a clip | 54.83 s | 0 of 16 | 0 of 7, 0.0 ms |
| The other recipes, two versions | 59.57 s | 0 of 14 | 0 of 6, 0.0 ms |

On frames from each version the captions showed the words then said and lit the word being said, the keyword added landed on its word, and every frame after the cut matched the planned edit's frame 4.133 s later, captions included.

## Analysis measurements

Three openly licensed 1080p web recordings, each analysed cold (`vework analyze --asr cloud`, no index cached) on the reference machine with nothing else running (1-minute load average under 0.4 at the start), one after another. Each step's time is from the progress lines. Transcription is OpenRouter's response time.

| Source | Length | Codec, fps | Analysis | Shots | Faces | Transcription | Alignment |
|---|---|---|---|---|---|---|---|
| Recording A | 6.9 min | AV1, 60 | 309 s (0.75×) | 152 s | 46 s | 15 s | 69 s |
| Recording B | 13.9 min | H.264, 30 | 415 s (0.50×) | 135 s | 46 s | 54 s | 119 s |
| Recording C, two people talking | 20.9 min | AV1, 60 | 789 s (0.63×) | 403 s | 111 s | 31 s | 176 s |

- **Under the source's length:** every analysis took less than the source lasts. The same files took 2 to 5 times their length in the step 3 checks (#113), with three edits running at once (load average about 24): 5 to 8 times as long as here.
- **Shot detection** is the longest step, a third to a half of the run, and grows with the frame count: 60 fps footage takes twice as long a minute as 30 fps. It now says how far it is every 5 % of the frames. Decoding the frames in a thread of their own while TransNetV2 scores them, and flushing subnormal floats to zero, left it as fast as before (150 vs 152 s, 138 vs 135 s and 424 vs 403 s), so neither was kept. Scoring fewer frames of 60 fps footage would halve it but changes what TransNetV2 sees; it was not tried.

## Framing measurements

On the synthetic corpus's three conversations, framed 9:16, the face of the person talking is inside the crop 99.4 % of the time it is on screen, missing only replies too short to turn to; a centre crop holds it 80.5 % of the time, and in the wide shots shows the empty space between the two people. Each talker is taken as the face the analysis names most while the corpus's truth has them talking in a shot. With split screens, 31 s of the three clips' wide shots, where both people take turns, show both at once, one above the other, and the share is the same 99.4 % of 3,131 samples; in 106 s of close shots, where a drawn head touches the picture's top, the crop reaches past the picture under a blurred band. Cut together from eight clips, the moving crops add no clicks and no drift (`vebench render`: 0 of 7 cuts, 0.0 ms).

## Caption measurements

The planner's edits of the [synthetic corpus](../../bench/README.md#synthetic-corpus) (seed 0) talk-a2, 30 s at 9:16, and chat-b, 60 s at 16:9, rendered with their captions score as they do without them in `vebench report`: 1.7 % and 2.3 % off the length, no cut inside a word, 0 clicks and 0.0 ms drift. On a 62.6 s 9:16 edit of a corpus interview, libass draws the `bold` captions (1,260 events over 1,566 frames at 1080×1920) in 3.2 s more than decoding the frames alone takes, about 2 ms a frame. Captions are drawn by libass rather than as web pages: an effect page takes 48 to 128 ms a frame at 1080×1920 ([effects](#effect-measurements)), about 25 to 60 times as long. The two have not been compared by look.

**Caption text.** The six talk-a and chat-b clips of the [synthetic corpus](../../bench/README.md#synthetic-corpus) (seed 0) were analysed again with the everyday dictionaries, the Latin words split from full-width marks and Chinese numerals by Latin words in digits ([Taiwan Traditional Chinese](../../worker/README.md#taiwan-traditional-chinese)), with the local speech model. Against the corpus's truth (`vebench transcript`), the mixed error rate moves only where the conversion changed a word: talk-a2 from 7.02 % to 6.34 %, as 打開 stays where `s2twp` wrote 開啟, twice, though 文件 now stays where the script says 檔案; talk-a1 from 3.10 % to 3.27 %, as the speech model's 支持 stays where the script says 不支援; the other four clips do not change. A mark the transcript put in front of an English word (了 。OK, 對 ，um) now stays with the word before it. The planner's edits of chat-b at 60 s 9:16 and talk-a at 60 s 16:9, on the code before and after the change, land at 60.0 and 61.1 s and at 57.9 and 60.0 s, with no cut inside a word (0 of 12 and 12; 0 of 10 and 14), 0 clicks and 0.0 ms of drift. On a 60 s 9:16 edit of a CC BY product review the captions show Pocket 3, 4P and 60mm, as the speaker's own burned-in subtitles write them, where they showed 三, 四 P and 六十 mm, and 類型 where they showed 型別; its transcript now times OK，, Let's and go as three words, and the line 到底值不值得？OK，Let's go, which this edit leaves out, lays out at 9:16 as 等了這麼久 / 到底值不值得？ then OK, Let's go., where it was 不值得？OK，Let's / go.

**Caption styles.** The planner's edits of the [synthetic corpus](../../bench/README.md#synthetic-corpus) (seed 0) chat-b at 60 s 9:16 and talk-a at 60 s 16:9, each rendered again from its `project.json` in `creator`, `minimal`, `pop` and `none` with no new plan, score as the `bold` render does in `vebench report`: 60.0 s and 61.5 s (within 2.5 %), no cut inside a word (0 of 22), 0 clicks at 9 cuts and 0.0 ms of drift. The SubRip file follows each style's captions (24 cues of chat-b in `bold`, 57 in `creator`, 18 in `minimal`, 25 in `pop`) and in `none` is `bold`'s. The edits main planned, rendered in `bold` with this code, give the same frames as main's renders, frame for frame (`framemd5` of the video). Graphics are planned clear of every style's captions: over four edits (chat-b, talk-a, and 60 s 9:16 edits of two CC BY 3.0 talking-head videos) one graphic was left out for lying under the captions, against three in the same four edits planned on the code before.

## Render measurements

These runs use synthetic footage from `scripts/synthetic-edit.ts`. The script renders two edits from test patterns at 1920×1080, the first also with effect overlays across its cuts. The sources cover 24, 25, 30 and 60 fps, a variable rate, a rotated phone clip, 10-bit PQ, a file without sound and a silent track, each with its own tone.

```bash
node scripts/synthetic-edit.ts /tmp/synthetic-edit --width 1920 --height 1080
cd ../../bench && uv run vebench report /tmp/synthetic-edit
```

| `vebench report` | Cuts | Clicks | Max \|drift\| |
|---|---|---|---|
| This renderer: 14 hard cuts, then dissolves, a dip, B-roll and framing | 18 | 0 | 0.0 ms |
| The same 14 cuts with each clip encoded alone with 30 ms fades and joined with `-c copy` | 13 | 0 | 57.6 ms |
| The same 14 cuts with five effect overlays across them | 13 | 0 | 0.0 ms |

Peak memory of the whole render without overlays, every FFmpeg process included, on 0.4–0.5 s clips. Each overlay a piece spans adds one VP9 decoder ([its memory](../effects/README.md#rendering)).

| Source | Clips | One FFmpeg with an input per clip | Pieces |
|---|---|---|---|
| H.264 1080p30 | 10 / 50 / 150 | 1.3 / 4.6 / 11.3 GB (≈110 MB a clip) | 1.27 / 1.27 / 1.27 GB |
| HEVC 4K 10-bit PQ | 5 / 30 | ≈650 MB a clip | 1.63 / 1.68 GB |

## Effect measurements

The effects and motion graphics render with [HyperFrames](../effects/README.md#rendering) 0.8.164 in Chrome Headless Shell 149. Before, they rendered with Remotion 4.0.531.

**Speed.** The same content at the same sizes and frame counts: two full-frame checklists of 105 frames at 1080×1920 and 1920×1080, and two lower thirds of 120 frames with alpha. Each figure is seconds for both renders of a pair. HyperFrames ran 4 workers; Remotion ran at its default concurrency.

| Machine | Full frame: HyperFrames | Full frame: Remotion | Lower thirds: HyperFrames | Lower thirds: Remotion |
|---|--:|--:|--:|--:|
| Reference machine, 8 cores | 10.8 | 17.0–17.8 | 10.1 | 13.3–13.8 |
| GitHub's Linux runner | 32–35 | 42.4 | 21–22 | 27.2 |
| GitHub's macOS runner (arm64) | 49–58 | 142–147 | 22–26 | 113–117 |
| GitHub's Windows runner | 44–46 | 52.3 | 31–32 | 33 |

- **Lower thirds at their own size:** a label or lower third now renders only at the box it draws in, with alpha: 9.5 s on Linux, 15 to 17 s on macOS and 18 s on Windows for the pair.
- **Opaque pages:** a full-frame graphic or panel renders as H.264 without alpha, which HyperFrames captures faster on Linux: 48 ms a frame for a 1080×1920 graphic, against 128 ms for the same page with alpha and 83 ms for Remotion's cards.
- **Windows:** full-frame overlays with alpha took 0.95 to 1.24 times Remotion's time, depending on the runner.
- **Same frames every time:** every file's decoded frames hashed the same over three renders on each system (`framemd5`). The WebM files' bytes differ between runs, in their mux metadata. Frames differ between systems, each of which runs its own Chrome build.

**Graphics on real footage.** Six edits of CC BY clips from the [step 3 check](#planner-measurements) (#103) were made again with `pnpm edit --asr cloud --quality best`. Claude wrote each edit's graphics in one request and fixed the ones the checks failed in one more; what still failed was left out.

| Edit | Written | Kept | With icons | Left out because | Claude: all, graphics |
|---|--:|--:|--:|---|---|
| real-2, 60 s at 9:16 | 15 | 13 | 3 | 1 too near the end, 1 too close to the one before | $0.51, $0.42 |
| real-10, 60 s at 9:16 (English) | 9 | 7 | 3 | 2 text under the captions | $0.48, $0.41 |
| real-8, 60 s at 9:16 | 11 | 9 | 3 | 1 too little of the panel filled, 1 text under the captions | $0.45, $0.35 |
| real-1, 60 s at 9:16 | 9 | 8 | 3 | 1 too close to the one before | $0.41, $0.30 |
| real-2, 3 min at 16:9 | 21 | 20 | 10 | 1 too near the end | $0.76, $0.63 |
| real-6, 3 min at 16:9 | 18 | 15 | 6 | 1 texts overlap, 1 a word not said, 1 too close to the one before | $0.93, $0.74 |

- **Cost:** a 60 s edit cost $0.41 to $0.51 in all, a 3 min one $0.76 and $0.93. The graphics are 75 to 85 % of it; writing them is half to most of that, the fix request the rest.
- **Hard rules:** every edit lands within ±5 % of its length (−3.2 to +4.4 %), with 0 clicks at 18 cuts and 0.0 ms of drift.
- **Icons and logos:** 28 of the 72 graphics kept mark their words with an icon. None shows a logo: no clip names a brand among the bundled logos.
- **The real-2 and real-8 60 s edits** were made again after two fixes to the checks: a unit said after a number counts as said (a panel showing 27 and 歲 apart had been left out as saying 歲 unsaid), and a graphic's icons count toward how much of its area it fills.
- **Still stretches:** real-2 at 60 s was made last, once code asks Claude for a graphic where the picture holds still longer than the shape allows: 13 graphics, against 9 before, 2 of them written for such stretches, at $0.51. The planner table and the other edits here were measured before that request, and before a capture had to be named in its line.
- **Restating a phrase:** real-2 at 60 s opened on a panel reading 害怕 becoming thirty？ over the line 會害怕 becoming thirty 嗎？, which the check for a run of eight passed. With the check for most of a phrase, the same footage edited again opens on 害怕 and THIRTY: 8 graphics, 60.0 s, 0 clicks, Claude $0.57.
- **What the checks do not see:** text already drawn into the footage. Some of real-6's lower thirds land on its own titles.

## Colour measurements

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

**Real footage.** A corpus interview is cut from three cameras: a wide two-shot and a close-up of each person. Each camera's footage was cut into its own source, and an edit alternating between them was graded as the planner grades it. Both cameras were left unmatched ([matching](README.md#matching)), so each surface differs as much afterwards as before. One person's cheek, in the wide shot and in the close-up the edit uses most, differs by ΔE00 17.4, mostly in chroma (C* 39.6 against 15.0). The other person's cheek, in the wide shot and in that person's close-up, differs by 10.2. The angle of the light on a face changes with the camera, so not all of these differences are the cameras'.

## Voice measurements

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
- **Peaks:** before the renderer checked the encoded true peak, the talk show's plain renders peaked at +2.2 and -0.8 dBTP, though their mastered sound was at -1.0: the AAC encoder added the rest. Re-rendered with the check, they peak at -3.8 and -1.2 dBTP. On `wikilive-d1` the encoder's overshoot fell from 3.2 dB to 0.5 dB as the limiter went lower, so the second try lands 2.8 dB under the target and its loudness 0.6 LU under -16 LUFS. The voice renders peak far enough under the target that they are not limited, and measure the same as before. The cut renders still have 0 clicks and 0.0 ms of drift. With the search that tries again near the target once a try lands more than 1 dB under it ([#16](https://github.com/zcxy-dev/fineframe/issues/16)), the synthetic edits (`scripts/synthetic-edit.ts`) render the same: 0 clicks, 0.0 ms of drift and the same peaks, since none needs the limiter; noisy transients at 8 and 30 s peak at -1.1 and -1.4 dBTP on Linux, as before.

**Cuts:** `vebench report` on the renders cut at every pause, both clips of each synthetic degradation pooled (124 cuts each way) and the three real clips pooled (57 cuts each way): 0 clicks and 0.0 ms of drift, plain and voice alike, in every group.

**Word timings** stay put. `vework analyze` transcribed the processed render of `phone-c` with 10 dB of noise, and `vebench report` scored it against the clip's truth beside the degraded audio's transcript; with the noise gone the aligner finds word ends better:

| `phone-c`, pink noise at 10 dB SNR, transcribed from | MER | Start error p50 / p95 | End error p50 / p95 | Within 50 / 100 ms |
|---|---|---|---|---|
| The degraded audio | 7.1 % | 27 / 85 ms | 69 / 167 ms | 23 / 70 % |
| The processed render | 4.9 % | 22 / 76 ms | 30 / 133 ms | 61 / 88 % |
| For reference, the clip as generated | 5.2 % | 27 / 75 ms | 27 / 75 ms | 65 / 93 % |

On the real clips, without a hand-checked transcript, the render's transcript was scored against the recording's. The two agree on word timings (starts 15 to 23 ms apart at the median) but not always on the words: the mixed-script error between them is 5.0 % on `wikilive-d2`, 13.1 % on `wikilive-d1` and 37.8 % on `wikidata-openrefine`, whose crosstalk the speech model misreads differently in each, in places hearing more words in the render. Which of each pair is right waits for the corrected transcripts.
