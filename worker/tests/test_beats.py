import hashlib
import urllib.error

import numpy as np
import pytest

from vework import beats, download


def test_mel_bands_are_the_models_slaney_filters():
    filters = beats.mel_filters()
    assert filters.shape == (128, 513)
    # Sums of a low, a middle and the top band, as the model's training front end has them (and
    # librosa's slaney filters without normalisation): the bands widen above 1 kHz, where the
    # scale turns logarithmic.
    assert filters[[0, 64, 127]].sum(axis=1) == pytest.approx(
        [1.157014, 2.459411, 13.10398], rel=1e-6
    )
    # Each band rises from its lower neighbour's centre and falls to its upper neighbour's.
    peaks = filters.argmax(axis=1)
    assert np.all(np.diff(peaks) >= 0)
    assert filters[:, : int(30 / (beats.RATE / beats.FFT))].max() == 0  # nothing under 30 Hz
    assert filters[:, int(np.ceil(11_000 / (beats.RATE / beats.FFT))) + 1 :].max() == 0


@pytest.mark.ml
@pytest.mark.parametrize("frames", [1, 40, 1488, 1489, 3 * 1500 + 17])
def test_every_frame_is_predicted_away_from_a_windows_edges(frames):
    import torch

    assert beats.WINDOW - 2 * beats.EDGE == 1488
    spect = torch.zeros(frames, beats.BANDS)
    spect[:, 0] = torch.arange(1, frames + 1)
    lengths = []

    def model(x):
        # Echoes each frame's number, and spoils the frames at either edge of the window.
        n = x.shape[1]
        lengths.append(n)
        spoiled = torch.zeros(n)
        spoiled[: beats.EDGE] = spoiled[n - beats.EDGE :] = 1e6
        return {"beat": x[..., 0] + spoiled, "downbeat": -x[..., 0]}

    beat, downbeat = beats.activations(spect, model)
    assert torch.equal(beat, torch.arange(1, frames + 1, dtype=torch.float32))
    assert torch.equal(downbeat, -beat)
    assert max(lengths) <= beats.WINDOW
    assert len(lengths) == -(-frames // 1488)


def failing_host(monkeypatch, tmp_path, down: str):
    """Downloads that fail on every address containing `down`, and give a stand-in checkpoint
    elsewhere, pinned in its place and kept in tmp_path; returns the addresses asked."""
    body = b"a stand-in checkpoint"
    asked = []

    def fetch(address, name, timeout=60):
        asked.append(address)
        if down in address:
            raise urllib.error.HTTPError(address, 503, "Service Unavailable", None, None)
        return body

    monkeypatch.setattr(download, "url", fetch)
    monkeypatch.setattr(beats, "SHA256", hashlib.sha256(body).hexdigest())
    monkeypatch.setattr(beats, "checkpoint_path", lambda: tmp_path / "beat_this-final0.ckpt")
    return asked


def test_the_checkpoint_comes_from_the_second_source_when_the_first_fails(tmp_path, monkeypatch):
    # The authors' host answered 503 for days (#155).
    asked = failing_host(monkeypatch, tmp_path, "cloud.cp.jku.at")
    path = beats._checkpoint()
    assert path.read_bytes() == b"a stand-in checkpoint"
    assert len(asked) == 2 and "zcxy-dev/fineframe-music" in asked[1]


def test_a_checkpoint_no_source_gives_is_unavailable(tmp_path, monkeypatch):
    failing_host(monkeypatch, tmp_path, "https://")
    with pytest.raises(beats.Unavailable, match="503"):
        beats._checkpoint()
    assert list(tmp_path.iterdir()) == []
