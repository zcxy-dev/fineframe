"""Music analysis: beats, downbeats, tempo, sections, loudness and where the sound ends."""

from collections import Counter
from collections.abc import Callable
from pathlib import Path

import numpy as np

from vework import audio, beats, loudness, ml, probe
from vework.music_index import MusicIndex

VERSION = 1
RATE = 48_000  # loudness is measured at the rate the renderer mixes at
# A section boundary compares this many bars before it with as many after it: a phrase.
PHRASE = 4
# How much more the bars on either side of a boundary differ from each other than among
# themselves, as the RMS difference of their mean log-mel spectra (one unit is a factor of e,
# 8.7 dB, in magnitude), for it to start a section. Set on synthetic tracks
# (tests/test_music.py): a loop that only changes its chord reads under 0.1, dropping or adding
# the drums or the bass over 0.5.
NOVELTY = 0.25
# Where the sound ends: the last 50 ms window within this many dB of the track's peak window.
END_RANGE_DB = 50.0
END_WINDOW = 0.05
# Beats the tempo is read over at a time.
SPAN = 8


def analyze(path: Path, license: dict, progress: Callable[[str], None]) -> dict:
    """The music index of one track. `license` is the statement it is used under, as the music
    index's `license` defines it; nothing is analysed without one."""
    if not license.get("name"):
        raise ValueError("a track needs the licence it is used under")
    progress("decoding")
    streams = probe.probe(path).audio
    stereo = audio.load(path, rate=RATE, channels=2) if streams else np.zeros((0, 2))
    end = sound_end(stereo, RATE)
    if not end:
        raise ValueError(f"{path.name}: no sound to analyse")
    ml.require()
    progress(f"finding beats with beat_this {beats.MODEL}")
    # The model was trained on the mean of the channels; a mono downmix by the decoder would be
    # 3 dB louder.
    mono = audio.load(path, rate=beats.RATE, channels=2).mean(axis=1)
    beat_times, downbeat_times, spect = beats.track(mono)
    beat_times = heard(beat_times, stereo, RATE)
    downbeat_times = heard(downbeat_times, stereo, RATE)
    progress("measuring loudness and sections")
    per_second = loudness.measure(stereo, RATE)["short_term"]
    result = {
        "version": VERSION,
        "source": {
            "name": path.name,
            "duration": round(len(stereo) / RATE, 6),
            "sample_rate": streams[0].sample_rate,
            "channels": streams[0].channels,
        },
        "license": license,
        "tracker": f"beat_this {beats.MODEL}",
        "tempo": tempo(beat_times, downbeat_times),
        "beats": _rounded(beat_times),
        "downbeats": _rounded(downbeat_times),
        "sections": sections(spect, beats.FPS, downbeat_times, per_second, end),
        "loudness": per_second,
        "end": round(end, 3),
    }
    # The planner reads this file through the same schema.
    MusicIndex.model_validate(result, strict=True)
    return result


def tempo(beat_times: np.ndarray, downbeat_times: np.ndarray) -> dict:
    """Beats per minute from the median time over SPAN beats, and the most common bar length in
    beats. One beat's interval is read to the tracker's 20 ms frames, 4 % of a beat at 128 BPM;
    SPAN of them divide that error, while a missed or extra beat still moves only a few of the
    spans the median is taken over."""
    bpm = None
    if len(beat_times) > 1:
        span = min(SPAN, len(beat_times) - 1)
        bpm = 60 * span / float(np.median(beat_times[span:] - beat_times[:-span]))
    per_bar = None
    if len(downbeat_times) > 1:
        counts = Counter(
            int(np.sum((beat_times >= a - 0.01) & (beat_times < b - 0.01)))
            for a, b in zip(downbeat_times[:-1], downbeat_times[1:], strict=True)
        )
        per_bar = counts.most_common(1)[0][0] or None
    return {"bpm": round(bpm, 3) if bpm else None, "beats_per_bar": per_bar}


def sections(
    spect: np.ndarray, fps: int, downbeat_times: np.ndarray, per_second: list[float], end: float
) -> list[dict]:
    """Stretches of bars that sound alike, from 0 to `end`.

    Each bar is summed up by its mean log-mel spectrum. A downbeat starts a new section where the
    PHRASE bars after it differ from the PHRASE bars before it by more than NOVELTY beyond how
    much either group differs within itself (Foote's checkerboard novelty, on distances), and no
    stronger boundary lies within PHRASE bars of it; a break of a bar or two inside a section
    leaves one side mixed and starts nothing. The time before the first downbeat belongs to the
    first section.
    """
    bars = [b for b in downbeat_times if b < end]
    edges = [*bars, end]
    if len(bars) < 2 * PHRASE:
        return [_section(0.0, end, per_second)]
    features = np.array(
        [
            spect[int(a * fps) : max(int(b * fps), int(a * fps) + 1)].mean(axis=0)
            for a, b in zip(edges[:-1], edges[1:], strict=True)
        ]
    )
    distance = np.sqrt(((features[:, None] - features[None]) ** 2).mean(axis=2))
    novelty = np.zeros(len(bars))
    for i in range(PHRASE, len(bars) - PHRASE + 1):
        before, after = slice(i - PHRASE, i), slice(i, i + PHRASE)
        within = max(distance[before, before].mean(), distance[after, after].mean())
        novelty[i] = distance[before, after].mean() - within
    starts: list[int] = []
    for i in np.argsort(-novelty, kind="stable"):
        if novelty[i] < NOVELTY:
            break
        if all(abs(i - j) >= PHRASE for j in starts):
            starts.append(int(i))
    times = [0.0, *sorted(float(bars[i]) for i in starts), end]
    return [_section(a, b, per_second) for a, b in zip(times[:-1], times[1:], strict=True)]


def integrated(per_second: list[float]) -> float:
    """BS.1770's gated mean, over per-second loudness values instead of 400 ms blocks: the power
    mean of the values above -70 LUFS and within 10 LU of their own mean."""
    values = np.array([v for v in per_second if v > loudness.FLOOR])
    if not len(values):
        return loudness.FLOOR

    def mean(selected: np.ndarray) -> float:
        return float(10 * np.log10(np.mean(10 ** (selected / 10))))

    gated = values[values >= mean(values) - 10]
    return round(max(mean(gated), loudness.FLOOR), 1)


def sound_end(samples: np.ndarray, rate: int) -> float:
    """Seconds where the sound last comes within END_RANGE_DB of its loudest window."""
    audible, size = _audible(samples, rate)
    if audible is None:
        return len(samples) / rate
    return float((audible[-1] + 1) * size / rate) if len(audible) else 0.0


def heard(times: np.ndarray, samples: np.ndarray, rate: int) -> np.ndarray:
    """The times inside the sound, from a window before its first audible one to its end. The
    tracker also marks beats in the silence around the music: the one the music would reach next
    while its last bar rings out, or one in a silent lead-in."""
    audible, size = _audible(samples, rate)
    if audible is None or not len(audible):
        return times
    start, end = (audible[0] - 1) * size / rate, (audible[-1] + 1) * size / rate
    return times[(times >= start) & (times < end)]


def _audible(samples: np.ndarray, rate: int) -> tuple[np.ndarray | None, int]:
    """The END_WINDOW windows within END_RANGE_DB of the loudest, and the window's length in
    samples; None when the audio is shorter than a window."""
    size = round(END_WINDOW * rate)
    count = len(samples) // size
    if not count:
        return None, size
    power = (samples[: count * size].reshape(count, size, -1) ** 2).mean(axis=(1, 2))
    floor = power.max() * 10 ** (-END_RANGE_DB / 10)
    return np.nonzero(power > floor)[0], size


def _section(start: float, end: float, per_second: list[float]) -> dict:
    seconds = per_second[int(start) : max(int(np.ceil(end)), int(start) + 1)]
    return {"start": round(start, 3), "end": round(end, 3), "loudness": integrated(seconds)}


def _rounded(times: np.ndarray) -> list[float]:
    return [round(float(t), 3) for t in times]
