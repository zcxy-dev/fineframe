import bisect
import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Transition:
    """A shot change; a hard cut has start == end, a dissolve or fade spans its frames."""

    start: float
    end: float

    @property
    def gradual(self) -> bool:
        return self.end > self.start


def _seconds(value) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)


def load_truth(path: Path) -> list[Transition]:
    """Read `{"transitions": [{"start": s, "end": e}]}`; `end` defaults to `start`."""
    data = json.loads(path.read_text(encoding="utf-8"))
    items = data.get("transitions") if isinstance(data, dict) else None
    if not isinstance(items, list) or not all(
        isinstance(t, dict) and _seconds(t.get("start")) and _seconds(t.get("end", t.get("start")))
        for t in items
    ):
        raise ValueError(
            f'{path.name}: expected {{"transitions": [{{"start": s, "end": s}}]}} '
            "with times in seconds (end optional)"
        )
    return [Transition(t["start"], t.get("end", t["start"])) for t in items]


def load_cuts(path: Path) -> list[float]:
    """Read detected cut times: a JSON list of seconds, or {"cuts": [...]}."""
    data = json.loads(path.read_text(encoding="utf-8"))
    cuts = data.get("cuts") if isinstance(data, dict) else data
    if not isinstance(cuts, list) or not all(map(_seconds, cuts)):
        raise ValueError(
            f'{path.name}: expected a list of cut times in seconds, or {{"cuts": [...]}}'
        )
    return [float(t) for t in cuts]


def compare(truth: list[Transition], cuts: list[float], tolerance: float = 0.1) -> dict:
    """Match each transition to at most one detected cut inside its span widened by `tolerance`."""
    remaining = sorted(cuts)
    matched = set()
    # Earliest window end first, taking the earliest free cut in the window, maximises matches.
    for i, t in sorted(enumerate(truth), key=lambda it: it[1].end):
        # The epsilon keeps a detection exactly `tolerance` away from missing by float rounding.
        k = bisect.bisect_left(remaining, t.start - tolerance - 1e-9)
        if k < len(remaining) and remaining[k] <= t.end + tolerance + 1e-9:
            remaining.pop(k)
            matched.add(i)
    counts = {"tp": len(matched), "fp": len(cuts) - len(matched), "fn": len(truth) - len(matched)}
    for kind, gradual in (("hard", False), ("gradual", True)):
        group = [i for i, t in enumerate(truth) if t.gradual == gradual]
        counts[f"{kind}_total"] = len(group)
        counts[f"{kind}_hit"] = sum(i in matched for i in group)
    return counts


def summarize(comparisons: list[dict]) -> dict:
    c = {k: sum(x[k] for x in comparisons) for k in comparisons[0]} if comparisons else {}
    tp, fp, fn = c.get("tp", 0), c.get("fp", 0), c.get("fn", 0)
    precision = tp / (tp + fp) if tp + fp else None
    recall = tp / (tp + fn) if tp + fn else None
    # Undefined only when there was nothing to find and nothing was found.
    f1 = 2 * tp / (2 * tp + fp + fn) if tp + fp + fn else None
    return {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "hard_recall": c["hard_hit"] / c["hard_total"] if c.get("hard_total") else None,
        "gradual_recall": c["gradual_hit"] / c["gradual_total"] if c.get("gradual_total") else None,
    }


def score(truth: list[Transition], cuts: list[float], tolerance: float = 0.1) -> dict:
    return summarize([compare(truth, cuts, tolerance)])
