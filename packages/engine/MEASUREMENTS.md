# Engine measurements

How the engine's behaviour, described in the [README](README.md), measures on the [synthetic corpus](../../bench/README.md#synthetic-corpus) and on openly licensed footage. Times are on the [reference machine](../../bench/README.md#reference-machine). The edit table's synthetic rows and the planner table are measured with rich visuals, the default, without stock footage; every other measurement here was made before rich visuals and holds for `--visuals minimal`.

## Edit measurements

Each row is one `pnpm edit` run with the real API on the reference machine. Every file was analysed with the 0.6B speech model and no transcript correction. The table mixes two kinds of row, as its Visuals column says:

- **The two synthetic rows** come from the [synthetic corpus](../../bench/README.md#synthetic-corpus) (seed 0), edited at 5dc8da9 with rich visuals, without stock footage (no Pexels or Pixabay key), and `--quality best`, one edit at a time. Rich visuals here are motion-graphics cards, with the icons and logos in them and their sound effects; Claude asked for no web capture. The first edit found the clips analysed by the [planner runs](#planner-measurements), which analysed the three in 3.2 min, all at once; the second analysed them again, since a names file changes the analysis.
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
| chat-b: synthetic conversation, 3 clips, 6.7 min | rich, without stock footage: 5 cards, 29 % of the edit | 60 s, 9:16 | 58.9 s (-1.8 %) | 0 of 12 | 0 | 0 of 5, 0.0 ms | from the cache | 44 s, 57 s, 8 s | $0.19 |
| chat-b again, with the corpus's three synthetic tracks (`--music`, stated CC0) and a names file naming the guest (`--names`) | rich, without stock footage: 5 cards, 29 % of the edit | 60 s, 9:16 | 59.3 s (-1.2 %) | 0 of 12 | 0 | 0 of 5, 0.0 ms | 9.9 min for the 3 clips and 3 tracks | 58 s, 44 s, 8 s | $0.20 |
| Two-person interview, 5 clips from three cameras, 11.9 min | minimal, measured before rich visuals | 60 s, 9:16 | 60.6 s (+1.0 %) | 0 of 4 | 0 | 0 of 2, 0.0 ms | 23.9 min | 29 s, 28 s, 5 s | $0.10 |
| Live talks with slides, 3 clips, 8.8 min | minimal, measured before rich visuals | 5 min, 16:9 | 301.5 s (+0.5 %) | 0 of 57 | 0 | 0 of 28, 0.0 ms | 16.0 min | 52 s, 60 s, 21 s | $0.13 |
<!-- /results -->

- **Music and effects:** in the second chat-b edit Claude chose the 96 BPM track, which plays from 1.9 s to the end with the voice 21.0 dB over it while anyone talks (15.0 dB in the quietest 5 %, `vebench mix` on the stems of the same project rendered again), and its one join does not click; it showed the guest's name and role in a lower third, popped two keywords and pushed in on 3 of the 6 clips, at most 1.19 times; the sound measures -13.9 LUFS at -3.1 dBTP.
- **Visuals:** each synthetic edit cuts to 5 full-frame cards (a checklist, a list, a comparison, and a search and a highlighted line in the first, two highlighted lines in the second), 3.0 to 3.5 s each and 29 % of the edit, with a soft sound on 2 or 3 of them; the captions carry on over them.
- **Cost:** $0.19 and $0.20, against $0.10 for the same edits before rich visuals: the plan, $0.17 and $0.19, is most of it, as rich visuals make Claude write more (*Cost* under the planner's table).
- **Time:** the second chat-b edit analysed its 6.7 min of footage and 3.7 min of music in 9.9 min; on its own, without the names, the footage took 3.2 min, all three clips at once. Shot detection takes about a fifth of an analysis, faces an eighth, transcribing and aligning the rest. Another edit of the same footage starts at the plan and took 1.8 min here with rich visuals; 41 s to 2.3 min without.
- **Pictures:** in the 9:16 edits the crop follows whoever is on screen, and cuts to the listener's shot with the source. The interview's cuts join two answers inside one camera's shot, so they show as jump cuts; the talks cut between the host and the speaker at a pause.
- **Captions:** on the synthetic edit measured before rich visuals, each caption appears within 23 ms of its first word's true start at the median and 118 ms at the 95th percentile, and stays up about 0.4 s past its last word. This was not measured again.

## Planner measurements

These runs use the [synthetic corpus](../../bench/README.md#synthetic-corpus) (seed 0), each clip analysed at 5dc8da9 with the 0.6B speech model and no transcript correction. Each footage was planned, rendered and reviewed at each length its speech allows, with rich visuals, without stock footage (no Pexels or Pixabay key), and `--quality best`, one edit at a time: the two groups at 16:9, the single clips at 9:16 except the screen recording. The baseline keeps every clip whole, in file order, cut off at the target. `vebench edit` scores both, and `vebench render` the planner's renders.

```bash
# Each clip is analysed once into the index cache, then read from it
PEXELS_API_KEY= PIXABAY_API_KEY= node --env-file=../../.env scripts/plan-corpus.ts ../../bench/synthetic \
  --group talk-a --lengths 30,60,300 --naive --system rich --live-claude
cd ../../bench && uv run vebench report synthetic/
```

<!-- results:engine-planner -->
| Footage | Target | Length error, naive / planner | Cuts inside words: naive / planned → reviewed | Fillers cut | Retakes right | Dead air ≥ 1 s, naive / planner | Clicks, drift | Cards (share of the edit) | Claude |
|---|---|---|---|---|---|---|---|---|---|
| talk-a (3 clips, 7.0 min) | 30 s | +0.0 % / -2.3 % | 0 / 0 → 0 of 8 | 1 of 1 | 1 of 1 | 1 (2 s) / 0 | 0 of 3, 0.0 ms | 4 (47 %) | $0.15 |
| talk-a (3 clips, 7.0 min) | 60 s | +0.0 % / +1.9 % | 1 / 0 → 0 of 12 | 3 of 3 | 1 of 1 | 1 (2 s) / 0 | 0 of 5, 0.0 ms | 7 (37 %) | $0.12 |
| talk-a (3 clips, 7.0 min) | 300 s | +0.0 % / -0.6 % | 1 / 0 → 0 of 22 | 0 of 18 | 2 of 2 | 12 (25 s) / 0 | 0 of 10, 0.0 ms | 18 (19 %) | $0.49 |
| chat-b (3 clips, 6.7 min) | 30 s | +0.0 % / +0.0 % | 0 / 0 → 0 of 4 | 2 of 4 | – | 1 (1 s) / 0 | 0 of 1, 0.0 ms | 3 (35 %) | $0.13 |
| chat-b (3 clips, 6.7 min) | 60 s | +0.0 % / -0.2 % | 0 / 0 → 0 of 10 | 1 of 7 | – | 3 (8 s) / 0 | 0 of 4, 0.0 ms | 4 (23 %) | $0.13 |
| chat-b (3 clips, 6.7 min) | 300 s | +0.0 % / +0.0 % | 1 / 0 → 0 of 48 | 0 of 24 | 3 of 3 | 13 (30 s) / 0 | 0 of 23, 0.0 ms | 20 (22 %) | $0.50 |
| talk-a2 (2.4 min) | 30 s | +0.0 % / -0.4 % | 0 / 0 → 0 of 6 | 1 of 2 | – | 2 (3 s) / 0 | 0 of 2, 0.0 ms | 4 (42 %) | $0.12 |
| talk-a2 (2.4 min) | 60 s | +0.0 % / -2.1 % | 0 / 0 → 0 of 6 | 0 of 4 | – | 3 (5 s) / 0 | 0 of 2, 0.0 ms | 6 (32 %) | $0.11 |
| talk-a3 (2.1 min) | 30 s | +0.0 % / +0.0 % | 1 / 0 → 0 of 6 | 0 of 1 | 1 of 1 | 2 (3 s) / 0 | 0 of 2, 0.0 ms | 2 (23 %) | $0.16 |
| talk-a3 (2.1 min) | 60 s | +0.0 % / -0.9 % | 1 / 0 → 0 of 8 | 1 of 4 | 1 of 1 | 3 (4 s) / 0 | 0 of 3, 0.0 ms | 4 (23 %) | $0.21 |
| phone-c (77 s, 9:16) | 30 s | +0.0 % / +0.9 % | 1 / 0 → 0 of 12 | 3 of 6 | 1 of 1 | 2 (7 s) / 0 | 0 of 5, 0.0 ms | 2 (20 %) | $0.11 |
| phone-c (77 s, 9:16) | 60 s | +0.0 % / -0.4 % | 0 / 0 → 0 of 8 | 0 of 7 | 1 of 1 | 4 (11 s) / 0 | 0 of 3, 0.0 ms | 5 (28 %) | $0.12 |
| screen-d (75 s) | 30 s | +0.0 % / -1.3 % | 0 / 0 → 0 of 8 | 0 of 2 | 1 of 1 | 1 (2 s) / 0 | 0 of 3, 0.0 ms | 3 (31 %) | $0.13 |
| screen-d (75 s) | 60 s | +0.0 % / +1.3 % | 1 / 0 → 0 of 6 | 0 of 5 | 1 of 1 | 2 (6 s) / 0 | 0 of 2, 0.0 ms | 5 (29 %) | $0.13 |
<!-- /results -->

- **Length:** all 14 edits land within ±5 %, 0.9 % off on average and 2.3 % at most.
- **Cuts inside words:** none of 162 as planned, none of 164 after review; the baseline's cut at the target falls inside a word in 7 of 14 edits. When these 14 edits were measured before rich visuals and before the analysis shrank each gap between two words to the silence in it (*Word gaps* below), one of 170 planned cuts was inside a word: the index put 0.18 s of silence between 呃 and 講 where the speaker left none, so the cut after the removed filler clipped 講 by 115 ms, and the review put the filler back. In a separate check, the review passed a cut 30 ms before a word and caught one 100 ms into it.
- **Retakes:** the kept take was the right one in all 13 groups the edits used.
- **Dead air:** none left, against 50 silences of a second or more, 108 s in all, in the baseline.
- **Fillers:** recall is low, 12 of 88; no other word was cut between clips. The synthetic voice runs each filler straight into the next word: the median gap after one is 0 s, and only 2 of 69 leave the 0.13 s a cut needs. Whether real speech leaves more room is not measured yet.
- **Visuals:** the 14 edits cut to 87 full-frame cards of 14 kinds, the most a highlighted line (21), a checklist (13) or a before and after (11), with icons, 7 logo cards and 31 soft sounds. Cards fill 19 to 47 % of an edit, more in the short edits than the long; the planner left out the cards whose lines were cut, or that came too close to the one before. Claude asked for no web capture.
- **Cost:** $2.62 for all 14 edits, $0.11 to $0.50 each, against $0.90 and $0.02 to $0.12 before rich visuals. Planning is 90 % of it: Opus writes 3,100 to 7,200 tokens for a 30 or 60 s plan and 16,000 to 17,600 for a 300 s one, so a plan costs $0.11 to $0.20, and $0.39 and $0.42 at 300 s. The cached prefix, the instructions and the packed transcripts, is 9,500 to 13,600 tokens; three plans read it from the plan before. The 112 cut checks cost $0.028 together, and the 17 escalated to Opus $0.24. One review changed an edit: chat-b at 300 s, twice, before its third pass found nothing to change.
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
  - **The same plans, placed again:** placing the words of the three step 3 edits that broke the hard rules again, with this code, moves every edge that fell inside a word by scribe-v2's timings: the five in real-4 (去, 售, 京, 店 and 裡) now sit in silence, and real-9's pause around the false start "Getting kicked out." is no longer cut, as speech fills it.
  - **The same footage, edited again:** each edit was made again with `pnpm edit --asr cloud --quality best`, a new plan from Claude. Every edge was checked against scribe-v2's own word timings on 3 s of source either side, and every edge inside a word was looked at on a spectrogram. One remains unclear: a real-4 clip starts 140 ms into a 剛 that scribe-v2 hears and the recording shows faintly under street noise, while the denoised speech is at the level of the pauses there.

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

Measured before rich visuals, with what is now `--visuals minimal`, on a 60 s 9:16 edit of the [synthetic](../../bench/README.md#synthetic-corpus) conversation chat-b (seed 0) with music, a lower third and two keywords: a fresh agent with only the skill made three versions from what a person would say, twice. It cut the 4.1 s segment about clicks at the joins with `--cut 29.14-32.72` and `--retarget`, fixed a misheard caption (能比如說 to 嗯　比如說) and added a title, shortened to end where the first keyword starts. The planned edit rendered in 32 s on the reference machine; the agents' renders took 39 s to 2.8 min, with other renders running beside them. By hand, one more cut took a sentence out of the middle of a clip (`--cut 43.56-47.56 --retarget`), which split it in the pauses on either side, and two more versions covered the other recipes: a lower third's role, a keyword removed and one added, a chapter, the music 3 dB down, then no music, the `warm` look and the `sweep` captions. `vebench report` on all of them:

| Version | Length | Cuts inside words | Clicks, drift |
|---|---|---|---|
| The planned edit | 59.57 s | 0 of 14 | 0 of 6, 0.0 ms |
| Segment cut, `--retarget` (both runs) | 55.47 s | 0 of 12 | 0 of 5, 0.0 ms; also 0 of 5 rendered without music |
| Caption fixed, then title added (both runs) | 55.47 s | 0 of 12 | 0 of 5, 0.0 ms |
| A sentence cut from inside a clip | 54.83 s | 0 of 16 | 0 of 7, 0.0 ms |
| The other recipes, two versions | 59.57 s | 0 of 14 | 0 of 6, 0.0 ms |

On frames from each version the captions showed the words then said and lit the word being said, the keyword added landed on its word, and every frame after the cut matched the planned edit's frame 4.133 s later, captions included.

## Framing measurements

On the synthetic corpus's three conversations, framed 9:16, the face of the person talking is inside the crop 99.4 % of the time it is on screen, missing only replies too short to turn to; a centre crop holds it 80.5 % of the time, and in the wide shots shows the empty space between the two people. Each talker is taken as the face the analysis names most while the corpus's truth has them talking in a shot. With split screens, 31 s of the three clips' wide shots, where both people take turns, show both at once, one above the other, and the share is the same 99.4 % of 3,131 samples; in 106 s of close shots, where a drawn head touches the picture's top, the crop reaches past the picture under a blurred band. Cut together from eight clips, the moving crops add no clicks and no drift (`vebench render`: 0 of 7 cuts, 0.0 ms).

## Caption measurements

The planner's edits of the [synthetic corpus](../../bench/README.md#synthetic-corpus) (seed 0) talk-a2, 30 s at 9:16, and chat-b, 60 s at 16:9, rendered with their captions score as they do without them in `vebench report`: 1.7 % and 2.3 % off the length, no cut inside a word, 0 clicks and 0.0 ms drift. On a 62.6 s 9:16 edit of a corpus interview, libass draws the `bold` captions (1,260 events over 1,566 frames at 1080×1920) in 3.2 s more than decoding the frames alone takes, about 2 ms a frame. Captions were not rendered with Remotion for comparison: its effect overlays take about 0.2 s a frame at 1080p ([effects](../effects/README.md#rendering)), about a hundred times as long, so captions are drawn by libass. The two have not been compared by look.

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
| The same 14 cuts with seven effect overlays across them | 13 | 0 | 0.0 ms |

Peak memory of the whole render without overlays, every FFmpeg process included, on 0.4–0.5 s clips. Each overlay a piece spans adds one VP9 decoder ([its memory](../effects/README.md#format)).

| Source | Clips | One FFmpeg with an input per clip | Pieces |
|---|---|---|---|
| H.264 1080p30 | 10 / 50 / 150 | 1.3 / 4.6 / 11.3 GB (≈110 MB a clip) | 1.27 / 1.27 / 1.27 GB |
| HEVC 4K 10-bit PQ | 5 / 30 | ≈650 MB a clip | 1.63 / 1.68 GB |

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
