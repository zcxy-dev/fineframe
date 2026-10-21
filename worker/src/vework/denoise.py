import hashlib
import io
import os
import shutil
import tarfile
from collections.abc import Callable
from functools import cache
from pathlib import Path

import numpy as np
from scipy.signal import lfilter

from vework import download, gpu, ml

MODEL = "DeepFilterNet3"
# The model's ONNX export, pinned by commit and checked by hash. Its own Python package cannot be
# installed beside this worker (it needs numpy<2 and has no Python 3.12 wheel of its Rust
# extension), so the features it feeds the model and the resynthesis are computed here.
COMMIT = "d375b2d8309e0935d165700c91da9de862a99c31"
URL = f"https://raw.githubusercontent.com/Rikorose/DeepFilterNet/{COMMIT}/models/DeepFilterNet3_onnx.tar.gz"
SHA256 = "c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616"
PARTS = ("enc", "erb_dec", "df_dec")

# The model's config.ini.
RATE = 48_000
FFT = 960
HOP = 480
ERB_BANDS = 32
DF_BINS = 96  # the lowest bins, up to 4.8 kHz, are deep-filtered; the rest only masked
DF_ORDER = 5
LOOKAHEAD = 2  # frames, of the convolutions and of the deep filter
# Exponential normalisation over about a second (norm_tau = 1), rounded as the model was trained.
ALPHA = 0.99
MEAN_INIT = (-60.0, -90.0)
UNIT_INIT = (0.001, 0.0001)

# Frames (15 s) per model run, so memory does not grow with the source: ONNX Runtime's working
# memory grows with the run, to about 0.75 GB at this size and 1.8 GB at four times it, at no gain
# in speed.
CHUNK = 1_500
# Frames the model hears before each chunk. Its recurrent state never quite forgets, so two
# chunks' results still differ by about -35 dB where they meet; the last BLEND frames of one
# cross-fade into the next so that no step is left between them.
WARMUP = 500
BLEND = 100


def _erb_widths() -> np.ndarray:
    """FFT bins per ERB band, as the model was trained with."""

    def to_erb(hz: float) -> float:
        return 9.265 * np.log1p(hz / (24.7 * 9.265))

    def to_hz(erb: float) -> float:
        return 24.7 * 9.265 * (np.exp(erb / 9.265) - 1)

    step = to_erb(RATE // 2) / ERB_BANDS
    widths, previous, borrowed = [], 0, 0
    for band in range(1, ERB_BANDS + 1):
        edge = round(to_hz(band * step) / (RATE / FFT))
        width = edge - previous - borrowed
        # At least two bins per band; the bins taken count against the next band.
        borrowed = max(2 - width, 0)
        widths.append(max(width, 2))
        previous = edge
    widths[-1] += FFT // 2 + 1 - sum(widths)
    return np.array(widths)


WIDTHS = _erb_widths()
BAND_OF_BIN = np.repeat(np.arange(ERB_BANDS), WIDTHS)
# Vorbis window: its square overlap-adds to one at 50 % overlap, so analysis and resynthesis
# give the input back exactly, HOP samples later.
WINDOW = np.sin(0.5 * np.pi * np.sin(np.pi * (np.arange(FFT) + 0.5) / FFT) ** 2)


def enhance(samples: np.ndarray, in_place: bool = False) -> np.ndarray:
    """Remove noise from 48 kHz mono audio with DeepFilterNet3, keeping its length and timing.

    Every sample of the result lines up with the input's: the transform's delay is taken out.
    `in_place` writes the result over float32 `samples`, so a long source is not held twice: the
    result only ever replaces samples that every frame still to come has finished reading.
    """
    if not len(samples):
        return samples.astype(np.float32)
    run = gpu.Fallback("denoising", _model, lambda found: gpu.finite(*found), backend="Core ML")
    # The resynthesis lags the input by HOP samples; the padding lets it finish the last ones.
    frames = (len(samples) + FFT) // HOP
    out = samples if in_place else np.zeros(len(samples), np.float32)
    features = _Features(samples, frames)
    overlap = np.zeros(HOP)
    held = np.zeros((0, FFT // 2 + 1), np.complex64)  # the last chunk's frames to blend from
    for start in range(0, frames, CHUNK):
        end = min(start + CHUNK, frames)
        first = max(start - WARMUP, 0)
        begin = start - len(held)  # this chunk's frames start here, under the held ones
        spec, erb, cplx = features.get(first - DF_ORDER, end + LOOKAHEAD)
        # The model reads LOOKAHEAD frames ahead: frame t is given the features of t + LOOKAHEAD.
        at = DF_ORDER  # where `first` sits in the arrays
        gains, coefs = run(
            erb[at + LOOKAHEAD : at + LOOKAHEAD + end - first],
            cplx[at + LOOKAHEAD : at + LOOKAHEAD + end - first],
        )
        gains, coefs = gains[begin - first :], coefs[begin - first :]
        lo = at + begin - first  # where `begin` sits in spec
        count = end - begin
        enhanced = spec[lo : lo + count] * gains[:, BAND_OF_BIN]
        # Deep filtering: each low bin is a complex mix of the noisy frames around it, from
        # LOOKAHEAD before to LOOKAHEAD after.
        low = np.zeros((count, DF_BINS), np.complex64)
        for k in range(DF_ORDER):
            offset = lo + k - (DF_ORDER - 1 - LOOKAHEAD)
            low += spec[offset : offset + count, :DF_BINS] * coefs[:, :, k]
        enhanced[:, :DF_BINS] = low
        weight = ((np.arange(len(held)) + 0.5) / BLEND)[:, None]
        enhanced[: len(held)] = held * (1 - weight) + enhanced[: len(held)] * weight
        if end < frames:
            held, enhanced = enhanced[-BLEND:], enhanced[:-BLEND]
        pieces = np.fft.irfft(enhanced, n=FFT, axis=1) * FFT * WINDOW
        blocks = pieces[:, :HOP] + np.concatenate([overlap[None], pieces[:-1, HOP:]])
        overlap = pieces[-1, HOP:]
        # Frame t's first half covers input samples [(t - 1) * HOP, t * HOP).
        lo_sample = (begin - 1) * HOP
        flat = blocks.reshape(-1)
        if lo_sample < 0:
            flat, lo_sample = flat[-lo_sample:], 0
        flat = flat[: max(len(samples) - lo_sample, 0)]
        out[lo_sample : lo_sample + len(flat)] = flat
    return out


class _Features:
    """The spectrum and the model's features, computed in order and kept only as long as needed.

    The normalisations run through the whole source, so a chunk's features depend on every
    frame before it; computing them once, in order, keeps them exact without holding the source's
    whole spectrum.
    """

    def __init__(self, samples: np.ndarray, frames: int):
        self.samples, self.frames = samples, frames
        self.first = self.next = 0
        self.spec = np.zeros((0, FFT // 2 + 1), np.complex64)
        self.erb = np.zeros((0, ERB_BANDS), np.float32)
        self.cplx = np.zeros((0, DF_BINS), np.complex64)
        self.erb_state = ALPHA * np.linspace(*MEAN_INIT, ERB_BANDS)
        self.unit_state = ALPHA * np.linspace(*UNIT_INIT, DF_BINS)

    def get(self, lo: int, hi: int) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """Frames [lo, hi), zero outside the source's frames."""
        if hi > self.next:
            self._compute(min(hi, self.frames))
        # Frames before lo are never asked for again.
        drop = max(lo, 0) - self.first
        if drop > 0:
            self.spec, self.erb, self.cplx = self.spec[drop:], self.erb[drop:], self.cplx[drop:]
            self.first += drop

        def window(array: np.ndarray) -> np.ndarray:
            out = np.zeros((hi - lo, array.shape[1]), array.dtype)
            a, b = max(lo, self.first), min(hi, self.next)
            out[a - lo : b - lo] = array[a - self.first : b - self.first]
            return out

        return window(self.spec), window(self.erb), window(self.cplx)

    def _compute(self, hi: int) -> None:
        lo = self.next
        # Frame t windows input samples [(t - 1) * HOP, (t + 1) * HOP), zeros outside the input.
        start, stop = (lo - 1) * HOP, (hi + 1) * HOP
        audio = np.zeros(stop - start)
        a, b = max(start, 0), min(stop, len(self.samples))
        if b > a:
            audio[a - start : b - start] = self.samples[a:b]
        frames = np.lib.stride_tricks.sliding_window_view(audio, FFT)[::HOP][: hi - lo]
        # The forward transform is scaled so that the unscaled inverse returns the input.
        spec = np.fft.rfft(frames * WINDOW, axis=1) / FFT * 2 * HOP / FFT
        power = np.abs(spec) ** 2
        erb = np.zeros((hi - lo, ERB_BANDS))
        np.add.at(erb.T, BAND_OF_BIN, power.T)
        erb = 10 * np.log10(erb / WIDTHS + 1e-10)
        # state = x * (1 - alpha) + state * alpha, frame by frame: a one-pole filter over time.
        mean, self.erb_state = _smooth(erb, self.erb_state)
        magnitude = np.abs(spec[:, :DF_BINS])
        unit, self.unit_state = _smooth(magnitude, self.unit_state)
        self.spec = np.concatenate([self.spec, spec.astype(np.complex64)])
        self.erb = np.concatenate([self.erb, ((erb - mean) / 40).astype(np.float32)])
        # Long digital silence decays the state towards zero; the floor keeps 0 / 0 out.
        cplx = spec[:, :DF_BINS] / np.sqrt(np.maximum(unit, 1e-30))
        self.cplx = np.concatenate([self.cplx, cplx.astype(np.complex64)])
        self.next = hi


def _smooth(x: np.ndarray, state: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The exponential normalisation state for each frame, and the state after the last."""
    smoothed, final = lfilter([1 - ALPHA], [1, -ALPHA], x, axis=0, zi=state[None] * ALPHA)
    return smoothed, final[0] / ALPHA


@cache
def _model(
    apple_gpu: bool = False,
) -> Callable[[np.ndarray, np.ndarray], tuple[np.ndarray, np.ndarray]]:
    """Load the three ONNX parts: features in, ERB gains and deep-filter coefficients out. With
    `apple_gpu`, Core ML runs them on the Mac's GPU in 32-bit floats, and ONNX Runtime's CPU
    provider any node Core ML cannot."""
    ml.require()
    import onnxruntime

    providers = ["CPUExecutionProvider"]
    if apple_gpu:
        coreml = {"MLComputeUnits": "CPUAndGPU", "ModelFormat": "MLProgram"}
        providers.insert(0, ("CoreMLExecutionProvider", coreml))
    folder = _download()
    try:
        enc, erb_dec, df_dec = (
            onnxruntime.InferenceSession(str(folder / f"{part}.onnx"), providers=providers)
            for part in PARTS
        )
    except Exception as exc:
        raise RuntimeError(f"{MODEL}: {exc}") from exc

    def run(erb: np.ndarray, cplx: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        spec = np.stack([cplx.real, cplx.imag])[None].astype(np.float32)
        try:
            e0, e1, e2, e3, emb, c0, _ = enc.run(
                None, {"feat_erb": erb[None, None], "feat_spec": spec}
            )
            (gains,) = erb_dec.run(None, {"emb": emb, "e3": e3, "e2": e2, "e1": e1, "e0": e0})
            coefs = df_dec.run(None, {"emb": emb, "c0": c0})[0][0]
        except Exception as exc:
            raise RuntimeError(f"{MODEL}: {exc}") from exc
        # [frames, bins, order * 2] with real and imaginary parts interleaved.
        coefs = coefs.reshape(len(erb), DF_BINS, DF_ORDER, 2)
        return gains[0, 0], coefs[..., 0] + 1j * coefs[..., 1]

    return run


def _download() -> Path:
    """The model's folder in the cache, downloading and checking the archive on first use."""
    cache_home = Path(os.environ.get("XDG_CACHE_HOME") or Path.home() / ".cache")
    folder = cache_home / "video-editor" / f"deepfilternet3-{SHA256[:12]}"
    if all((folder / f"{part}.onnx").is_file() for part in PARTS):
        return folder
    try:
        archive = download.url(URL, MODEL)
    except OSError as exc:
        raise RuntimeError(f"{MODEL}: could not download {URL}: {exc}") from exc
    if hashlib.sha256(archive).hexdigest() != SHA256:
        raise RuntimeError(f"{MODEL}: {URL} does not match its pinned SHA-256")
    folder.mkdir(parents=True, exist_ok=True)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for member in tar.getmembers():
            name = Path(member.name).name
            if member.isfile() and name in {f"{part}.onnx" for part in PARTS}:
                data = tar.extractfile(member).read()
                partial = folder / f"{name}.partial"
                partial.write_bytes(data)
                partial.rename(folder / name)
    # A folder an earlier pin left is never read again.
    for old in folder.parent.glob("deepfilternet3-*"):
        if old != folder:
            shutil.rmtree(old, ignore_errors=True)
    return folder
