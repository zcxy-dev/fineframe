"""Music analysis: beats, downbeats, tempo, sections, loudness and where the sound ends."""

import sys
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
# A beat interval keeps a period within this ratio of it, or of its double, half and so on: about
# twice the most the tracker's 20 ms frames move an interval at 160 BPM. Wider, the period's mean
# takes in intervals an extra beat cuts short: at 15 %, 'Advertime' reads 123 BPM, not 120 (#223).
KEEP = 0.1
# A tempo read faster than this is most likely the eighth notes taken for beats: the tracker
# reads a 96 BPM library track at 192 (#169).
DOUBLE_BPM = 160
# A tempo read slower than this is no beat: in music without one, such as sustained pads, the
# tracker marks a few accents seconds apart. It read 'Infinite Wonder' at 3 BPM and 'Ice and
# Snow' at 13, where the library's slowest beat is 60 (#218).
MIN_BPM = 40
# The tracker of an index made without the beat model, which could not be downloaded.
NO_TRACKER = "none"


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
    tracker = f"beat_this {beats.MODEL}"
    try:
        beat_times, downbeat_times, sureness, spect = beats.track(mono)
    except beats.Unavailable as error:
        # The planner fits a track without beats from its start, so the edit goes on (#155).
        print(f"vework: no beats: the beat model could not be downloaded: {error}", file=sys.stderr)
        tracker = NO_TRACKER
        beat_times = downbeat_times = sureness = np.zeros(0)
        spect = np.zeros((0, beats.BANDS))
    beat_times = heard(beat_times, stereo, RATE)
    inside = np.isin(downbeat_times, heard(downbeat_times, stereo, RATE))
    downbeat_times, sureness = downbeat_times[inside], sureness[inside]
    beat_times = folded(beat_times, downbeat_times)
    beat_times, downbeat_times = steady(beat_times, downbeat_times, sureness)
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
        "tracker": tracker,
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
    """Beats per minute from the period the most beat intervals keep, and the most common bar
    length in beats of that tempo, as `_counted`.

    The tracker misses beats in quiet passages, which reads them at double the period there, and
    takes the eighth notes of a busy passage for beats, which reads them at half. So the period is
    one of the `octaves` of the interval the most intervals keep: the one the most of them keep at
    its own length, a tie going to the faster, leaving out those faster than DOUBLE_BPM, which are
    eighth notes, unless every one is. Its mean interval reads it finer than the tracker's 20 ms
    frames."""
    found = octaves(beat_times)
    beat = [(period, count) for period, count in found if 60 / period <= DOUBLE_BPM] or found
    bpm = 60 / max(beat, key=lambda octave: octave[1])[0] if beat else None
    per_bar = None
    if bpm and len(downbeat_times) > 1:
        lengths = np.round(np.diff(_counted(beat_times, downbeat_times, bpm))).astype(int)
        per_bar = Counter(lengths.tolist()).most_common(1)[0][0] or None
    return {"bpm": round(bpm, 3) if bpm else None, "beats_per_bar": per_bar}


def octaves(beat_times: np.ndarray) -> list[tuple[float, int]]:
    """The period the most beat intervals keep, within KEEP of it or of a power of two times it:
    each power of two times it that intervals keep, from the shortest, as their mean interval and
    how many they are."""
    intervals = np.diff(beat_times)
    if not len(intervals):
        return []
    # Each interval's place within its octave, and how many lie within KEEP of it, across the
    # octave's ends too.
    octave = np.log2(intervals)
    place = np.sort(octave % 1)
    around = np.concatenate([place - 1, place, place + 1])
    width = np.log2(1 + KEEP)
    near = np.searchsorted(around, place + width, side="right") - np.searchsorted(
        around, place - width
    )
    best = place[np.argmax(near)]
    apart = (octave - best + 0.5) % 1 - 0.5
    kept = np.abs(apart) <= width
    power = np.round(octave - apart - best).astype(int)
    found = []
    for p in np.unique(power[kept]):
        keep = kept & (power == p)
        found.append((float(intervals[keep].mean()), int(keep.sum())))
    return found


def folded(beat_times: np.ndarray, downbeat_times: np.ndarray) -> np.ndarray:
    """The beats at half the tempo when, for most of the time the period's intervals cover, they
    read faster than DOUBLE_BPM, and a bar holds an even number of them: every other beat,
    counted from each downbeat, so every downbeat stays on a beat. Otherwise the beats as they
    are: a passage read at double time in a slower track keeps its eighth notes, where folding
    would drop every other beat of the rest."""
    found = octaves(beat_times)
    fast = sum(period * count for period, count in found if 60 / period > DOUBLE_BPM)
    covered = sum(period * count for period, count in found)
    counts = Counter(
        int(np.sum((beat_times >= a - 0.01) & (beat_times < b - 0.01)))
        for a, b in zip(downbeat_times[:-1], downbeat_times[1:], strict=True)
    )
    per_bar = counts.most_common(1)[0][0] if counts else None
    if fast <= covered / 2 or not per_bar or per_bar % 2:
        return beat_times
    # Each beat's count from the downbeat that starts its bar; a pickup counts back from the
    # first downbeat.
    first = np.searchsorted(beat_times, downbeat_times - 0.01)
    bar = np.searchsorted(downbeat_times - 0.01, beat_times, side="right") - 1
    count = np.arange(len(beat_times)) - first[np.maximum(bar, 0)]
    return beat_times[count % 2 == 0]


def steady(
    beat_times: np.ndarray, downbeat_times: np.ndarray, sureness: np.ndarray
) -> tuple[np.ndarray, np.ndarray]:
    """The beats, and the downbeats of the `bars` that hold; or none when the beats read slower
    than MIN_BPM: the planner then fits the track from its start, as one without a bar grid.
    `sureness` is how surely the model marks each downbeat, as its logit."""
    bpm = tempo(beat_times, downbeat_times)["bpm"]
    if bpm and bpm < MIN_BPM:
        return np.zeros(0), np.zeros(0)
    return beat_times, bars(beat_times, downbeat_times, sureness, bpm)


def bars(
    beat_times: np.ndarray, downbeat_times: np.ndarray, sureness: np.ndarray, bpm: float | None
) -> np.ndarray:
    """The downbeats of the bars that hold. The model also marks downbeats inside bars, less
    surely than the bars' own: on every beat of a quiet intro, halfway through a bar, an eighth
    note before a downbeat (#228).

    A bar's length is counted in beats of the tempo, as `_counted`. The bar the track keeps is
    the length of two beats or more its bars have the most of, each counted by how surely its
    weaker downbeat is marked, a tie going to the longer. A bar holds when it is a whole number
    of those, as one a downbeat the model missed makes. The downbeats kept join the most bars
    that hold less those that do not, a tie going to the one marked more surely; the last
    stays, as a track can end on a short bar. Where every bar holds, every downbeat stays."""
    count = len(downbeat_times)
    if not bpm or count < 3:
        return downbeat_times
    at = _counted(beat_times, downbeat_times, bpm)
    lengths = np.round(at[None, :] - at[:, None]).astype(int)
    votes: dict[int, float] = {}
    for k, n in enumerate(np.diag(lengths, 1).tolist()):
        if n >= 2:
            votes[n] = votes.get(n, 0.0) + min(sureness[k], sureness[k + 1])
    if not votes:
        return downbeat_times
    bar = max(votes, key=lambda n: (votes[n], n))
    holds = np.where((lengths > 0) & (lengths % bar == 0), 1, -1)
    # The best score of the downbeats kept up to each one, and the one kept before it.
    score = np.zeros(count, int)
    before = np.full(count, -1)
    for j in range(1, count):
        options = score[:j] + holds[:j, j]
        best = options.max()
        if best >= 0:
            tied = np.flatnonzero(options == best)
            score[j], before[j] = best, tied[np.argmax(sureness[tied])]
    kept = [count - 1]
    while before[kept[-1]] >= 0:
        kept.append(before[kept[-1]])
    return downbeat_times[kept[::-1]]


def _counted(beat_times: np.ndarray, downbeat_times: np.ndarray, bpm: float) -> np.ndarray:
    """Where each downbeat falls in beats of `bpm` from the first beat: each beat interval
    counts as the power of two times the period nearest it, so eighth notes read as beats and
    beats missed in a quiet passage count as the beats they are."""
    weights = 2.0 ** np.round(np.log2(np.diff(beat_times) * bpm / 60))
    counted = np.concatenate([[0.0], np.cumsum(weights)])
    at = np.searchsorted(beat_times, downbeat_times - 0.01)
    return counted[np.minimum(at, len(counted) - 1)]


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
