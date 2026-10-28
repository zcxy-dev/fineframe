"""Beats and downbeats with the Beat This! model (Foscarin, Schlüter and Widmer, ISMIR 2024).

The beat_this package needs torchaudio for its file loader and its spectrogram, and no
torchaudio release matches the torch the worker runs, so vework uses only the package's model
and its peak picking: it decodes the track itself and computes the model's input here.
"""

import hashlib
import http.client
import inspect
import urllib.parse
from pathlib import Path

import numpy as np

from vework import download

# The authors' main model, trained on every dataset but GTZAN; MIT, like the code.
MODEL = "final0"
# The authors' file server, then a copy of the same file on downloads.fineframe.app (#155).
URLS = (
    f"https://cloud.cp.jku.at/public.php/dav/files/7ik4RrBKTS273gp/{MODEL}.ckpt",
    f"https://downloads.fineframe.app/models/beat_this-{MODEL}.ckpt",
)
SHA256 = "8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331"
# The input the model was trained on: 22.05 kHz, 1024-sample frames every 20 ms, 128 mel bands
# from 30 Hz to 11 kHz.
RATE = 22_050
FFT = 1024
HOP = 441
FPS = RATE // HOP
BANDS = 128
LOW, HIGH = 30.0, 11_000.0
# Frames the model sees at once: the 30 s excerpts it was trained on.
WINDOW = 1500
# Frames at either end of a window whose predictions are thrown away: next to a window's edge
# the model hears too little of the music around them.
EDGE = 6
# Frames on either side of a downbeat that its logit's peak is looked for in: the peak picking's
# own reach. It moves each downbeat to the nearest beat, and 99 % of the library's stay this close
# to their peak.
PEAK = 3


class Unavailable(RuntimeError):
    """No source gave the checkpoint: each one failed or served another file."""


def mel_filters() -> np.ndarray:
    """BANDS x (FFT / 2 + 1) triangular filters, unnormalised, spaced evenly on the Slaney mel
    scale (linear up to 1 kHz, logarithmic above), which the model's training front end used."""
    linear, knee = 200 / 3, 1000.0
    log_step = np.log(6.4) / 27

    def to_mel(hz: np.ndarray) -> np.ndarray:
        hz = np.asarray(hz, float)
        safe = np.maximum(hz, knee)
        return np.where(hz < knee, hz / linear, knee / linear + np.log(safe / knee) / log_step)

    def to_hz(mel: np.ndarray) -> np.ndarray:
        return np.where(
            mel < knee / linear, mel * linear, knee * np.exp(log_step * (mel - knee / linear))
        )

    bins = np.linspace(0, RATE / 2, FFT // 2 + 1)
    edges = to_hz(np.linspace(to_mel(LOW), to_mel(HIGH), BANDS + 2))
    rising = (bins - edges[:-2, None]) / np.diff(edges)[:-1, None]
    falling = (edges[2:, None] - bins) / np.diff(edges)[1:, None]
    return np.maximum(0, np.minimum(rising, falling))


def spectrogram(mono: np.ndarray):
    """The model's input from mono audio at RATE: log(1 + 1000 x mel magnitude), one row of
    BANDS per 20 ms frame, frames centred on their times, with each STFT frame's magnitude
    divided by the square root of its length."""
    import torch

    stft = torch.stft(
        torch.from_numpy(np.ascontiguousarray(mono, np.float32)), FFT, HOP,
        window=torch.hann_window(FFT), center=True, pad_mode="reflect", normalized=True,
        return_complex=True,
    )  # fmt: skip
    mel = torch.from_numpy(mel_filters().astype(np.float32)) @ stft.abs()
    return torch.log1p(1000 * mel).T


def track(mono: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Beat and downbeat times in seconds, how surely the model marks each downbeat (its
    highest downbeat logit within PEAK frames), and the spectrogram they were found in, as numpy
    (frames x BANDS), from mono audio at RATE."""
    import torch
    from beat_this.model.postprocessor import Postprocessor

    spect = spectrogram(mono)
    with torch.inference_mode():
        beat, downbeat = activations(spect, _model())
    beats, downbeats = Postprocessor(type="minimal", fps=FPS)(beat, downbeat)
    logits = downbeat.numpy()
    frames = np.round(np.asarray(downbeats) * FPS).astype(int)
    sureness = [logits[max(0, f - PEAK) : f + PEAK + 1].max() for f in frames]
    return np.asarray(beats, float), np.asarray(downbeats, float), np.array(sureness), spect.numpy()


def activations(spect, model):
    """The model's beat and downbeat logits for every frame of a track of any length.

    The model runs over windows of WINDOW frames, each keeping only its predictions away from
    its edges, so consecutive windows overlap by 2 EDGE frames. The track is padded with EDGE
    frames of silence at each end so that its first and last frames get predictions from inside
    a window too, and the last window ends at the padded end instead of running short.
    """
    import torch.nn.functional as F

    frames = len(spect)
    padded = F.pad(spect, (0, 0, EDGE, EDGE))
    step = WINDOW - 2 * EDGE
    beat = spect.new_empty(frames)
    downbeat = spect.new_empty(frames)
    for start in range(0, frames, step):
        start = min(start, max(0, frames - step))
        window = padded[start : start + WINDOW]
        out = model(window.unsqueeze(0))
        kept = len(window) - 2 * EDGE
        beat[start : start + kept] = out["beat"][0, EDGE : EDGE + kept]
        downbeat[start : start + kept] = out["downbeat"][0, EDGE : EDGE + kept]
    return beat, downbeat


def _model():
    import torch
    from beat_this.model.beat_tracker import BeatThis

    checkpoint = torch.load(_checkpoint(), map_location="cpu", weights_only=True)
    accepted = inspect.signature(BeatThis).parameters
    model = BeatThis(**{k: v for k, v in checkpoint["hyper_parameters"].items() if k in accepted})
    # The checkpoint was saved from the training wrapper, which holds the model as `model`.
    weights = {k.removeprefix("model."): v for k, v in checkpoint["state_dict"].items()}
    model.load_state_dict(weights)
    return model.eval()


def checkpoint_path() -> Path:
    """Where the checkpoint is kept once downloaded: torch's hub folder."""
    import torch

    return Path(torch.hub.get_dir()) / "checkpoints" / f"beat_this-{MODEL}.ckpt"


def _checkpoint() -> Path:
    """The checkpoint, downloaded once into torch's hub folder from the first of URLS that gives
    it, and checked against its SHA-256, so an index is reproducible."""
    path = checkpoint_path()
    if not path.exists():
        data = _download()
        path.parent.mkdir(parents=True, exist_ok=True)
        part = path.with_suffix(".part")
        part.write_bytes(data)
        part.rename(path)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if digest != SHA256:
        raise RuntimeError(f"{path}: SHA-256 {digest} is not the pinned {MODEL} checkpoint")
    return path


def _download() -> bytes:
    problems = []
    for address in URLS:
        host = urllib.parse.urlparse(address).netloc
        try:
            data = download.url(address, f"Beat This! {MODEL}")
        except (OSError, http.client.HTTPException) as error:
            problems.append(f"{host}: {error}")
            continue
        if hashlib.sha256(data).hexdigest() == SHA256:
            return data
        problems.append(f"{host}: not the pinned {MODEL} checkpoint")
    raise Unavailable("; ".join(problems))
