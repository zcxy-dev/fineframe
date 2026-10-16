from dataclasses import dataclass
from pathlib import Path

import av


@dataclass(frozen=True)
class VideoInfo:
    width: int  # pixels upright, after rotation, as stored when not square
    height: int
    sample_aspect: float  # a pixel's width over its height as displayed; 1.0 when square
    fps: float
    rotation: int  # degrees counter-clockwise from the display matrix
    codec: str
    transfer: int | None  # ITU-T H.273 transfer characteristics; None when untagged
    matrix: int | None  # ITU-T H.273 matrix coefficients; None when untagged


@dataclass(frozen=True)
class AudioInfo:
    index: int  # position among the file's audio streams
    channels: int
    sample_rate: int
    language: str | None


@dataclass(frozen=True)
class MediaInfo:
    duration: float
    start: float  # the container timestamp that is time zero; see start_time
    video: VideoInfo | None
    audio: list[AudioInfo]


def probe(path: Path) -> MediaInfo:
    """Describe a media file. Decodes one video frame to read its rotation; `duration` is 0.0
    when the container does not state it."""
    with av.open(str(path)) as container:
        video = None
        stream = video_stream(container)
        if stream is not None:
            # Phones store portrait footage as landscape plus a display matrix, which PyAV
            # exposes only on decoded frames.
            frame = next(container.decode(stream), None)
            rotation = round(frame.rotation) % 360 if frame else 0
            width, height = stream.codec_context.width, stream.codec_context.height
            # FFmpeg's guess, as the renderer's filters see it; 0 means unknown, read as square.
            sar = stream.sample_aspect_ratio
            sample_aspect = float(sar) if sar else 1.0
            if rotation in (90, 270):
                width, height = height, width
                sample_aspect = 1 / sample_aspect
            fps = float(stream.average_rate or stream.guessed_rate or 0)
            # The renderer tone-maps PQ and HLG footage by the transfer, and reads untagged
            # footage with the matrix players assume; 2 is H.273's "unspecified" for both.
            context = stream.codec_context
            transfer = context.color_trc if context.color_trc != 2 else None
            matrix = context.colorspace if context.colorspace != 2 else None
            video = VideoInfo(
                width, height, sample_aspect, fps, rotation, context.name, transfer, matrix
            )
        audio = [
            AudioInfo(i, s.codec_context.channels, s.codec_context.sample_rate,
                      s.metadata.get("language"))
            for i, s in enumerate(container.streams.audio)
        ]  # fmt: skip
        duration = container.duration / av.time_base if container.duration else 0.0
        start = start_time(container)
    return MediaInfo(duration, start, video, audio)


def start_time(container: av.container.InputContainer) -> float:
    """The file's time zero: every time in the media index is relative to it."""
    return container.start_time / av.time_base if container.start_time else 0.0


def video_stream(container: av.container.InputContainer) -> av.VideoStream | None:
    """The first real video stream: cover art in audio files is a still, not footage."""
    return next(
        (
            s
            for s in container.streams.video
            if av.stream.Disposition.attached_pic not in s.disposition
        ),
        None,
    )
