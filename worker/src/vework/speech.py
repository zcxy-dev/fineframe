import warnings

import numpy as np

from vework import ml
from vework.audio import RATE


def segments(samples: np.ndarray, rate: int = RATE) -> list[dict]:
    """Stretches of speech in 16 kHz mono audio, from Silero VAD.

    The editor reads the gaps between them as pauses; breaths and laughter stay outside
    speech, so a cut there does not clip a word.
    """
    ml.require()
    import torch
    from silero_vad import get_speech_timestamps, load_silero_vad

    with warnings.catch_warnings():
        # Silero ships a TorchScript model, which torch now flags as deprecated on every load.
        warnings.simplefilter("ignore", FutureWarning)
        model = load_silero_vad()
    found = get_speech_timestamps(
        torch.from_numpy(samples),
        model,
        sampling_rate=rate,
        min_silence_duration_ms=100,
        speech_pad_ms=30,
    )
    # Sample positions, not return_seconds: that rounds to 0.1 s and can cut into a word.
    return [{"start": s["start"] / rate, "end": s["end"] / rate} for s in found]
