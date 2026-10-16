import json
from collections.abc import Callable
from pathlib import Path

import numpy as np

from vework import download, ml
from vework.audio import RATE

# CED (Apache-2.0), an AudioSet tagger, exported to ONNX with its mel front end and int8 weights:
# no model code to fetch and run, and it reads the 16 kHz audio the other analyses use.
MODEL = "mispeech/ced-base"
REVISION = "db3e14a8db4c21b56b165261c39649741a900e7f"  # pinned so an index is reproducible
# The sounds the planner looks for in highlights, and the AudioSet classes each one covers.
KINDS = {
    "laughter": ("Laughter", "Baby laughter", "Giggle", "Snicker", "Belly laugh", "Chuckle"),
    "applause": ("Applause", "Clapping", "Cheering"),
    "music": ("Music",),
}
# Music's is set from synthetic audio: speech, silence, tones and noise score at most 0.11, a quiet
# music bed under speech 0.5 to 0.7. No real laughter or applause has been measured yet.
THRESHOLDS = {"laughter": 0.3, "applause": 0.3, "music": 0.5}
WINDOW = 2.0  # seconds the classifier hears at a time
HOP = 1.0  # seconds between windows: how finely event edges are placed
MAX_GAP = 1.0  # a laugh that pauses for breath stays one event
BATCH = 16  # windows per pass, so memory does not grow with the source


def windows(length: int, rate: int = RATE) -> np.ndarray:
    """Start samples of the windows that cover `length` samples; the last may run past the end."""
    window, hop = round(WINDOW * rate), round(HOP * rate)
    return np.arange(max(1, -(-max(length - window, 0) // hop) + 1)) * hop


def probabilities(samples: np.ndarray) -> np.ndarray:
    """Per window, the probability of each kind: the highest among its AudioSet classes."""
    classify = _classifier()
    window = round(WINDOW * RATE)
    starts = windows(len(samples))
    out = []
    for lo in range(0, len(starts), BATCH):
        batch = np.zeros((len(starts[lo : lo + BATCH]), window), np.float32)
        for row, start in zip(batch, starts[lo : lo + BATCH], strict=True):
            piece = samples[start : start + window]
            row[: len(piece)] = piece  # the last window is padded with silence
        out.append(classify(batch))
    return np.concatenate(out)


def spans(found: np.ndarray, duration: float) -> list[dict]:
    """Events from per-window probabilities (windows x KINDS), in order of start.

    Each window stands for the hop-long stretch at its centre; the first and last reach the
    edges of the audio. A run of windows at or over the kind's threshold is one event, and runs
    at most MAX_GAP apart merge. Confidence is the highest probability inside the event.
    """
    margin = (WINDOW - HOP) / 2
    gap = round(MAX_GAP / HOP)
    events = []
    for column, kind in enumerate(KINDS):
        probability = found[:, column]
        hits = np.flatnonzero(probability >= THRESHOLDS[kind])
        if not len(hits):
            continue
        # Split where windows over the threshold are further apart than the gap allows.
        breaks = np.flatnonzero(np.diff(hits) > gap + 1)
        for first, last in zip(
            hits[np.r_[0, breaks + 1]], hits[np.r_[breaks, len(hits) - 1]], strict=True
        ):
            start = float(first * HOP + margin) if first > 0 else 0.0
            end = float(last * HOP + margin + HOP) if last < len(probability) - 1 else duration
            events.append(
                {
                    "kind": kind,
                    "start": round(min(start, duration), 3),
                    "end": round(min(end, duration), 3),
                    "confidence": round(float(probability[first : last + 1].max()), 2),
                }
            )
    return sorted(events, key=lambda e: (e["start"], list(KINDS).index(e["kind"])))


def detect(samples: np.ndarray) -> list[dict]:
    """Laughter, applause and music in 16 kHz mono audio, as events with a confidence."""
    if not len(samples):
        return []
    return spans(probabilities(samples), len(samples) / RATE)


def _classifier() -> Callable[[np.ndarray], np.ndarray]:
    """Load the model: a function from a batch of windows to probabilities (windows x KINDS)."""
    ml.require()
    import onnxruntime
    from huggingface_hub import hf_hub_download

    def fetch(name: str) -> str:
        return hf_hub_download(MODEL, name, revision=REVISION)

    download.hub(MODEL, REVISION, ["config.json", "model.onnx"])
    labels = json.loads(Path(fetch("config.json")).read_text(encoding="utf-8"))["id2label"]
    columns = [
        [int(i) for i, label in labels.items() if label in names] for names in KINDS.values()
    ]
    if sum(map(len, columns)) != sum(map(len, KINDS.values())):
        raise RuntimeError(f"{MODEL}: missing AudioSet classes that KINDS names")
    # ONNX Runtime's errors (a damaged download, memory running out) derive from Exception alone;
    # as RuntimeError they reach the user as one line naming the model.
    try:
        session = onnxruntime.InferenceSession(
            fetch("model.onnx"), providers=["CPUExecutionProvider"]
        )
    except Exception as exc:
        raise RuntimeError(f"{MODEL}: {exc}") from exc

    def classify(batch: np.ndarray) -> np.ndarray:
        try:
            (found,) = session.run(None, {"waveform": batch})
        except Exception as exc:
            raise RuntimeError(f"{MODEL}: {exc}") from exc
        return np.stack([found[:, c].max(axis=1) for c in columns], axis=1)

    return classify
