# vework

Analyzes a source file into a media index: the facts about the footage that the editing engine will plan from.

Setup and the speech-model choice are in the [README quick start](../README.md#quick-start). `--bench-run DIR` also writes the outputs [vebench](../bench/) scores. `vework draft-truth` drafts a corpus clip's transcript for a person to correct ([workflow](../bench/README.md#ground-truth)). `vework analyze-music` analyses a music track for the edit ([below](#music)).

## Media index

[`media-index.schema.json`](../packages/schema/media-index.schema.json) defines the format, field by field; [an example](../packages/schema/examples/media-index.example.json) shows a whole index. In short: the source's streams, its shot transitions, where someone speaks, the transcript with word timings, the loudness of every second, where laughter, applause and music are heard, the faces in each shot with who of them speaks, and how the speech sounds.

vework checks each index against the schema before writing it, through the model generated into [`media_index.py`](src/vework/media_index.py), and exits with an error naming the field that does not match.

Loudness is measured from the decode for speech detection, resampled to 48 kHz in the source's own channels rather than read from the speech models' 16 kHz mono mix, which loses broadband sound such as applause and mixes the channels before BS.1770 weighs them. Audio events read that mix; the [voice](#voice) measurements decode the audio again at 48 kHz. The events come from [CED-Base](https://huggingface.co/mispeech/ced-base), an AudioSet tagger, as an int8 ONNX model (87 MB, downloaded on first use) run by ONNX Runtime. On 8 cores of an EPYC 9355P the two add about 0.9 s per source minute, and reading loudness at 48 kHz about 0.2 s of CPU time more for a stereo track. The tagger holds about 0.5 GB while it runs.

## Voice

When the first audio track has speech, vework measures it for the engine's [voice chain](../packages/engine/README.md#voice) and writes it with its noise removed beside the index: `talk.index.json` gets `talk.voice.wav`. The stem holds two channels at 48 kHz in 32-bit float, starting at the source's time zero and as long as the track: the track's mono mix as recorded, and the same with its noise removed in full. Both come from one decode, so they line up sample for sample, where the renderer's own decode need not (see the engine's [How it renders](../packages/engine/README.md#how-it-renders)). The renderer decides how much of the recording to mix back. A 2-hour source's stem takes 2.8 GB, and the analysis needs another 1.4 GB of disk beside it while it runs.

- **Denoiser:** [DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet), from the ONNX export in its repository (an 8 MB archive, pinned by commit and SHA-256, downloaded on first use to `~/.cache/video-editor/`), run by ONNX Runtime. The model's own package cannot be installed beside this worker: it requires numpy below 2 and has no Python 3.12 wheel of its Rust extension. [`denoise.py`](src/vework/denoise.py) therefore computes the model's input features, its deep filtering and the resynthesis itself. A mistake there shows in the model's look-ahead: on synthetic speech in white noise at 10 dB SNR, the model's own two frames give 19.9 dB SNR out, against 18.6 with three and 12.3 with none.
- **It lowers reverberation too:** on the synthetic voice in rooms of 0.5 and 0.7 s, what is left reads about 0.2 s.
- **Long sources** run in 15 s chunks, each with 5 s of the audio before it to settle the model and cross-faded into the last over 1 s. On the synthetic speech in noise, chunked and whole runs score the same SNR. The result is written over the decoded track, so the track is held once; the recording waits in a temporary file beside the index meanwhile.
- **Cost:** on 8 cores of an EPYC 9355P shared with other jobs, denoising took 1.9 to 2.9 s per minute of audio and the two measurements 0.2 s. On a 2-hour source the whole stage took 5 minutes and peaked at 2.3 GB, the 1.4 GB track included; the analysis holds its 16 kHz track (0.46 GB) beside it.

Both the recording and the denoised speech are measured, as [`voice` in the schema](../packages/schema/media-index.schema.json) defines each value, so the stages after the denoiser are chosen from what they will receive. The loudness range reads EBU Tech 3343's 10 LU case as 10.0. Reverberation, on the synthetic voice convolved with synthetic rooms:

| Room RT60 | 0 (dry) | 0.2 s | 0.4 s | 0.7 s | 1.0 s |
|---|---|---|---|---|---|
| Read, with the direct sound as loud as the room's | 0.07 | 0.19 | 0.44 | 0.67 | 0.99 |
| Read, with the direct sound 6 dB louder | | 0.16 | 0.32 | 0.66 | 0.80 |

A fall needs 15 dB above the room to be read, so a noisy recording reads null and only its denoised speech has a reverberation time.

## Faces and speakers

The index's `framing` says, shot by shot, how the picture is laid out, where each face is and who speaks when. The engine turns it into a crop path for the output's shape ([framing](../packages/engine/README.md#framing)).

- **Faces:** [YuNet](https://huggingface.co/opencv/face_detection_yunet), run by OpenCV on the frame on screen five times a second, upright, with square pixels (anamorphic footage is widened to the shape it shows) and scaled down to the sizes YuNet finds faces at. Its 230 KB of weights are downloaded on first use at a pinned revision and checked against their SHA-256.
- **Shots and layouts:** shots run between the index's transitions, split at a cut or in the middle of a dissolve. Within each, faces are tracked and the shot given one of the [layouts](../packages/schema/media-index.schema.json) `talking_head`, `two_shot`, `group`, `screen_cam` or `screen` ([`framing.py`](src/vework/framing.py) holds the thresholds). A face counts when it is in enough of the shot's samples; faces are not matched across shots.
- **Faint and weak faces:** YuNet scores a head turned aside lower than one facing the camera: a drawn speaker turned 30 to 40 degrees towards a listener scores 0.5 to 0.87 beside the listener's 0.90. So faces are kept from a score of 0.5, but one that scores under 0.72 for most of the shot, or under 0.85 beside a face scoring 0.90, counts only when it is named the speaker for 2 s of the shot or more, which a false detection, a nod or a laugh is not. Who speaks is then judged again without the faces dropped. Only the confident faces of a sample can carry a track through a jump.
- **Who speaks:** where Silero hears speech, a second at a time, the face whose mouth changes most over the tenth of a second after each sample. The change is measured after following the head from frame to frame, and counted against the face's own eyes and nose, so a nod or a camera move does not count and a big face does not win by size. A second where no mouth moves clearly, as in a voice-over, names no one. It needs no model beyond the face detector.
- **Measured** with `vebench report` on the [synthetic corpus](../bench/README.md#synthetic-corpus) (seed 0, all 8 clips). Of the 624 s in which one person on screen talks, the index names that person 90.8 % of the time, someone else 0.45 % and no one 8.8 %. Through 210 s of voice-over and off-screen speech it names no one. The two-person clips score 91 to 94 %, the talks 90 % and the walking selfie 85 %. Drawn faces are easier than real ones.
- **Limits:** a head turned more than about 50 degrees, nearly in profile, is not found at all, so the camera stays on whoever faces it. Real footage is not scored yet.
- **Cost:** frames stream through, and a shot's samples are dropped once it is framed. On 8 cores of an EPYC 9355P, the stage takes 4 to 8 s per source minute from 360p to 1080p and peaks at about 0.4 GB, the same for a 2- and a 12-minute source. Each face on screen adds about 50 KB of boxes to the index per source minute.

## Transcript correction

`--correct` has Claude fix what the speech model misheard (names, terms, homophones) before the aligner times the words, so captions and cuts follow the corrected text. Claude gets one transcribed chunk at a time, with the chunks around it, the video's title (`--title`) and an optional glossary (`--glossary FILE`), and proposes edits with a reason each. `vework analyze --help` names the model.

```bash
uv run --env-file ../.env vework analyze talk.mp4 -o talk.index.json --correct --glossary terms.txt
```

- **Off by default:** it needs a key, costs money and sends text to Anthropic ([what is sent, and how far it is measured](../README.md#what-works-today)).
- **Key:** the Anthropic SDK reads `ANTHROPIC_API_KEY` (or an `ant auth login` profile). `uv run --env-file ../.env` loads it from the git-ignored `.env` at the repository root. Without one, `--correct` fails before the analysis starts.
- **Only safe edits are applied.** vework lines each proposal up with the transcribed text word by word, counting words as vebench does, and rejects any that does more than fix misheard words:
  - A misheard Chinese character is replaced one for one, since each character is a spoken syllable.
  - Two English words the speech model split may merge into one ("and topic" to "Anthropic"), unless one of them is a filler or a repeat.
  - No word changes script: Chinese stays Chinese and English stays English.
  - Nothing else is added or removed: not fillers or repeats, which the editor cuts by their timings, and not symbols that are read out, such as `%` or `$`.
  - A proposal that changes more than a small share of a chunk's words is a rewrite, not a fix.

  Proposals are converted to Taiwan Traditional Chinese before they are checked.
- **Everything is recorded.** `corrections` in the index lists every proposal with Claude's reason and, for a rejected one, why it was rejected, so wrong corrections can be found when measuring.
- **Batch:** requests go out right away, several at a time, because an analysis normally runs while someone waits for their edit. `--batch` sends them as one [Message Batch](https://platform.claude.com/docs/en/build-with-claude/batch-processing) instead: half the price, but it can take up to 24 hours, for corpus runs and other jobs nobody waits on.
- **Declined chunks:** when Claude declines a chunk, it stays as transcribed and its record says so. No other model is asked, so every correction comes from the same model.
- **Glossary:** a UTF-8 text file with one name or term per line; blank lines and lines starting with `#` are skipped. `--asr-context` also gives it to Qwen3-ASR as its context prompt, which biases recognition towards those words. It is a separate option so its effect can be measured apart from Claude's.

## Word timings

Qwen3-ForcedAligner times words on an 80 ms grid and gives some characters no duration. A zero-length character first gets the free time beside it or, with none, an even share of a neighboring Han character's time; an English neighbor keeps its own. [`timing.py`](src/vework/timing.py) then reads each edge from the audio level in the grid cell that starts at the reported time (its constants set the level's window and thresholds):

- **Between two words:** the quietest point in the cell, the dip between their syllables, or the cell's end where the level is still falling there.
- **After a pause:** where the level rises clearly above the pause.
- **Before a pause:** where it falls back; if the sound lasts through the cell, the cell's end.

Edges only move later, and never past their chunk, their Silero speech segment or the next edge, so words keep their order and never overlap. A pause edge stays put where the cell shows no rise or fall, and silence moves nothing.

**Measured** with `vebench report` on the [synthetic corpus](../bench/README.md#synthetic-corpus) (seed 0, all 8 clips, 3,597 timed words); the hand-checked corpus will replace these numbers.

| | Start error p50 / p95 | End error p50 / p95 | Start and end within 50 ms | Within 100 ms | MER |
|---|---|---|---|---|---|
| Aligner | 71 / 134 ms | 70 / 137 ms | 9.3 % | 61.9 % | 3.63 % |
| Refined | 23 / 86 ms | 26 / 93 ms | 66.1 % | 92.9 % | 3.63 % |

By kind of edge, on the same aligner output (median error, share within 50 ms):

| Edges | Count | Aligner | Refined |
|---|---|---|---|
| Between two words | 6,107 | 76 ms, 24 % | 27 ms, 81 % |
| After a pause | 524 | 27 ms, 79 % | 5 ms, 94 % |
| Before a pause | 549 | 34 ms, 66 % | 23 ms, 73 % |

**Why the cell after the reported time**, not ±40 ms around it: after a pause, where the synthetic truth is where the sound starts, the true start falls a median 25 ms after the aligner's time, and 79 % of the time inside the cell. Snapping to dips within ±40 ms of the reported time brought 34 % of words within 50 ms; within the cell, 63 %. A wider search gained at most 4 points more, and only the synthetic voice would have set its size. Clamping starts to Silero's segment edges added a point on its own, and nothing once rises are read.

**What the synthetic corpus cannot settle:** its speech comes from one TTS model, and between two words its truth is that model's phoneme boundary, about 15 ms after the level dip. That boundary lies a median 75 ms after the aligner's time: inside the cell only 54 % of the time, past it 43 %. So 16 % of between-word edges end on the cell's end because the level is still falling there, and leaving those where the aligner put them would bring 51 % of words within 50 ms instead of 66 %. Shifting every between-word edge 60 ms later, without reading the audio, scores the same as the dips (66 % and 93 %). Whether reading the audio between words beats a fixed shift, and whether people hear a word start at the dip or on the rise after it, needs the hand-checked corpus.

## Music

`vework analyze-music` writes a [music index](../packages/schema/music-index.schema.json) for one track you supply, which the planner can then [put under an edit](../packages/engine/README.md#planning). Use only music you have the right to use: your own, or a library's whose licence allows it. The licence is required, recorded in the index, copied into the project and written next to every video that plays the track.

```bash
uv run vework analyze-music song.mp3 -o song.music.json --license "CC BY 4.0" \
  --license-url https://creativecommons.org/licenses/by/4.0/ --attribution "Song by Artist"
```

- **Beats and downbeats:** the [Beat This!](https://github.com/CPJKU/beat_this) model (Foscarin, Schlüter and Widmer, ISMIR 2024), its `final0` checkpoint, on 20 ms frames, with its own peak picking. The checkpoint (81 MB, MIT like the code) downloads on first use into torch's hub folder and is checked against its SHA-256. The package needs torchaudio only to read files and compute its input, and no torchaudio release matches the worker's torch, so [`beats.py`](src/vework/beats.py) decodes the track at the model's 22.05 kHz, averages its channels and computes the same log-mel spectrogram itself. The model sees 30 s at a time, the length it was trained on, and each window's predictions are kept only away from its edges. It also marks beats in the silence around the music, such as the one the music would reach next as its last bar rings out; those are dropped.
- **Tempo:** from the median time over 8 beats, which reads it finer than the model's 20 ms frames; the bar's length in beats from the downbeats.
- **Sections:** each bar is summed up by its mean spectrum, and a downbeat starts a section where the 4 bars after it differ from the 4 before by more than either group differs within itself ([`music.py`](src/vework/music.py) has the threshold). A break of a bar or two inside a section starts nothing. Each section has its gated loudness.
- **Loudness:** short-term loudness of every second at 48 kHz, each channel weighed apart as BS.1770 adds them; a downmix would read unrelated stereo channels up to 6 LU low and set the music too loud.
- **End:** where the sound last comes within 50 dB of its loudest 50 ms, which is where the edit's last frame lands when the music ends on its own ending.

Times are on the file's own timeline, as the renderer decodes it: a VBR MP3 of a synthetic track decodes sample for sample where its WAV does, in vework and in the renderer.

**Accuracy.** On the [synthetic corpus](../bench/README.md#synthetic-corpus)'s three tracks (96, 112 and 128 BPM, 71 to 77 s, each an intro, a main part and an outro), `vebench beats` finds every beat and downbeat and nothing else (F-measure 1.000 for both), beats a mean 4 to 6 ms and at most 20 ms from the truth, and the tempo within 0.3 %; every section starts within 11 ms of the true one. A VBR MP3 of the 112 BPM track scores the same as its WAV. On four licensed tracks (CC BY 4.0 and CC0) there is no truth to score against: a jazz trio reads 83 BPM, its catalogue's tempo; an orchestral piece and a synth track read at half theirs (52 for 104, 75 for 150), so their beats are every other one and a cut has half as many to land on. A track of 1 to 5 min takes 9 to 14 s and at most 0.9 GB on 8 cores of an EPYC 9355P, including loading the model.
