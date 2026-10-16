"""Score a beat tracker against known beats, and the tempo it reads, as mir_eval scores beats."""

import json
from pathlib import Path

import numpy as np

# mir_eval's F-measure window: a beat within ±70 ms of a true one is a hit.
WINDOW = 0.07


def fmeasure(reference: list[float], estimated: list[float], window: float = WINDOW) -> dict:
    """Precision, recall and F-measure of one-to-one matches within ±`window`, closest first,
    and the signed offsets of the matched beats in milliseconds (positive: found late)."""
    pairs = sorted(
        (abs(e - r), i, j)
        for i, r in enumerate(reference)
        for j, e in enumerate(estimated)
        if abs(e - r) <= window
    )
    used_ref, used_est, offsets = set(), set(), []
    for _, i, j in pairs:
        if i not in used_ref and j not in used_est:
            used_ref.add(i)
            used_est.add(j)
            offsets.append((estimated[j] - reference[i]) * 1000)
    hits = len(offsets)
    precision = hits / len(estimated) if estimated else 0.0
    recall = hits / len(reference) if reference else 0.0
    f = 2 * precision * recall / (precision + recall) if hits else 0.0
    return {
        "f": f,
        "precision": precision,
        "recall": recall,
        "offset_ms": {
            "mean": float(np.mean(offsets)) if offsets else None,
            "max_abs": float(np.max(np.abs(offsets))) if offsets else None,
        },
    }


def score(truth_path: Path, found_path: Path) -> dict:
    """A music index (`vework analyze-music`) against the synthetic corpus's beat truth."""
    truth = json.loads(truth_path.read_text(encoding="utf-8"))
    found = json.loads(found_path.read_text(encoding="utf-8"))
    bpm = found.get("tempo", {}).get("bpm")
    return {
        "beats": fmeasure(truth["beats"], found["beats"]),
        "downbeats": fmeasure(truth["downbeats"], found["downbeats"]),
        "bpm": {
            "truth": truth["bpm"],
            "found": bpm,
            "error": bpm / truth["bpm"] - 1 if bpm else None,
        },
    }
