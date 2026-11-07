# vework

Analyzes a source file into a media index: the facts about the footage that the editing engine will plan from.

Setup and the speech-model choice are in the [README quick start](../README.md#quick-start). `--bench-run DIR` also writes the outputs [vebench](../bench/) scores. `vework draft-truth` drafts a corpus clip's transcript for a person to correct ([workflow](../bench/README.md#ground-truth)). `vework analyze-music` analyses a music track for the edit ([below](#music)).

Each step is a `vework: <step>` line on stderr; shot detection also says how far it is every 5 % of the frames (`vework: detecting shots 40%`). Messages and the files vework writes are UTF-8 on every system, Windows included. A model downloaded on its first use reports its bytes as it arrives, as `vework: downloading <model>: <bytes> of <total> bytes` lines ([`download.py`](src/vework/download.py)); a model already in the cache, or the cache read offline, prints none.

## Media index

[`media-index.schema.json`](../packages/schema/media-index.schema.json) defines the format, field by field; [an example](../packages/schema/examples/media-index.example.json) shows a whole index. In short: the source's streams, its shot transitions, where someone speaks, the transcript with word timings, the loudness of every second, where laughter, applause and music are heard, the faces in each shot with who of them speaks, and how the speech sounds.

vework checks each index against the schema before writing it, through the model generated into [`media_index.py`](src/vework/media_index.py), and exits with an error naming the field that does not match.

Loudness is measured at 48 kHz in the source's own channels, as BS.1770 weighs them; on synthetic speech, music and noise it reads what FFmpeg's EBU R128 meter reads to 0.1 LU. Audio events come from [CED-Base](https://huggingface.co/mispeech/ced-base), an AudioSet tagger, as an int8 ONNX model (87 MB, downloaded on first use) run by ONNX Runtime. On the [reference machine](../bench/README.md#reference-machine) the two add about 0.9 s per source minute, and the tagger holds about 0.5 GB while it runs.

Frames stream through shot detection, so a 2-hour 1080p60 file peaks there at about 1.3 GB.

## Apple silicon

On a Mac whose GPU PyTorch can use (MPS), the analysis runs some models there and decodes video with VideoToolbox ([`gpu.py`](src/vework/gpu.py)).

- **On the GPU:** shot detection and the speech model, through PyTorch's MPS backend in the precision each runs in on a CPU; the denoiser through ONNX Runtime's Core ML provider in 32-bit floats, with any node Core ML cannot run left to the CPU. Speech detection, audio events, faces and the aligner stay on the CPU. The speech model is Qwen3-ASR-0.6B, as on a CPU.
- **VideoToolbox** decodes the video for shot detection and faces; the renderer decodes in software. On an Apple M1 it decodes the frames software decoding does, at the same times and size; luma is identical, and chroma differs by up to 89 levels at edges, about 1 on average.
- **Falling back:** a step whose model fails to load or to run on the GPU, or gives NaN or empty output (the speech model hearing nothing in any chunk), runs on the CPU from then on. Video VideoToolbox cannot decode is decoded again in software.
- **Where each step ran** is in `vework:` lines that only a Mac prints, such as `shot detection: on the GPU (MPS)`, `faces: decoding video with VideoToolbox`, `denoising: on the GPU (Core ML)` or `speech model: failed on the GPU (RuntimeError: …); running it on the CPU`. `pnpm edit` prints them; the app writes them to the edit's `edit.log` when an edit fails.
- **`VEWORK_DEVICE=cpu`** keeps every step on the CPU on a Mac too.

## Voice

When the first audio track has speech, vework measures it for the engine's [voice chain](../packages/engine/README.md#voice) and writes it with its noise removed beside the index: `talk.index.json` gets `talk.voice.wav`. The stem holds two channels at 48 kHz in 32-bit float, starting at the source's time zero and as long as the track: the track's mono mix as recorded, and the same with its noise removed in full. Both come from one decode, so they line up sample for sample, where the renderer's own decode need not (see the engine's [How it renders](../packages/engine/README.md#how-it-renders)). The renderer decides how much of the recording to mix back. A 2-hour source's stem takes 2.8 GB, and the analysis needs another 1.4 GB of disk beside it while it runs.

- **Denoiser:** [DeepFilterNet3](https://github.com/Rikorose/DeepFilterNet), from the ONNX export in its repository (an 8 MB archive, pinned by commit and SHA-256, downloaded on first use to `~/.cache/video-editor/`), run by ONNX Runtime. [`denoise.py`](src/vework/denoise.py) computes the model's input features, its deep filtering and the resynthesis itself, without the model's own package. It lowers reverberation too: on the synthetic voice in rooms of 0.5 and 0.7 s, what is left reads about 0.2 s.
- **Long sources** run in 15 s chunks, each settled on the audio before it and cross-faded into the last; chunked and whole runs score the same SNR.
- **Cost:** on the [reference machine](../bench/README.md#reference-machine), denoising takes 1.9 to 2.9 s per minute of audio and the two measurements 0.2 s. On a 2-hour source the whole stage takes 5 minutes and peaks at 2.3 GB.

Both the recording and the denoised speech are measured, as [`voice` in the schema](../packages/schema/media-index.schema.json) defines each value, so the stages after the denoiser are chosen from what they will receive. The loudness range reads EBU Tech 3343's 10 LU case as 10.0. Reverberation, on the synthetic voice convolved with synthetic rooms:

| Room RT60 | 0 (dry) | 0.2 s | 0.4 s | 0.7 s | 1.0 s |
|---|---|---|---|---|---|
| Read, with the direct sound as loud as the room's | 0.07 | 0.19 | 0.44 | 0.67 | 0.99 |
| Read, with the direct sound 6 dB louder | | 0.16 | 0.32 | 0.66 | 0.80 |

A fall needs 15 dB above the room to be read, so a noisy recording reads null and only its denoised speech has a reverberation time.

## Faces and speakers

The index's `framing` says, shot by shot, how the picture is laid out, where each face is and who speaks when. The engine turns it into a crop path for the output's shape ([framing](../packages/engine/README.md#framing)). The thresholds are in [`framing.py`](src/vework/framing.py).

- **Faces:** [YuNet](https://huggingface.co/opencv/face_detection_yunet), run by OpenCV on the frame on screen five times a second, upright, with square pixels (anamorphic footage is widened to the shape it shows). Its 230 KB of weights are downloaded on first use at a pinned revision and checked against their SHA-256.
- **Shots and layouts:** shots run between the index's transitions, split at a cut or in the middle of a dissolve. Within each, faces are tracked and the shot given one of the [layouts](../packages/schema/media-index.schema.json) `talking_head`, `two_shot`, `group`, `screen_cam` or `screen`. A face counts when it is in enough of the shot's samples; faces are not matched across shots.
- **Faint faces:** YuNet scores a head turned aside lower than one facing the camera, so faces are kept from a low score, but a faint one counts only when it is named the speaker for 2 s of the shot or more, which a false detection, a nod or a laugh is not.
- **Who speaks:** where Silero hears speech, a second at a time, the face whose mouth changes most, measured against the face's own eyes and nose after following the head, so a nod or a camera move does not count and a big face does not win by size. A second where no mouth moves clearly, as in a voice-over, names no one.
- **Measured** with `vebench report` on the [synthetic corpus](../bench/README.md#synthetic-corpus) (seed 0, all 8 clips): of the 624 s in which one person on screen talks, the index names that person 90.8 % of the time, someone else 0.45 % and no one 8.8 %; through 210 s of voice-over and off-screen speech it names no one. Drawn faces are easier than real ones, and real footage is not scored.
- **Limits:** a head turned more than about 50 degrees, nearly in profile, is not found, so the camera stays on whoever faces it.
- **Cost:** on the [reference machine](../bench/README.md#reference-machine), 4 to 8 s per source minute from 360p to 1080p, peaking at about 0.4 GB whatever the source's length. Each face on screen adds about 50 KB of boxes to the index per source minute.

## Cloud speech

`--asr cloud` has a speech-to-text model on [OpenRouter](https://openrouter.ai) hear the speech, paid with your own key, for machines without the memory or the time for the local model. Everything else runs on this machine, the aligner that times the words included.

```bash
uv run --env-file ../.env vework analyze talk.mp4 -o talk.index.json --asr cloud
```

- **Off by default:** the local model is the default. It needs no key, costs nothing per minute and sends nothing anywhere.
- **Key:** `OPENROUTER_API_KEY`, from the environment or, with `--env-file ../.env`, from the git-ignored `.env` at the repository root. Before the analysis starts, vework stops with a message if the key is missing, malformed or rejected, or if the model is not a speech-to-text model.
- **What is sent:** each chunk of speech that would go to the local model: at most 30 s of 16 kHz mono audio, compressed as lossless FLAC. Video, the silence between chunks and everything else in the index stay on this machine. OpenRouter passes the audio to the model's provider (DeepInfra for the default model). Requests ask OpenRouter for providers that do not keep or train on it (`data_collection: deny`), and OpenRouter's and the provider's own policies apply.
- **Model:** `qwen/qwen3-asr-1.7b` by default, the model the local default runs with a CUDA GPU; it gives the same text for the same audio every time. `--asr-model` names any other [OpenRouter speech-to-text model](https://openrouter.ai/models?output_modalities=transcription).
- **Same rules as the local model:** the same sentence-sized chunks, each heard in one language, so mixed Mandarin and English is not forced into one. Each chunk takes the language the model names or, when it names none, the language its script shows. Then comes the conversion to Taiwan Traditional Chinese, [correction](#transcript-correction) when asked for, and the aligner, which runs in bfloat16 here to more than halve its memory. `--asr-context` needs the local model, since OpenRouter takes no context prompt.
- **Cost:** progress names the dollars spent so far, and the index's `transcript.cloud` records the model, what OpenRouter charged and the cost per source minute. Only the speech sent is charged, so a source with long silences costs less.
- **Server:** `OPENROUTER_BASE_URL` points vework at another server with OpenRouter's API, such as the stand-in the [desktop app's smoke test](../apps/desktop/README.md#tests) answers with.
- **Failures:** several chunks are in flight at once ([`openrouter.py`](src/vework/openrouter.py) sets how many, the timeout and the tries). A request to a busy or failing server (408, 429, 5xx, a timeout, a dropped connection) is tried again, honouring `Retry-After`. Any other refusal stops the analysis with OpenRouter's reason, such as a key out of credit.

**Measured** with `vebench transcript` on 5 clips of the [synthetic corpus](../bench/README.md#synthetic-corpus): seed 0, `talk-a1` to `a3`, `chat-b1` and `b2`, 11.5 minutes. Wall and CPU times are not comparable between the runs, which shared a loaded host.

| Speech model | MER | CJK / Latin error | Start and end within 50 / 100 ms | Peak memory while transcribing | Cost per hour of source |
|---|---|---|---|---|---|
| Local Qwen3-ASR-0.6B (the CPU default) | 3.71 % | 2.59 / 45.1 % | 66.0 / 92.7 % | 9.7 GB (the whole analysis) | — |
| `qwen/qwen3-asr-1.7b` (default) | 2.97 % | 2.13 / 33.8 % | 65.8 / 92.8 % | 2.9 GB | US$0.024 |
| `elevenlabs/scribe-v2` | 2.04 % | 1.49 / 22.5 % | 66.0 / 92.9 % | 2.9 GB | US$0.098 |

The Latin error rates rest on 71 English words. Scribe v2 does not give the same text for the same audio: run again on `talk-a1`, it dropped a 嗯 and heard a chunk of speech as an audio-event tag, for 4.82 % MER against 2.24 %. On a quiet host, the whole analysis of `talk-a1` (144 s) took 73 s and peaked at 3.3 GB with cloud speech, against 204 s and 9.7 GB with the local model.

**On real speech:** [ASCEND](../bench/README.md#ascend)'s 200-utterance sample (seed 0), 15.8 minutes of conversation in four clips, scored on text only, since ASCEND has no word timings. The 1.7B model and `--correct` ran on the two shortest clips, `ascend-s02` and `-s04` (4.4 minutes).

<!-- results:asr-ascend -->
| Speech model | Clips (reference tokens) | MER | CJK / Latin error | Peak memory, whole analysis |
|---|---|---|---|---|
| Local Qwen3-ASR-0.6B (the CPU default) | all 4 (2,675) | 9.91 % | 6.55 / 25.3 % | 9.6 GB |
| Local Qwen3-ASR-0.6B (the CPU default) | s02, s04 (724) | 11.33 % | 6.87 / 32.3 % | 9.6 GB |
| Local Qwen3-ASR-0.6B with `--correct` | s02, s04 (724) | 11.19 % | 6.70 / 32.3 % | 9.6 GB |
| Local Qwen3-ASR-1.7B (the CUDA GPU default) | s02, s04 (724) | 9.94 % | 6.37 / 26.8 % | 15.2 GB |
<!-- /results -->

## Transcript correction

`--correct` has Claude fix what the speech model misheard (names, terms, homophones) before the aligner times the words, so captions and cuts follow the corrected text. Claude gets one transcribed chunk at a time, with the chunks around it, the video's title (`--title`) and an optional glossary (`--glossary FILE`), and proposes edits with a reason each. `vework analyze --help` names the model.

```bash
uv run --env-file ../.env vework analyze talk.mp4 -o talk.index.json --correct --glossary terms.txt
```

- **Off by default:** it needs a key, costs money and sends text to Anthropic ([what is sent](../SECURITY.md#scope)). Its effect is measured only on two [ASCEND](#cloud-speech) clips.
- **Key:** the Anthropic SDK reads `ANTHROPIC_API_KEY` (or an `ant auth login` profile). `uv run --env-file ../.env` loads it from the git-ignored `.env` at the repository root. Without one, `--correct` fails before the analysis starts.
- **Only safe edits are applied.** vework lines each proposal up with the transcribed text word by word, counting words as vebench does, and rejects any that does more than fix misheard words:
  - A misheard Chinese character is replaced one for one, since each character is a spoken syllable.
  - Two English words the speech model split may merge into one ("and topic" to "Anthropic"), unless one of them is a filler or a repeat.
  - No word changes script: Chinese stays Chinese and English stays English.
  - Nothing else is added or removed: not fillers or repeats, which the editor cuts by their timings, and not symbols that are read out, such as `%` or `$`.
  - A proposal that changes more than a small share of a chunk's words is a rewrite, not a fix.
  - Claude marks each proposal sure or not; a guess is recorded but not applied.

  Proposals are converted to Taiwan Traditional Chinese before they are checked.
- **Everything is recorded.** `corrections` in the index lists every proposal with Claude's reason and, for a rejected one, why it was rejected, so wrong corrections can be found when measuring.
- **Batch:** requests go out right away, several at a time. `--batch` sends them as one [Message Batch](https://platform.claude.com/docs/en/build-with-claude/batch-processing) instead: half the price, but it can take up to 24 hours, for corpus runs and other jobs nobody waits on.
- **Declined chunks:** when Claude declines a chunk, it stays as transcribed and its record says so. No other model is asked.
- **Glossary:** a UTF-8 text file with one name or term per line; blank lines and lines starting with `#` are skipped. `--asr-context` also gives it to Qwen3-ASR as its context prompt, which biases recognition towards those words.

## Taiwan Traditional Chinese

Chinese text is converted to Taiwan Traditional Chinese with OpenCC's `s2twp`, which also swaps mainland words for Taiwan's (视频 to 影片, 软件 to 軟體), and two dictionaries of ours that take precedence over its matches of the same length. [`everyday_s2t.txt`](src/vework/everyday_s2t.txt) fixes characters it picks wrong in everyday speech (很赞 to 很讚, 系安全带 to 繫安全帶, 嘴巴里面 to 嘴巴裡面, 面 to 麵 in some phrases about noodles). [`everyday_tw.txt`](src/vework/everyday_tw.txt) keeps everyday words that its Taiwan phrases turn into computing terms, such as 類型 (not 型別), 項目 (not 專案), 對象 (not 物件) and 支持 (not 支援); longer computing terms such as 資料庫 still convert. A 面 on its own stays 面: only the meaning tells a face from noodles.

Before alignment, a full-width mark that runs into a Latin letter or digit gets a space after it (？OK，Let's to ？ OK， Let's), as the aligner splits words only at spaces and Han characters. After it, Chinese numerals next to a Latin word are written in digits, as a product name or a measure is written: Pocket 三 to Pocket 3, and joined to a unit or a one-letter suffix after them, 四 P to 4P and 六十 mm to 60mm. Numerals elsewhere stay as said.

## Word timings

Qwen3-ForcedAligner times words on an 80 ms grid and gives some characters no duration. A zero-length character first gets the free time beside it or, with none, an even share of a neighboring Han character's time; an English neighbor keeps its own. [`timing.py`](src/vework/timing.py) then reads each edge from the audio level in the grid cell that starts at the reported time:

- **Between two words:** the quietest point in the cell, the dip between their syllables, or the cell's end where the level is still falling there.
- **After a pause:** where the level rises clearly above the pause.
- **Before a pause:** where it falls back; if the sound lasts through the cell, the cell's end.

These moves are only later, and never past their chunk, their Silero speech segment or the next edge, so words keep their order and never overlap. A pause edge stays put where the cell shows no rise or fall, and silence moves nothing.

Then each gap left between two words of a chunk shrinks to its longest stretch of silence, measured against the source's level where Silero hears no speech. Sound on either side goes to the word beside it; a gap with no silence at all closes at its quietest point. The editor cuts in gaps, so this keeps a cut from landing on a word's sound the aligner left in the gap. On the synthetic corpus, 2 of the 379 gaps of at least 0.13 s, the shortest a cut fits in, have cut room (40 ms in from each word) that overlaps a true word.

**Measured** with `vebench report` on the [synthetic corpus](../bench/README.md#synthetic-corpus) (seed 0, all 8 clips, 3,597 timed words). No real speech with word timings checked by ear is available, so these are the only timing numbers; [ASCEND](../bench/README.md#ascend) has no word timings.

| | Start error p50 / p95 | End error p50 / p95 | Start and end within 50 ms | Within 100 ms | MER |
|---|---|---|---|---|---|
| Aligner | 71 / 134 ms | 70 / 137 ms | 9.3 % | 61.9 % | 3.63 % |
| Refined | 24 / 87 ms | 25 / 87 ms | 66.5 % | 93.4 % | 3.63 % |

By kind of edge, on the same aligner output (median error, share within 50 ms), without shrinking the gaps:

| Edges | Count | Aligner | Refined |
|---|---|---|---|
| Between two words | 6,107 | 76 ms, 24 % | 27 ms, 81 % |
| After a pause | 524 | 27 ms, 79 % | 5 ms, 94 % |
| Before a pause | 549 | 34 ms, 66 % | 23 ms, 73 % |

**Limits:** the corpus's speech comes from one TTS model, whose boundary between two words lies a median 75 ms after the aligner's time: inside the cell only 54 % of the time, past it 43 %. Whether people hear a word start at the level's dip or on the rise after it needs a hand-checked corpus of real speech.

## Music

`vework analyze-music` writes a [music index](../packages/schema/music-index.schema.json) for one track you supply, which the planner can then [put under an edit](../packages/engine/README.md#planning). Use only music you have the right to use: your own, or a library's whose licence allows it. The licence is required, recorded in the index, copied into the project and written next to every video that plays the track.

```bash
uv run vework analyze-music song.mp3 -o song.music.json --license "CC BY 4.0" \
  --license-url https://creativecommons.org/licenses/by/4.0/ --attribution "Song by Artist"
```

- **Beats and downbeats:** the [Beat This!](https://github.com/CPJKU/beat_this) model (Foscarin, Schlüter and Widmer, ISMIR 2024), its `final0` checkpoint, run 30 s at a time by [`beats.py`](src/vework/beats.py), which computes the model's input itself. The checkpoint (81 MB, MIT like the code) downloads on first use into torch's hub folder from the authors' file server, or from a copy on `downloads.fineframe.app` when that fails, and is checked against its SHA-256. When neither gives it, the index has the tracker `none`, no beats and one section, and stderr says why. Beats marked in the silence around the music are dropped.
- **Tempo and bars:** one tempo per track, from the beat period most intervals keep, read so that beats the tracker missed in quiet passages or eighth notes it took for beats in busy ones do not double or halve it; it is never faster than 160 BPM when a slower reading holds. Downbeats the model marks inside bars are dropped, so bars keep the length most of the track's bars have. Music whose beats read slower than 40 BPM, such as sustained pads, has no beat: the index then has no beats, downbeats or tempo, one section, and the planner fits the track from its start. [`music.py`](src/vework/music.py) has the rules and their constants.
- **Sections:** each bar is summed up by its mean spectrum, and a downbeat starts a section where the 4 bars after it differ from the 4 before by more than either group differs within itself. A break of a bar or two inside a section starts nothing. Each section has its gated loudness.
- **Loudness:** short-term loudness of every second at 48 kHz, each channel weighed apart as BS.1770 adds them.
- **End:** where the sound last comes within 50 dB of its loudest 50 ms, which is where the edit's last frame lands when the music ends on its own ending.

Times are on the file's own timeline, as the renderer decodes it: a VBR MP3 of a synthetic track decodes sample for sample where its WAV does, in vework and in the renderer.

**Accuracy.** On the [synthetic corpus](../bench/README.md#synthetic-corpus)'s three tracks (96, 112 and 128 BPM, 71 to 77 s, each an intro, a main part and an outro), `vebench beats` finds every beat and downbeat and nothing else (F-measure 1.000 for both), beats a mean 4 to 6 ms and at most 20 ms from the truth, and the tempo within 0.02 %; every section starts within 11 ms of the true one. A VBR MP3 of the 112 BPM track scores the same as its WAV. Real music has no truth to score against, and a track can read at half its tempo, so its beats are every other one. A track of 1 to 5 min takes 9 to 14 s and at most 0.9 GB on the [reference machine](../bench/README.md#reference-machine), including loading the model.
