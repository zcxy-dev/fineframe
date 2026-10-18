"""Word edges finer than the forced aligner's grid, read from the audio around each one."""

from bisect import bisect_right
from itertools import pairwise

import numpy as np

from vework.audio import RATE

# Qwen3-ForcedAligner reports an edge as the index of an 80 ms encoder frame times 80 ms (or,
# where it smooths a run of out-of-order frames, a time between them). Edges are searched for in
# the cell [t, t + GRID] after the reported time t. On the synthetic corpus that cell holds 79 %
# of the starts after a pause but only 54 % of the boundaries between two words, which mostly lie
# later still (worker/README.md#word-timings).
GRID = 0.08
STEP = 0.0025  # where the level is read, every 2.5 ms
# The level is the mean power over 20 ms: a few pitch periods, so it does not ripple with each.
WINDOW = 0.02
# A pause edge is where the level stands this far above the quietest point of the pause.
RISE_DB = 10.0
# A gap between two words is silence: within this much of the source's level where Silero hears
# no speech. The dip between two syllables said together stays well above it.
PAUSE_DB = 10.0
DIGITAL_SILENCE = -90.0  # dB; zeros read as -100
MIN_LENGTH = 0.02  # no edge moves closer than this to the next one


def refine(
    words: list[dict],
    samples: np.ndarray,
    speech: list[dict],
    end: float,
    rate: int = RATE,
    floor: float | None = None,
) -> list[dict]:
    """Move each edge the aligner reported to where the audio puts it inside its grid cell.

    `words` hold the aligner times of one chunk ending at `end`, with zero-length words already
    given time; `samples` and `speech` are the whole source's audio and Silero speech segments.
    Within the cell:
    - a boundary two words share goes to the quietest point, the dip between their syllables,
      or the cell's end where the level is still falling there;
    - a start after a pause goes to where the sound rises out of the pause;
    - an end before a pause goes to where the sound falls back into it.
    The audio decides every move; a pause edge stays where the cell shows none.
    These moves are only later and stop short of the next edge and of `end`, where the next
    chunk's words may start, so words keep their order and never overlap; an edge inside a
    speech segment stays inside it.

    Then each gap left between two words shrinks to the silence in it (see `_close`), so a cut
    in a gap never lands on sound: the end before it moves later and the start after it
    earlier, neither past the other. `floor` is `noise_floor(samples, speech)`, passed in when
    refining many chunks of one source.
    """
    groups = _groups(words)
    times = [words[i][key] for i, key in (group[0] for group in groups)]
    starts, ends = [s["start"] for s in speech], [s["end"] for s in speech]
    for n, group in enumerate(groups):
        t = times[n]
        hi = min(t + GRID, end)
        if n + 1 < len(groups):
            hi = min(hi, times[n + 1] - MIN_LENGTH)
        seg = bisect_right(starts, t) - 1
        if seg >= 0 and t <= ends[seg]:
            hi = min(hi, ends[seg])
        if hi <= t:
            continue
        cell = t + STEP * np.arange(int(round((hi - t) / STEP, 6)) + 1)
        level = _level(samples, cell, rate)
        first, last = group[0][1], group[-1][1]
        if first == "end" and last == "start":
            moved = cell[int(np.argmin(level))]
        elif first == "start" and last == "start":
            before = max(times[n - 1], t - GRID) if n else t - GRID
            loud = level >= _floor(samples, before, hi, rate) + RISE_DB
            # Sounding at t already (argmax is 0), or silent through the cell: the start stays.
            moved = cell[np.argmax(loud)] if loud.any() else t
        elif first == "end" and last == "end":
            after = min(times[n + 1], t + 2 * GRID) if n + 1 < len(groups) else t + 2 * GRID
            quiet = level < _floor(samples, t, after, rate) + RISE_DB
            # Quiet at t already (argmax is 0): the end stays. Sounding through the cell: the
            # word lasts at least to the cell's end.
            moved = cell[np.argmax(quiet)] if quiet.any() else cell[-1]
        else:
            continue  # zero-length words alone in a pause: nothing to read an edge from
        for i, key in group:
            words[i][key] = round(float(moved), 3)
    silence = (noise_floor(samples, speech, rate) if floor is None else floor) + PAUSE_DB
    for before, after in pairwise(words):
        if after["start"] > before["end"]:
            _close(before, after, samples, silence, rate)
    return words


def noise_floor(samples: np.ndarray, speech: list[dict], rate: int = RATE) -> float:
    """The source's level where Silero hears no speech: the median, read every 10 ms, of the
    time that is not digital silence, which a muted intro would otherwise drag far below the
    room between the words. With no such time, its quietest level."""
    times = np.arange(0.0, len(samples) / rate, 0.01)
    if not len(times):
        return DIGITAL_SILENCE
    level = _level(samples, times, rate)
    pause = level > DIGITAL_SILENCE
    for seg in speech:
        pause &= (times < seg["start"]) | (times >= seg["end"])
    return float(np.median(level[pause]) if pause.any() else level.min())


def _close(before: dict, after: dict, samples: np.ndarray, silence: float, rate: int) -> None:
    """Shrink the gap between two words to its longest silent stretch, the sound on either side
    of it going to the word on that side: the aligner leaves gaps where the speaker made none,
    and times a word after the pause that follows it. A gap with no silence at all closes at
    its quietest point, the dip between the two words' syllables."""
    t = np.arange(before["end"], after["start"], STEP)
    level = _level(samples, t, rate)
    quiet = level < silence
    if not quiet.any():
        before["end"] = after["start"] = round(float(t[int(np.argmin(level))]), 3)
        return
    # The longest run of quiet steps: [first, last].
    edges = np.flatnonzero(np.diff(np.concatenate([[0], quiet.astype(int), [0]])))
    runs = edges.reshape(-1, 2)
    first, stop = runs[int(np.argmax(runs[:, 1] - runs[:, 0]))]
    # A run reaching the gap's end leaves the start where it is: the step grid stops short of it.
    before["end"] = round(float(t[first]), 3)
    if stop < len(t):
        after["start"] = round(float(t[stop]), 3)


def _groups(words: list[dict]) -> list[list[tuple[int, str]]]:
    """Edges in time order, those at the same time together: a shared boundary, or the edges
    of zero-length words, which move as one."""
    groups: list[list[tuple[int, str]]] = []
    for i, word in enumerate(words):
        for key in ("start", "end"):
            if groups and word[key] == words[groups[-1][0][0]][groups[-1][0][1]]:
                groups[-1].append((i, key))
            else:
                groups.append([(i, key)])
    return groups


def _level(samples: np.ndarray, times: np.ndarray, rate: int) -> np.ndarray:
    """Mean power in dB over WINDOW around each time."""
    half = int(WINDOW * rate) // 2
    centers = np.round(times * rate).astype(int)
    lo = np.clip(centers - half, 0, len(samples))
    hi = np.clip(centers + half, 0, len(samples))
    a = lo.min()
    power = np.concatenate([[0.0], np.cumsum(samples[a : hi.max()].astype(np.float64) ** 2)])
    mean = (power[hi - a] - power[lo - a]) / np.maximum(hi - lo, 1)
    return 10 * np.log10(mean + 1e-10)


def _floor(samples: np.ndarray, start: float, end: float, rate: int) -> float:
    """The lowest level between `start` and `end`, inside the audio: there is no silence to
    read before the file starts or after it ends."""
    times = np.arange(max(start, 0.0), min(end, len(samples) / rate), STEP)
    return float(_level(samples, times, rate).min())
