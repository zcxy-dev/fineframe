"""Active-speaker accuracy: whether a system names the person who is talking, over time."""

import json
import math
from pathlib import Path

import numpy as np

STEP = 0.01  # seconds: both sides are compared on this grid


def load(path: Path) -> list[dict]:
    """Read `{"turns": [{"start": s, "end": s, "speaker": "A", "visible": true}]}`.

    `visible` (whether the speaker's face is on screen) is optional and defaults to true.
    """
    data = json.loads(path.read_text(encoding="utf-8"))
    turns = data.get("turns") if isinstance(data, dict) else None

    def valid(t) -> bool:
        times = [t.get("start"), t.get("end")] if isinstance(t, dict) else []
        return (
            all(isinstance(v, int | float) and not isinstance(v, bool) for v in times)
            and 0 <= times[0] <= times[1]
            and isinstance(t.get("speaker"), str)
            and isinstance(t.get("visible", True), bool)
        )

    if not isinstance(turns, list) or not all(map(valid, turns)):
        raise ValueError(
            f'{path.name}: expected {{"turns": [{{"start": s, "end": s, "speaker": "A"}}]}} '
            "with times in seconds, 0 <= start <= end (visible optional)"
        )
    return [{**t, "visible": t.get("visible", True)} for t in turns]


def compare(truth: list[dict], hyp: list[dict]) -> dict:
    """Seconds of each outcome where exactly one truth speaker talks.

    A system names speakers by its own labels, such as a face per shot, so each label counts as
    the truth speaker it overlaps most while that speaker is on screen; several labels can stand
    for one person. On screen, the system is right when it names that person, wrong when it names
    someone else, and misses when it names no one. While the speaker is off screen (a voice-over),
    naming anyone is wrong, and is counted apart.
    """
    end = max((t["end"] for t in [*truth, *hyp]), default=0.0)
    cells = math.ceil(end / STEP) + 1

    def span(turn: dict) -> slice:
        return slice(round(turn["start"] / STEP), round(turn["end"] / STEP))

    people = sorted({t["speaker"] for t in truth})
    talking = np.zeros(cells, int)
    who = np.full(cells, -1)
    seen = np.zeros(cells, bool)
    for turn in truth:
        talking[span(turn)] += 1
        who[span(turn)] = people.index(turn["speaker"])
        seen[span(turn)] = turn["visible"]
    labels = sorted({t["speaker"] for t in hyp})
    named = np.full(cells, -1)
    for turn in hyp:
        named[span(turn)] = labels.index(turn["speaker"])

    single = talking == 1
    on_screen = single & seen
    mapping = np.full(len(labels) + 1, -2)  # index -1 (no label) maps to no one
    for i in range(len(labels)):
        overlap = np.bincount(who[on_screen & (named == i)], minlength=len(people))
        mapping[i] = int(np.argmax(overlap)) if overlap.any() else -2
    claimed = mapping[named]
    seconds = {
        "seconds": on_screen.sum(),
        "correct": (on_screen & (named >= 0) & (claimed == who)).sum(),
        "wrong": (on_screen & (named >= 0) & (claimed != who)).sum(),
        "missed": (on_screen & (named < 0)).sum(),
        "offscreen_seconds": (single & ~seen).sum(),
        "offscreen_named": (single & ~seen & (named >= 0)).sum(),
    }
    return {key: round(float(value) * STEP, 2) for key, value in seconds.items()}


def summarize(comparisons: list[dict]) -> dict:
    """Pooled over clips: shares of the on-screen speaking time, and of the off-screen time."""
    total = {k: sum(c[k] for c in comparisons) for k in comparisons[0]} if comparisons else {}

    def share(part: str, whole: str):
        return round(total[part] / total[whole], 4) if total.get(whole) else None

    return {
        "seconds": round(total.get("seconds", 0.0), 2),
        "accuracy": share("correct", "seconds"),
        "wrong": share("wrong", "seconds"),
        "missed": share("missed", "seconds"),
        "offscreen_seconds": round(total.get("offscreen_seconds", 0.0), 2),
        "offscreen_named": share("offscreen_named", "offscreen_seconds"),
    }
