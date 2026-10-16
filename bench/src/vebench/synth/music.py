"""Drum-and-bass tracks with exactly known tempo, beats, downbeats and sections, for beat sync."""

from collections.abc import Sequence

import numpy as np

RATE = 48_000
# Root notes (Hz) of four-bar progressions: I-V-vi-IV and vi-IV-I-V in a few keys.
PROGRESSIONS = (
    (55.0, 82.41, 92.5, 73.42),
    (61.74, 49.0, 73.42, 55.0),
    (65.41, 98.0, 55.0, 87.31),
)


def _kick(rng: np.random.Generator) -> np.ndarray:
    t = np.arange(int(0.35 * RATE)) / RATE
    # A falling pitch is what makes a kick read as a kick.
    phase = 2 * np.pi * (45 * t + (110 - 45) * 0.03 * (1 - np.exp(-t / 0.03)))
    return np.sin(phase) * np.exp(-t / 0.12)


def _snare(rng: np.random.Generator) -> np.ndarray:
    t = np.arange(int(0.25 * RATE)) / RATE
    noise = rng.standard_normal(len(t))
    return (0.6 * noise + 0.5 * np.sin(2 * np.pi * 185 * t)) * np.exp(-t / 0.06)


def _hat(rng: np.random.Generator) -> np.ndarray:
    t = np.arange(int(0.06 * RATE)) / RATE
    noise = np.diff(rng.standard_normal(len(t) + 1))  # a first difference keeps the highs
    return noise * np.exp(-t / 0.012)


def _bass(freq: float, length: float) -> np.ndarray:
    t = np.arange(int(length * RATE)) / RATE
    tone = np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(4 * np.pi * freq * t)
    return tone * np.minimum(1, t / 0.01) * np.exp(-t / (length * 0.8))


def _place(out: np.ndarray, sound: np.ndarray, at: float, gain: float) -> None:
    i = round(at * RATE)
    n = min(len(sound), len(out) - i)
    if n > 0:
        out[i : i + n] += gain * sound[:n]


ALL = "kshb"  # kick, snare, hats, bass


def track(
    bpm: int, bars: int, pickup: int, seed: int, sections: Sequence[tuple[int, str]] = ()
) -> tuple[np.ndarray, dict]:
    """A 4/4 track at `bpm`, starting `pickup` beats of hats before the first downbeat.

    `sections` lists (bars, parts) in order, parts being letters of ALL that play in them; their
    bars add up to `bars`. Without them every bar plays everything. Returns mono samples at RATE
    and the truth: every beat time, the downbeats among them and the sections, in seconds. Kicks
    fall on beats 1 and 3, snares on 2 and 4, hats on every eighth, a bass note on 1 and 3.
    """
    sections = tuple(sections) or ((bars, ALL),)
    if sum(n for n, _ in sections) != bars:
        raise ValueError(f"the sections' bars add up to {sum(n for n, _ in sections)}, not {bars}")
    parts = [p for n, p in sections for _ in range(n)]
    rng = np.random.default_rng(seed)
    beat = 60 / bpm
    lead = 0.5  # silence before the first hit, as exported tracks usually have
    count = pickup + 4 * bars
    beats = [round(lead + i * beat, 6) for i in range(count)]
    out = np.zeros(round((lead + count * beat + 1.0) * RATE))
    kick, snare, hat = _kick(rng), _snare(rng), _hat(rng)
    roots = PROGRESSIONS[rng.integers(len(PROGRESSIONS))]
    for i, at in enumerate(beats):
        position = (i - pickup) % 4  # 0 on a downbeat
        bar = (i - pickup) // 4
        playing = parts[bar] if i >= pickup else "h"
        if position in (0, 2) and "k" in playing:
            _place(out, kick, at, 0.9 if position == 0 else 0.7)
        if position in (1, 3) and "s" in playing:
            _place(out, snare, at, 0.7)
        if position in (0, 2) and "b" in playing:
            _place(out, _bass(roots[bar % 4], beat * 1.8), at, 0.35)
        if "h" in playing:
            for half in (0, 0.5):
                _place(out, hat, at + half * beat, 0.25 if half else 0.35)
    out *= 0.8 / np.abs(out).max()
    downbeats = [at for i, at in enumerate(beats) if i >= pickup and (i - pickup) % 4 == 0]
    duration = round(len(out) / RATE, 6)
    starts = np.cumsum([0, *(n for n, _ in sections)])[:-1]
    bounds = [0.0, *(downbeats[s] for s in starts[1:]), duration]
    truth = {
        "bpm": bpm,
        "meter": 4,
        "duration": duration,
        "beats": beats,
        "downbeats": downbeats,
        "sections": [
            {"start": a, "end": b, "parts": p}
            for a, b, (_, p) in zip(bounds[:-1], bounds[1:], sections, strict=True)
        ],
    }
    return out.astype(np.float32), truth
