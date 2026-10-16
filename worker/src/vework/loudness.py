# The K-weighting coefficients are analog prototypes fitted to ITU-R BS.1770's 48 kHz filter.

import numpy as np
from scipy.signal import sosfilt

from vework.audio import RATE

FLOOR = -70.0  # BS.1770's absolute gate: anything quieter counts as silence
BLOCK = 0.1  # EBU Tech 3341 meters update every 100 ms
MOMENTARY = 4  # blocks: 400 ms
SHORT_TERM = 30  # blocks: 3 s
CHUNK = 600  # blocks filtered at a time, so a long source needs no full-length copy


def k_weighting(rate: int) -> np.ndarray:
    """BS.1770's K-weighting filter at `rate`, as second-order sections.

    The standard gives coefficients for 48 kHz only. These are its analog prototypes mapped to
    `rate` by the bilinear transform, so 48 kHz reproduces the standard's values.
    """
    # A +4 dB shelf above about 1.7 kHz: the acoustic effect of the head.
    f0, gain, q = 1681.974450955533, 3.999843853973347, 0.7071752369554196
    k = np.tan(np.pi * f0 / rate)
    vh = 10 ** (gain / 20)
    vb = vh**0.4996667741545416
    a0 = 1 + k / q + k * k
    shelf = [
        (vh + vb * k / q + k * k) / a0,
        2 * (k * k - vh) / a0,
        (vh - vb * k / q + k * k) / a0,
        1.0,
        2 * (k * k - 1) / a0,
        (1 - k / q + k * k) / a0,
    ]
    # A high-pass at about 38 Hz: low rumble adds little to how loud speech or music sounds.
    f0, q = 38.13547087602444, 0.5003270373238773
    k = np.tan(np.pi * f0 / rate)
    a0 = 1 + k / q + k * k
    highpass = [1.0, -2.0, 1.0, 1.0, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0]
    return np.array([shelf, highpass])


# BS.1770 weighs surround channels 1.41 and leaves out low-frequency effects, as FFmpeg's ebur128
# filter does for FFmpeg's channel names.
SURROUND = {"BL", "BC", "BR", "SL", "SR", "TBL", "TBC", "TBR", "SDL", "SDR"}
EFFECTS = {"LFE", "LFE2", "LFE3"}


class Meter:
    """EBU R128 momentary and short-term loudness of audio fed to it piece by piece, holding only
    one value per 100 ms. `add` takes the shape and channel names a `vework.audio.Track` hands
    on; `result` returns what `measure` describes."""

    def __init__(self, rate: int = RATE) -> None:
        self.rate, self.block = rate, round(rate * BLOCK)
        self.sos, self.state = k_weighting(rate), None
        self.pending: list[np.ndarray] = []
        self.held = 0
        self.energy: list[np.ndarray] = []
        self.count: list[np.ndarray] = []
        self.weights = np.ones(1)

    def add(self, samples: np.ndarray, channels: list[str] | None = None) -> None:
        columns = samples.reshape(len(samples), -1)
        if self.state is None:
            names = channels or [""] * columns.shape[1]
            self.weights = np.array(
                [0.0 if n in EFFECTS else 1.41 if n in SURROUND else 1.0 for n in names]
            )
            self.state = np.zeros((2, 2, columns.shape[1]))
        self.pending.append(columns)
        self.held += len(columns)
        if self.held >= self.block * CHUNK:
            self._filter(self.held - self.held % self.block)

    def result(self) -> dict:
        if self.held:
            self._filter(self.held)  # the last block can be short
        if not self.energy:
            return {"momentary": [], "short_term": []}
        seconds = -(-int(sum(c.sum() for c in self.count)) // self.rate)
        # Mean square per 100 ms block, as running sums so any run of blocks averages in O(1).
        total = np.concatenate([[0.0], np.cumsum(np.concatenate(self.energy))])
        samples_in = np.concatenate([[0], np.cumsum(np.concatenate(self.count))])
        blocks = len(total) - 1

        def lufs(first: np.ndarray, size: int) -> np.ndarray:
            start = np.clip(first, 0, max(blocks - size, 0))
            end = np.minimum(start + size, blocks)
            mean_square = (total[end] - total[start]) / (samples_in[end] - samples_in[start])
            with np.errstate(divide="ignore"):
                level = -0.691 + 10 * np.log10(mean_square)
            return np.round(np.maximum(level, FLOOR), 1)

        per_second = round(1 / BLOCK)
        first = np.arange(seconds) * per_second
        starts = first[:, None] + np.arange(per_second - MOMENTARY + 1)
        momentary = lufs(starts, MOMENTARY).max(axis=1)
        short_term = lufs(first + (per_second - SHORT_TERM) // 2, SHORT_TERM)
        return {"momentary": momentary.tolist(), "short_term": short_term.tolist()}

    def _filter(self, length: int) -> None:
        """K-weigh the first `length` samples held and add up their weighted energy per block."""
        held = np.concatenate(self.pending)
        self.pending, self.held = [held[length:]], len(held) - length
        filtered, self.state = sosfilt(self.sos, held[:length], axis=0, zi=self.state)
        starts = np.arange(0, length, self.block)
        self.energy.append(np.add.reduceat(filtered**2 @ self.weights, starts))
        self.count.append(np.diff(starts, append=length))


def measure(samples: np.ndarray, rate: int = RATE) -> dict:
    """EBU R128 momentary and short-term loudness, one value per second, in LUFS.

    `samples` is mono, or one column per channel, whose energies add as BS.1770 sums the front
    channels. Second i covers [i, i + 1); a final partial second gets a value too. `momentary`
    is the loudest 400 ms window inside the second, at 100 ms steps; `short_term` is the 3 s
    window centred on it. Windows stay inside the audio, shifting inward near its ends; audio
    shorter than a window is measured whole.
    """
    meter, step = Meter(rate), round(rate * BLOCK) * CHUNK
    for lo in range(0, len(samples), step):
        meter.add(samples[lo : lo + step])
    return meter.result()
