# Generated from packages/schema/media-index.schema.json by `pnpm gen`; do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel


class VideoStream(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    width: Annotated[
        int,
        Field(
            description="Pixels, upright: phone footage stored landscape with a 90° display matrix reports portrait. Pixels that are not square are counted as stored; `sample_aspect` gives their shape.",
            ge=0,
        ),
    ]
    height: Annotated[int, Field(description="Pixels, upright, like `width`.", ge=0)]
    sample_aspect: Annotated[
        float | None,
        Field(
            description="The shape of one pixel as displayed, its width over its height: 1 for square pixels, 4/3 for HDV's 1440 × 1080 shown as 16:9. The picture's shape is width × sample_aspect / height. Absent in indexes written before vework recorded it.",
            gt=0.0,
        ),
    ] = None
    fps: Annotated[
        float, Field(description="Average frame rate; 0 when the stream states none.", ge=0.0)
    ]
    rotation: Annotated[
        int, Field(description="Degrees counter-clockwise from the display matrix.", ge=0, le=359)
    ]
    codec: Annotated[str, Field(description="FFmpeg's codec name, e.g. h264.")]
    transfer: Annotated[
        int | None,
        Field(
            description="The transfer characteristics the stream is tagged with, as an ITU-T H.273 code point: 1 BT.709, 16 PQ (HDR10), 18 HLG; null when untagged. Absent in indexes written before vework recorded it.",
            ge=0,
        ),
    ] = None
    matrix: Annotated[
        int | None,
        Field(
            description="The matrix coefficients the stream is tagged with, as an ITU-T H.273 code point: 1 BT.709, 5 and 6 BT.601, 9 BT.2020; null when untagged. Absent in indexes written before vework recorded it.",
            ge=0,
        ),
    ] = None


class AudioStream(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    index: Annotated[int, Field(description="Position among the file's audio streams.", ge=0)]
    channels: Annotated[int, Field(ge=0)]
    sample_rate: Annotated[int, Field(ge=0)]
    language: Annotated[
        str | None,
        Field(
            description="The container's language tag as written (often ISO 639-2, e.g. eng or und), or null."
        ),
    ]


class ShotTransition(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    start: Annotated[float, Field(ge=0.0)]
    end: Annotated[float, Field(ge=0.0)]


class SpeechSegment(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    start: Annotated[float, Field(ge=0.0)]
    end: Annotated[float, Field(ge=0.0)]


class Cloud(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    model: Annotated[str, Field(description="The OpenRouter model slug.")]
    cost: Annotated[
        float, Field(description="US dollars OpenRouter charged for the transcription.", ge=0.0)
    ]
    cost_per_minute: Annotated[
        float, Field(description="The cost per minute of the source's audio track.", ge=0.0)
    ]


class Correction(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    start: Annotated[
        float, Field(description="Start of the transcribed chunk the change is in.", ge=0.0)
    ]
    end: Annotated[float, Field(description="End of that chunk.", ge=0.0)]
    original: Annotated[
        str, Field(description="The transcribed text Claude quoted for the change.")
    ]
    corrected: Annotated[
        str,
        Field(description="What Claude proposed instead, converted to Taiwan Traditional Chinese."),
    ]
    reason: Annotated[str, Field(description="Claude's reason for the change.")]
    rejected: Annotated[
        str | None, Field(description="Why vework did not apply the change, or null when it did.")
    ]


class Lufs(RootModel[float]):
    root: Annotated[
        float,
        Field(
            description="Loudness units relative to full scale, to 0.1. -70, BS.1770's absolute gate, is the floor: silence or anything quieter.",
            ge=-70.0,
        ),
    ]


class AudioEvent(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    kind: Annotated[
        Literal["laughter", "applause", "music"],
        Field(
            description="laughter: any kind of laugh. applause: applause, clapping or cheering. music: any music, also under speech."
        ),
    ]
    start: Annotated[float, Field(ge=0.0)]
    end: Annotated[float, Field(ge=0.0)]
    confidence: Annotated[
        float,
        Field(
            description="The highest probability the tagger gave this kind inside the stretch, 0 to 1.",
            ge=0.0,
            le=1.0,
        ),
    ]


class FaceBox(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    t: Annotated[float, Field(description="The sample's time.", ge=0.0)]
    x: Annotated[float, Field(ge=0.0, le=1.0)]
    y: Annotated[float, Field(ge=0.0, le=1.0)]
    w: Annotated[float, Field(gt=0.0, le=1.0)]
    h: Annotated[float, Field(gt=0.0, le=1.0)]


class SpeakerSpan(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    face: Annotated[int, Field(description="The id of the face that speaks.", ge=0)]
    start: Annotated[float, Field(ge=0.0)]
    end: Annotated[float, Field(ge=0.0)]


class VoiceLevels(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    noise_floor_db: Annotated[
        float | None,
        Field(
            description="The room between words: the median RMS level, in dB FS, of the 50 ms windows at least 0.2 s from speech. Null with less than 1 s of them. -120 is digital silence.",
            ge=-120.0,
        ),
    ]
    speech_lufs: Annotated[
        float,
        Field(
            description="Integrated loudness of the speech: BS.1770 with its gates, over the 400 ms windows centred in speech. -70 when they are all quieter than that.",
            ge=-70.0,
        ),
    ]
    loudness_range_lu: Annotated[
        float,
        Field(
            description="EBU Tech 3342 loudness range of the whole track: how far its loud and quiet stretches lie apart. Uneven levels read high.",
            ge=0.0,
        ),
    ]
    clipped_share: Annotated[
        float,
        Field(
            description="The share of the track's sample instants at which any channel is within 0.1 dB of full scale, counted as decoded, before the mono mix. Denoising does not undo clipping, so the denoised speech repeats the recording's figure.",
            ge=0.0,
            le=1.0,
        ),
    ]
    rt60: Annotated[
        float | None,
        Field(
            description="Reverberation time, seconds: how long the room takes to fall 60 dB, read from the steepest falls of the 500 Hz–4 kHz level after stretches of speech that a pause follows (worker/README.md#voice has its accuracy). Null with fewer than five falls 15 dB clear of the noise.",
            ge=0.0,
        ),
    ]
    mud_db: Annotated[
        float | None,
        Field(
            description="The 150–500 Hz band against the 500 Hz–2 kHz band of the speech's average spectrum, in dB: a boomy or boxy voice reads high. Null without speech energy there."
        ),
    ]
    presence_db: Annotated[
        float | None,
        Field(
            description="The 2–5 kHz band against the 500 Hz–2 kHz band, in dB: a dull or muffled voice reads low."
        ),
    ]


class Word(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    text: Annotated[str, Field(min_length=1)]
    start: Annotated[float, Field(ge=0.0)]
    end: Annotated[float, Field(ge=0.0)]


class SourceInfo(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    name: Annotated[str, Field(description="The file name, without its folder.")]
    duration: Annotated[
        float, Field(description="Seconds, as the container states it; 0 when it does not.", ge=0.0)
    ]
    start: Annotated[
        float | None,
        Field(
            description="The file's time zero, which every other time in the index counts from, as a container timestamp in seconds: where vework's decoder starts the file, which other decoders can place elsewhere. Absent in indexes written before vework recorded it."
        ),
    ] = None
    video: Annotated[
        VideoStream | None,
        Field(description="The first video stream that is footage (cover art is not), or null."),
    ]
    audio: Annotated[list[AudioStream], Field(description="Every audio stream, in file order.")]


class Transcript(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    language: Annotated[
        str | None,
        Field(
            description="BCP 47 code of the language spoken longest (und when unknown), or null without speech.",
            pattern="^[a-z]{2,3}(-[A-Za-z0-9]{1,8})*$",
        ),
    ]
    text: Annotated[
        str, Field(description="The transcript as written, one line per transcribed chunk.")
    ]
    words: Annotated[
        list[Word],
        Field(
            description="In time order: one word per Han character or English word, carrying the punctuation next to it."
        ),
    ]
    cloud: Annotated[
        Cloud | None,
        Field(
            description="Present when the speech was heard on OpenRouter (`vework analyze --asr cloud`) rather than by the local speech model; the words are still timed locally."
        ),
    ] = None


class Loudness(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    momentary: Annotated[
        list[Lufs],
        Field(
            description="The loudest 400 ms window inside each second, at 100 ms steps: short peaks such as a laugh, a shout or a hit."
        ),
    ]
    short_term: Annotated[
        list[Lufs],
        Field(
            description="The 3 s window centred on each second, shifted inward at the ends of the audio: sustained energy."
        ),
    ]


class FaceTrack(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    id: Annotated[
        int,
        Field(
            description="Unique in the index, so speaker spans can name the face. The same person in another shot has another id.",
            ge=0,
        ),
    ]
    boxes: Annotated[
        list[FaceBox],
        Field(
            description="The face in each sample it was found in, in time order. Samples where the detector missed it are left out.",
            min_length=1,
        ),
    ]


class Voice(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    stem: Annotated[
        str,
        Field(
            description="The recording beside its denoised speech: the name of a 48 kHz two-channel 32-bit float WAV in the index's folder. Channel 0 is the track's mono mix as measured here, channel 1 the same with its noise removed in full. Both come from one decode, so they line up sample for sample, which two decoders need not do: they differ in the codec priming they drop. Its sample 0 is the source's time zero, and it runs as long as the track. The renderer plays it instead of the track, mixing the recording back in to limit how far noise is lowered.",
            pattern="^[^/\\\\]*[^/\\\\.][^/\\\\]*$",
        ),
    ]
    model: Annotated[
        Literal["DeepFilterNet3"],
        Field(description="The denoiser: DeepFilterNet3, run with ONNX Runtime."),
    ]
    recorded: VoiceLevels
    denoised: VoiceLevels


class FramedShot(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    start: Annotated[float, Field(ge=0.0)]
    end: Annotated[float, Field(ge=0.0)]
    layout: Annotated[
        Literal["talking_head", "two_shot", "group", "screen_cam", "screen"],
        Field(
            description="talking_head: one person on camera. two_shot: two people of similar size side by side. group: more than two people on camera. screen_cam: no one on camera but a small face in a corner, such as a webcam over a screen recording. screen: no face that counts."
        ),
    ]
    faces: Annotated[
        list[FaceTrack],
        Field(description="Every face seen in enough of the shot to count, in order of id."),
    ]
    speakers: Annotated[
        list[SpeakerSpan],
        Field(
            description="Who speaks when, in time order and not overlapping. Speech while no face on screen moves its mouth, such as a voice-over, has no span."
        ),
    ]


class FaceFraming(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    fps: Annotated[
        float,
        Field(
            description="Frames sampled per second. Each sample is the frame on screen at its time.",
            gt=0.0,
        ),
    ]
    shots: Annotated[
        list[FramedShot],
        Field(
            description="Back to back from 0 to the end of the picture, in time order, split at each transition: a hard cut's time, a dissolve's middle."
        ),
    ]


class MediaIndex(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
    )
    version: Literal[1]
    source: SourceInfo
    transitions: Annotated[
        list[ShotTransition],
        Field(description="Shot transitions found by TransNetV2, in time order."),
    ]
    speech: Annotated[
        list[SpeechSegment],
        Field(
            description="Stretches of speech found by Silero VAD on the first audio track, in time order. The gaps between them are pauses."
        ),
    ]
    transcript: Transcript
    corrections: Annotated[
        list[Correction] | None,
        Field(
            description="Present when Claude corrected the transcript before alignment (`vework analyze --correct`): every change it proposed, applied or rejected, in time order. The transcript holds the result."
        ),
    ] = None
    loudness: Loudness | None = None
    audio_events: Annotated[
        list[AudioEvent] | None,
        Field(
            description="Laughter, applause and music on the first audio track, found by the CED-Base AudioSet tagger, in order of start. Kinds can overlap: applause over music, music under speech. Empty without audio."
        ),
    ] = None
    framing: FaceFraming | None = None
    voice: Voice | None = None
