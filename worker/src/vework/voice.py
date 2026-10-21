import tempfile
from pathlib import Path

import av
import numpy as np
from scipy.signal import butter, sosfilt, stft

from vework import denoise
from vework.audio import load
from vework.loudness import FLOOR, k_weighting

RATE = 48_000  # DeepFilterNet's rate, and the renderer's
BLOCK = 480  # 10 ms: the resolution every measurement below is built from
CHUNK = 6_000  # blocks filtered at a time, so a long source needs no full-length copy
# A 50 ms window counts as room tone when no speech is within this many blocks of it: Silero's
# segments stop at the speech's edge, and breaths and decays sit just outside.
ROOM_GAP = 20
ROOM_WINDOW = 5
ROOM_MIN = 20  # windows: under 1 s of room tone gives no noise floor
SILENCE_DB = -120.0  # digital silence, which has no level in decibels
CLIPPED = 10 ** (-0.1 / 20)  # within 0.1 dB of full scale
# Reverberation is read from how the 500 Hz-4 kHz level falls after each stretch of speech that
# a pause of at least DECAY_PAUSE follows.
DECAY_BAND = (500.0, 4_000.0)
DECAY_PAUSE = 0.3
DECAY_SEARCH = 15  # blocks before a segment's end where its last syllable peaks
DECAY_TOP = 5.0  # dB below the peak where the fitted fall starts, past the syllable's own end
DECAY_DEPTH = 35.0  # dB below the peak where it stops, or 10 dB above the room
DECAY_MIN = 5  # measurable falls needed for an estimate
# The long-term average spectrum of speech, in bands an equaliser acts on.
BODY = (500.0, 2_000.0)
MUD = (150.0, 500.0)
PRESENCE = (2_000.0, 5_000.0)


def measure(samples: np.ndarray, speech: list[dict]) -> dict:
    """How 48 kHz mono speech sounds, as the engine chooses its voice processing from; clipping
    is counted on the channels before the mix (`Clipping`). `speech` holds the stretches of
    speech in seconds."""
    blocks = len(samples) // BLOCK
    talking = _mask(speech, blocks)
    power, weighted, band = _block_powers(samples[: blocks * BLOCK])
    return {
        "noise_floor_db": _noise_floor(power, talking),
        "speech_lufs": _speech_loudness(weighted, talking),
        "loudness_range_lu": _loudness_range(weighted),
        "rt60": _rt60(band, speech, blocks),
        **_balance(samples, talking),
    }


class Clipping:
    """Counts the instants at which any channel is within 0.1 dB of full scale, frame by frame
    as decoded: a channel clipped beside a quiet one never nears full scale in their mix."""

    def __init__(self) -> None:
        self.hits = self.total = 0

    def __call__(self, frame: av.AudioFrame) -> None:
        data = frame.to_ndarray()
        if not frame.format.is_planar:
            data = data.reshape(-1, len(frame.layout.channels)).T
        top = 1.0
        if data.dtype.kind in "iu":
            # Unsigned samples centre on the middle of their range.
            info = np.iinfo(data.dtype)
            middle = (int(info.max) + int(info.min) + 1) // 2
            data, top = data.astype(np.int64) - middle, info.max - middle
        self.hits += int(np.count_nonzero((np.abs(data) >= top * CLIPPED).any(axis=0)))
        self.total += data.shape[1]

    @property
    def share(self) -> float:
        return round(self.hits / self.total, 6) if self.total else 0.0


def _mask(speech: list[dict], blocks: int) -> np.ndarray:
    """Which 10 ms blocks have their centre inside speech."""
    centres = (np.arange(blocks) + 0.5) * BLOCK / RATE
    inside = np.zeros(blocks, bool)
    for segment in speech:
        inside |= (centres >= segment["start"]) & (centres < segment["end"])
    return inside


def _block_powers(samples: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Mean square per block: as recorded (DC removed), K-weighted, and in the decay band."""
    # DC offset from a cheap converter would read as a noise floor.
    dc = butter(2, 20.0, "highpass", fs=RATE, output="sos")
    band = butter(4, DECAY_BAND, "bandpass", fs=RATE, output="sos")
    filters = [dc, k_weighting(RATE), band]
    states = [np.zeros((len(sos), 2)) for sos in filters]
    out: list[list[np.ndarray]] = [[], [], []]
    for lo in range(0, len(samples), BLOCK * CHUNK):
        chunk = samples[lo : lo + BLOCK * CHUNK].astype(np.float64)
        for i, sos in enumerate(filters):
            filtered, states[i] = sosfilt(sos, chunk, zi=states[i])
            out[i].append((filtered.reshape(-1, BLOCK) ** 2).mean(axis=1))
    return tuple(np.concatenate(o) if o else np.zeros(0) for o in out)


def _db(power: np.ndarray | float) -> np.ndarray:
    with np.errstate(divide="ignore"):
        return np.maximum(10 * np.log10(power), SILENCE_DB)


def _noise_floor(power: np.ndarray, talking: np.ndarray) -> float | None:
    """Median level of the 50 ms windows far enough from speech to hold only the room."""
    count = np.concatenate([[0], np.cumsum(np.pad(talking, ROOM_GAP))])
    near = count[2 * ROOM_GAP + 1 :] - count[: -2 * ROOM_GAP - 1] > 0
    windows = len(power) // ROOM_WINDOW
    shape = (windows, ROOM_WINDOW)
    clear = ~near[: windows * ROOM_WINDOW].reshape(shape).any(axis=1)
    if clear.sum() < ROOM_MIN:
        return None
    level = power[: windows * ROOM_WINDOW].reshape(shape).mean(axis=1)[clear]
    return round(float(_db(np.median(level))), 1)


def _lufs(weighted: np.ndarray, size: int) -> tuple[np.ndarray, np.ndarray]:
    """Loudness of every window of `size` blocks, one starting every 100 ms, and the first
    block of each."""
    total = np.concatenate([[0.0], np.cumsum(weighted)])
    starts = np.arange(0, max(len(weighted) - size, 0) + 1, 10)
    ends = np.minimum(starts + size, len(weighted))
    mean = (total[ends] - total[starts]) / np.maximum(ends - starts, 1)
    return -0.691 + _db(mean), starts


def _gated(level: np.ndarray, relative: float) -> np.ndarray:
    """BS.1770's two gates: absolute at -70 LUFS, then `relative` LU under what passed it."""
    level = level[level > FLOOR]
    if not len(level):
        return level
    mean = 10 * np.log10(np.mean(10 ** (level / 10)))
    return level[level > mean + relative]


def _speech_loudness(weighted: np.ndarray, talking: np.ndarray) -> float:
    """Integrated loudness of the 400 ms blocks centred in speech."""
    level, starts = _lufs(weighted, 40)
    centres = np.minimum(starts + 20, len(talking) - 1)
    kept = _gated(level[talking[centres]] if len(talking) else level[:0], -10.0)
    if not len(kept):
        return FLOOR
    return round(float(max(10 * np.log10(np.mean(10 ** (kept / 10))), FLOOR)), 1)


def _loudness_range(weighted: np.ndarray) -> float:
    """EBU Tech 3342: the spread of 3 s loudness between its 10th and 95th percentiles."""
    level, _ = _lufs(weighted, 300)
    kept = _gated(level, -20.0)
    if not len(kept):
        return 0.0
    return round(float(np.percentile(kept, 95) - np.percentile(kept, 10)), 1)


def _rt60(band: np.ndarray, speech: list[dict], blocks: int) -> float | None:
    """Reverberation time from how fast the level falls after speech stops.

    A room cannot let sound die away faster than its own decay, so the steepest falls after
    stretches of speech are the room's; speech that fades out by itself only falls slower.
    """
    # Each block averaged with the one before: a fall shows as a slope, not a single step.
    level = _db(np.concatenate([band[:1], (band[1:] + band[:-1]) / 2]))
    pauses = level[~_mask(speech, blocks)]
    room = np.median(pauses) if len(pauses) else SILENCE_DB
    found = []
    for segment, after in zip(speech, [*speech[1:], None], strict=True):
        end = round(segment["end"] * RATE / BLOCK)
        pause_end = round(after["start"] * RATE / BLOCK) if after else blocks
        if pause_end - end < DECAY_PAUSE * RATE / BLOCK or end - DECAY_SEARCH < 0:
            continue
        peak = end - DECAY_SEARCH + int(np.argmax(level[end - DECAY_SEARCH : end + 5]))
        fall = level[peak:pause_end]
        # Until the level turns back up: a breath, a click or the next word.
        rising = np.flatnonzero(fall > np.minimum.accumulate(fall) + 3)
        fall = fall[: rising[0] if len(rising) else len(fall)]
        top = fall[0] - DECAY_TOP
        bottom = max(fall[0] - DECAY_DEPTH, room + 10)
        if fall[0] - bottom < 15 or not (fall <= bottom).any():
            continue
        first, last = int(np.argmax(fall <= top)), int(np.argmax(fall <= bottom))
        if last - first >= 2:
            # A line through the whole fall, which rides over a reverberant tail's ripples.
            slope = np.polyfit(np.arange(first, last + 1), fall[first : last + 1], 1)[0]
        else:
            # Faster than a few blocks: the fall between the blocks either side of the range.
            slope = (fall[last] - fall[first - 1]) / (last - first + 1)
        found.append(-60 / slope * BLOCK / RATE)
    if len(found) < DECAY_MIN:
        return None
    return round(float(np.percentile(found, 20)), 2)


def _balance(samples: np.ndarray, talking: np.ndarray) -> dict:
    """Low-mids and presence against the body of the voice, in the average spectrum of speech."""
    size = 2048
    totals, frames = np.zeros(size // 2 + 1), 0
    step = BLOCK * CHUNK
    for lo in range(0, len(samples), step):
        chunk = samples[lo : lo + step]
        if len(chunk) < size:
            break
        freqs, times, spectrum = stft(chunk, RATE, nperseg=size, noverlap=size // 2,
                                      boundary=None, padded=False)  # fmt: skip
        centre = ((lo + times * RATE) // BLOCK).astype(int)
        inside = talking[np.minimum(centre, len(talking) - 1)]
        totals += (np.abs(spectrum[:, inside]) ** 2).sum(axis=1)
        frames += int(inside.sum())

    def level(band: tuple[float, float]) -> float:
        span = (freqs >= band[0]) & (freqs < band[1])
        return float(_db(totals[span].sum()))

    if not frames or totals[(freqs >= BODY[0]) & (freqs < BODY[1])].sum() == 0:
        return {"mud_db": None, "presence_db": None}
    body = level(BODY)
    return {
        "mud_db": round(level(MUD) - body, 1),
        "presence_db": round(level(PRESENCE) - body, 1),
    }


def write_stem(path: Path, recorded: np.ndarray, denoised: np.ndarray) -> None:
    """Write 48 kHz mono float speech as a two-channel WAV file the renderer reads sample for
    sample: the recording, then its denoised copy."""
    # RF64: a plain WAV's sizes wrap at 4 GiB, about 3 hours of two channels, and reads stop
    # short there.
    with av.open(str(path), "w", format="wav", container_options={"rf64": "always"}) as container:
        stream = container.add_stream("pcm_f32le", rate=RATE, layout="stereo")
        for lo in range(0, len(recorded), RATE):
            both = np.stack([recorded[lo : lo + RATE], denoised[lo : lo + RATE]], axis=1)
            frame = av.AudioFrame.from_ndarray(
                np.ascontiguousarray(both.reshape(1, -1)), format="flt", layout="stereo"
            )
            frame.sample_rate = RATE
            for packet in stream.encode(frame):
                container.mux(packet)
        for packet in stream.encode(None):
            container.mux(packet)


def analyze(path: Path, speech: list[dict], stem: Path) -> dict:
    """Measure the first audio track's speech, remove its noise, and measure that. `stem` gets
    the recording beside its denoised copy: the renderer mixes the two by the chain's limit, and
    only one decode lines them up, since decoders differ in the codec priming they drop."""
    clipping = Clipping()
    samples = load(path, rate=RATE, each=clipping)
    recorded = measure(samples, speech)
    # The recording waits on disk while it is denoised in place: two hours at 48 kHz are 1.4 GB.
    with tempfile.TemporaryFile(dir=stem.parent) as spill:
        samples.tofile(spill)
        cleaned = denoise.enhance(samples, in_place=True)
        write_stem(stem, np.memmap(spill, np.float32, "r", shape=cleaned.shape), cleaned)
    # Denoising does not undo clipping, so the denoised speech carries the recording's.
    clipped = {"clipped_share": clipping.share}
    return {
        "stem": stem.name,
        "model": denoise.MODEL,
        "recorded": {**recorded, **clipped},
        "denoised": {**measure(cleaned, speech), **clipped},
    }
