"""Apple silicon's GPU for the analysis, with the CPU behind it.

On a Mac whose GPU PyTorch can use (MPS), shot detection, the speech model and the aligner run
there, the denoiser runs through ONNX Runtime's Core ML provider, and shot detection and faces
decode video with VideoToolbox. A step that fails there, or whose output is NaN or empty, runs
again on the CPU by itself, and says so. Everywhere else every step runs as it did.

Where each step runs is a `vework:` line on stderr, as downloads are: the engine keeps such lines
in its log, and they are not steps of the progress the page shows.
"""

import os
import sys
from collections.abc import Callable
from typing import Any

import numpy as np

from vework import ml

ENV = "VEWORK_DEVICE"  # "cpu" keeps every step on the CPU, on a Mac too


def available() -> bool:
    """Whether this is a Mac with a GPU the analysis runs on."""
    if sys.platform != "darwin" or os.environ.get(ENV, "").lower() == "cpu":
        return False
    ml.require()
    import torch

    return torch.backends.mps.is_available()


def _say(line: str) -> None:
    print(f"vework: {line}", file=sys.stderr)


def _first_line(exc: Exception) -> str:
    """An error as one log line: Metal's compiler errors run to dozens."""
    lines = str(exc).splitlines()
    return f"{type(exc).__name__}: {lines[0] if lines else ''}"


def finite(*arrays: Any) -> bool:
    """Whether every array holds numbers, none NaN or infinite, and none is empty."""
    return all(np.size(a) and np.isfinite(a).all() for a in arrays)


class Fallback:
    """A step's model as one function, on the Mac's GPU until it fails there, then on the CPU.

    `load(gpu)` returns the model's function: on the GPU when `gpu` is true, otherwise where the
    step runs without the Mac's GPU. It is loaded on the first call. When loading it on the GPU,
    calling it there or checking its result with `valid` fails, that call and every later one
    run on the CPU. Each step says where it runs, on a Mac only.
    """

    def __init__(
        self,
        step: str,
        load: Callable[[bool], Callable],
        valid: Callable[[Any], bool] = lambda result: True,
        backend: str = "MPS",
    ) -> None:
        self.step, self.load, self.valid = step, load, valid
        self.backend = backend
        self.on_gpu = available()
        self.run: Callable | None = None

    def __call__(self, *args):
        if self.on_gpu:
            try:
                if self.run is None:
                    self.run = self.load(True)
                    _say(f"{self.step}: on the GPU ({self.backend})")
                result = self.run(*args)
                if self.valid(result):
                    return result
                problem = "its output was NaN or empty"
            except Exception as exc:
                problem = _first_line(exc)
            self.fail(problem)
        if self.run is None:
            self.run = self.load(False)
        return self.run(*args)

    def fail(self, problem: str) -> None:
        """Move this step to the CPU, saying why."""
        _say(f"{self.step}: failed on the GPU ({problem}); running it on the CPU")
        self.on_gpu, self.run = False, None


def decode[T](step: str, attempt: Callable[[Any], T]) -> T:
    """Run `attempt(hwaccel)` with VideoToolbox decoding on a Mac whose GPU the analysis uses,
    and again with software decoding (`hwaccel` None) if that fails; elsewhere only the latter.
    On a Mac, it says which decoded the video."""
    import av.codec.hwaccel

    if not available() or "videotoolbox" not in av.codec.hwaccel.hwdevices_available():
        return attempt(None)
    _say(f"{step}: decoding video with VideoToolbox")
    try:
        # No silent software fallback inside the decoder: a codec VideoToolbox cannot decode
        # fails here and is decoded in software below, so the log says what decoded it.
        return attempt(av.codec.hwaccel.HWAccel("videotoolbox", allow_software_fallback=False))
    except Exception as exc:
        _say(
            f"{step}: decoding with VideoToolbox failed ({_first_line(exc)}); decoding in software"
        )
    return attempt(None)
