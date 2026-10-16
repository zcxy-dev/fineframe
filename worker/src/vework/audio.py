from collections.abc import Callable, Sequence
from pathlib import Path

import av
import numpy as np

from vework.probe import start_time

RATE = 16_000  # what the speech models expect
# The channels FFmpeg's command line takes a stream's to be when the file does not name them, as
# Matroska PCM can: its first standard layout with as many.
GUESSED = {1: "mono", 2: "stereo", 3: "2.1", 4: "4.0", 5: "5.0", 6: "5.1", 7: "6.1", 8: "7.1"}


class Track:
    """Decoded audio resampled to `rate`, placed on the file's timeline and handed to `sink` as it
    comes: float32 with one column per channel, and the channels' names (FFmpeg's guess where
    the file names none).

    `layout` is the channels to mix to, by FFmpeg's name; None keeps the first frame's channels.
    Sample positions are timeline positions: a track that starts after the picture, or skips
    ahead in its timestamps, gets silence in between; audio that jumps back over time already
    placed is dropped.
    """

    def __init__(
        self,
        sink: Callable[[np.ndarray, list[str]], None],
        rate: int = RATE,
        layout: str | av.AudioLayout | None = "mono",
    ) -> None:
        self.sink, self.rate, self.layout = sink, rate, layout
        self.resampler, self.source, self.names = None, None, []
        self.length = self.skip = 0  # in samples per channel
        # The first timed frame goes exactly where its timestamp says, as the renderer places it.
        self.tolerance = 0

    def place(self, frame: av.AudioFrame, zero: float) -> None:
        # A resampler is fixed to its input format; streams can switch mid-file
        # (mono to stereo across a broadcast break, for example).
        if (frame.format.name, frame.layout.name, frame.sample_rate) != self.source:
            self.flush()
            if not self.names:
                self.layout = self.layout or frame.layout
                self.names = [c.name for c in av.AudioLayout(self.layout).channels]
                if set(self.names) == {"NONE"} and len(self.names) in GUESSED:
                    guess = av.AudioLayout(GUESSED[len(self.names)])
                    self.names = [c.name for c in guess.channels]
            self.resampler = av.AudioResampler(format="flt", layout=self.layout, rate=self.rate)
            self.source = (frame.format.name, frame.layout.name, frame.sample_rate)
        if frame.time is not None:
            gap = round((frame.time - zero) * self.rate) - self.length
            # After that, ignore jitter under 20 ms; anything longer is a real hole in the
            # track, or audio that claims time already filled.
            if gap > self.tolerance:
                self.sink(np.zeros((gap, len(self.names)), np.float32), self.names)
                self.length += gap
            # Each timed frame says afresh how much of it is already covered; a stale count
            # would silence the audio that follows a brief jump back.
            self.skip = -gap if gap < -self.tolerance else 0
            self.tolerance = self.rate // 50
        self._emit(self.resampler.resample(frame))

    def flush(self) -> None:
        if self.resampler is not None:
            self._emit(self.resampler.resample(None))

    def _emit(self, frames: list[av.AudioFrame]) -> None:
        for out in frames:
            data = out.to_ndarray()[0].reshape(-1, len(self.names))  # packed: interleaved
            # Samples whose time is already covered are dropped, keeping later audio in place.
            dropped = min(self.skip, len(data))
            self.skip -= dropped
            if dropped < len(data):
                self.sink(data[dropped:], self.names)
                self.length += len(data) - dropped


def load(
    path: Path,
    stream: int = 0,
    rate: int = RATE,
    channels: int = 1,
    each: Callable[[av.AudioFrame], None] | None = None,
    tracks: Sequence[Track] = (),
) -> np.ndarray:
    """Decode one audio stream to float32 at `rate`, placed on the file's timeline as a `Track`
    places it.

    Mono by default; `channels=2` gives stereo as one column per channel. `each` sees every
    decoded frame as it is, before the mix; `tracks` get the same decode too.
    """
    # One buffer that grows in place: two hours is 460 MB, and joining decoded pieces at the end
    # would hold it twice.
    pcm = bytearray()
    main = Track(lambda data, names: pcm.extend(data), rate, "mono" if channels == 1 else "stereo")
    with av.open(str(path)) as container:
        zero = start_time(container)
        for frame in container.decode(container.streams.audio[stream]):
            if each is not None:
                each(frame)
            for track in (main, *tracks):
                track.place(frame, zero)
        for track in (main, *tracks):
            track.flush()
    samples = np.frombuffer(pcm, np.float32)
    return samples if channels == 1 else samples.reshape(-1, channels)
