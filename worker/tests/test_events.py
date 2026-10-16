import json

import numpy as np
import pytest

from vework import events

RATE = 16_000


def found(**columns: list[float]) -> np.ndarray:
    """Per-window probabilities, one list per kind; kinds not given are 0."""
    length = len(next(iter(columns.values())))
    return np.array([columns.get(kind, [0.0] * length) for kind in events.KINDS]).T


def test_a_run_of_windows_is_one_event_over_their_centres():
    # Window k hears [k, k + 2) s and stands for [k + 0.5, k + 1.5).
    result = events.spans(found(laughter=[0, 0, 0.6, 0.9, 0.4, 0, 0]), 8.0)
    assert result == [{"kind": "laughter", "start": 2.5, "end": 5.5, "confidence": 0.9}]
    assert all(type(e[key]) is float for e in result for key in ("start", "end", "confidence"))


def test_the_first_and_last_windows_reach_the_edges_of_the_audio():
    result = events.spans(found(music=[0.9, 0.1, 0.1, 0.8]), 4.7)
    assert [(e["start"], e["end"]) for e in result] == [(0.0, 1.5), (3.5, 4.7)]


def test_a_short_dip_does_not_split_an_event():
    result = events.spans(found(laughter=[0.8, 0.1, 0.7, 0.1, 0.1, 0.9]), 7.0)
    assert [(e["start"], e["end"]) for e in result] == [(0.0, 3.5), (5.5, 7.0)]


def test_each_kind_has_its_own_threshold(monkeypatch):
    monkeypatch.setattr(events, "THRESHOLDS", {"laughter": 0.3, "applause": 0.6, "music": 0.5})
    result = events.spans(found(laughter=[0.4], applause=[0.55], music=[0.55]), 1.0)
    assert [e["kind"] for e in result] == ["laughter", "music"]


def test_kinds_overlap_and_come_out_in_order_of_start():
    result = events.spans(found(applause=[0, 0, 0.9, 0.9], music=[0.9, 0.9, 0.9, 0.9]), 5.0)
    assert [(e["kind"], e["start"], e["end"]) for e in result] == [
        ("music", 0.0, 5.0),
        ("applause", 2.5, 5.0),
    ]


def test_audio_shorter_than_a_window_is_one_window():
    assert events.windows(RATE // 2).tolist() == [0]
    result = events.spans(found(applause=[0.7]), 0.5)
    assert result == [{"kind": "applause", "start": 0.0, "end": 0.5, "confidence": 0.7}]


def test_windows_cover_the_audio_in_bounded_batches(monkeypatch):
    seen = []

    def classify(batch):
        seen.append(len(batch))
        # Report each window's mean as every kind's probability, to check the alignment.
        return np.repeat(batch.mean(axis=1, keepdims=True), len(events.KINDS), axis=1)

    monkeypatch.setattr(events, "_classifier", lambda: classify)
    monkeypatch.setattr(events, "BATCH", 4)
    samples = np.zeros(round(10.5 * RATE), np.float32)
    samples[round(9.5 * RATE) :] = 1.0  # only the last window, padded with silence, hears it
    result = events.probabilities(samples)
    assert seen == [4, 4, 2]  # windows start at 0, 1, … 9 s; the last runs past the end
    assert result[:, 0].tolist() == pytest.approx([0.0] * 8 + [0.25, 0.5])


def test_no_audio_has_no_events(monkeypatch):
    monkeypatch.setattr(events, "_classifier", lambda: pytest.fail("model loaded"))
    assert events.detect(np.zeros(0, np.float32)) == []


def melody(seconds: float, rng: np.random.Generator) -> np.ndarray:
    """Piano-like notes: harmonics with a sharp attack and an exponential decay."""
    out = np.zeros(round(seconds * RATE))
    t = np.arange(round(0.8 * RATE)) / RATE
    for start in np.arange(0, seconds - 0.8, 0.25):
        f = rng.choice([261.63, 293.66, 329.63, 392.0, 440.0, 523.25])
        note = sum(np.sin(2 * np.pi * f * k * t) / k**1.5 for k in range(1, 8)) * np.exp(-t / 0.3)
        out[round(start * RATE) : round(start * RATE) + len(t)] += note
    return 0.3 * out / np.abs(out).max()


def bursts(seconds: float, rng: np.random.Generator) -> np.ndarray:
    """Dense short noise bursts, the usual synthetic stand-in for applause."""
    out = np.zeros(round(seconds * RATE))
    t = np.arange(round(0.02 * RATE)) / RATE
    for start in rng.uniform(0, seconds - 0.02, round(seconds * 150)):
        burst = rng.standard_normal(len(t)) * np.exp(-t / 0.004)
        out[round(start * RATE) : round(start * RATE) + len(t)] += burst
    return 0.3 * out / np.abs(out).max()


@pytest.mark.ml
def test_music_is_found_where_it_plays_and_nothing_else_is():
    rng = np.random.default_rng(0)
    t = np.arange(4 * RATE) / RATE
    samples = np.concatenate(
        [np.zeros(6 * RATE), melody(10, rng), bursts(6, rng), 0.1 * np.sin(2 * np.pi * 997 * t)]
    ).astype(np.float32)
    found = events.detect(samples)
    assert [e["kind"] for e in found] == ["music"]
    # Edges land within a window of where the music starts and stops.
    assert found[0]["start"] == pytest.approx(6.0, abs=events.WINDOW)
    assert found[0]["end"] == pytest.approx(16.0, abs=events.WINDOW)
    assert found[0]["confidence"] >= events.THRESHOLDS["music"]


@pytest.mark.ml
def test_a_model_onnx_runtime_cannot_load_is_a_one_line_error(monkeypatch, tmp_path):
    labels = [label for names in events.KINDS.values() for label in names]
    (tmp_path / "config.json").write_text(json.dumps({"id2label": dict(enumerate(labels))}))
    (tmp_path / "model.onnx").write_bytes(b"not a model")  # as a damaged download would be
    monkeypatch.setattr("huggingface_hub.hf_hub_download", lambda _, name, **k: tmp_path / name)
    with pytest.raises(RuntimeError, match=events.MODEL):
        events._classifier()


@pytest.mark.ml
def test_a_failed_inference_is_a_one_line_error():
    classify = events._classifier()
    with pytest.raises(RuntimeError, match=events.MODEL):
        classify(np.zeros((1, 10), np.float64))  # the model takes float32
