import subprocess
from pathlib import Path

import imageio_ffmpeg
import numpy as np

RATE = 48_000
# A cut clicks when its sharpest jump is this many times the audio around it.
CLICK = 4.0


def _ffmpeg(*args: str) -> subprocess.CompletedProcess:
    # The ffmpeg program rather than the PyAV library the worker decodes with, so a decoding bug
    # in the pipeline being scored cannot hide in its own score.
    return subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), *args], capture_output=True)


def decode_audio(path: Path, rate: int = RATE) -> np.ndarray:
    """Decode the first audio stream to mono float32 at `rate`, starting at the file's zero.

    Gaps and a late start are filled with silence from the stream's timestamps, so audio that
    starts behind the picture lengthens the decode instead of being dropped.
    """
    if not path.is_file():
        raise FileNotFoundError(f"{path}: no such file")
    if b"Audio:" not in _ffmpeg("-i", str(path)).stderr:
        raise ValueError(f"{path.name}: no audio stream")
    proc = _ffmpeg("-v", "error", "-i", str(path), "-map", "0:a:0", "-ac", "1",
                   "-af", f"aresample={rate}:async=1:first_pts=0", "-f", "f32le", "-")  # fmt: skip
    if proc.returncode:
        detail = proc.stderr.decode(errors="replace").strip().splitlines()[-1:]
        raise RuntimeError(f"{path.name}: ffmpeg could not decode the audio: {''.join(detail)}")
    return np.frombuffer(proc.stdout, dtype=np.float32)


def video_seconds(path: Path) -> float | None:
    """End of the first video stream: the latest packet pts + duration, without decoding.

    The last packet in decode order is not the last frame shown when B-frames reorder them.
    Returns None when the file has no video frames.
    """
    proc = _ffmpeg(
        "-v", "error", "-i", str(path), "-map", "0:v:0?", "-c", "copy", "-f", "framecrc", "-"
    )
    lines = proc.stdout.decode().splitlines()
    # With no video stream, ffmpeg ignores the optional map and picks the audio instead.
    if "#media_type 0: video" not in lines:
        return None
    tb = next(line.split(":")[1].strip() for line in lines if line.startswith("#tb 0:"))
    num, den = (int(x) for x in tb.split("/"))
    packets = [line.split(",") for line in lines if line and not line.startswith("#")]
    end = max((int(p[2]) + int(p[3]) for p in packets), default=None)
    return end * num / den if end is not None else None


def click_ratios(
    samples: np.ndarray, rate: int, cuts: list[float], window: float = 0.005, context: float = 0.1
) -> list[float]:
    """Score each cut by how far its sharpest sample-to-sample jump exceeds its surroundings.

    A hard splice between waveforms that don't line up shows up as a second-difference spike
    far above the neighboring audio.
    """
    d2 = np.abs(np.diff(samples.astype(np.float64), n=2))
    w, c = int(window * rate), int(context * rate)
    ratios = []
    for t in cuts:
        i = int(t * rate)
        lo, hi = max(i - w, 0), min(i + w, len(d2))
        if lo >= hi:
            ratios.append(0.0)
            continue
        peak = d2[lo:hi].max()
        around = np.concatenate([d2[max(i - c, 0) : lo], d2[hi : i + c]])
        base = np.percentile(around, 99) if around.size else 0.0
        # Near-silence has no usable baseline; the floor keeps jumps below about -48 dBFS
        # (4x the floor) from counting as clicks.
        ratios.append(float(peak / max(base, 1e-3)))
    return ratios


def compare(
    samples: np.ndarray,
    rate: int,
    cuts: list[float],
    video: float | None = None,
    threshold: float = CLICK,
) -> dict:
    """Clicks at `cuts` (seconds) and the A/V drift of one rendered edit.

    A cut counts as a click when its sharpest jump exceeds `threshold` times the 99th percentile
    of the audio around it. `drift_ms` is positive when the audio ends after the picture.
    """
    duration = len(samples) / rate
    outside = [t for t in cuts if not 0 <= t <= duration]
    if outside:
        listed = ", ".join(f"{t:g}" for t in outside)
        raise ValueError(f"cuts outside the {duration:.2f} s media: {listed}")
    ratios = click_ratios(samples, rate, cuts)
    flagged = [round(t, 3) for t, r in zip(cuts, ratios, strict=True) if r > threshold]
    # Container headers can claim matching durations while the decoded audio is longer:
    # stream-copy concat keeps each segment's encoder padding, pushing audio behind video.
    drift = (duration - video) * 1000 if video is not None else None
    return {"cuts": len(cuts), "clicks": len(flagged), "flagged_at": flagged, "drift_ms": drift}


def check(media: Path, cuts: list[float], voice: Path | None = None) -> dict:
    """Clicks at `cuts` and the A/V drift of `media`. With music under the edit, a hit of the
    music that lands on a cut reads as a click, so `voice`, the render's sound without the
    music, is where the clicks are counted when it is given."""
    result = compare(decode_audio(media), RATE, cuts, video_seconds(media))
    if voice is not None:
        clicks = compare(decode_audio(voice), RATE, cuts)
        result.update(clicks=clicks["clicks"], flagged_at=clicks["flagged_at"])
    return result


def summarize(comparisons: list[dict]) -> dict:
    """Pool clicks over every cut, and report the worst drift of any single edit."""
    cuts = sum(c["cuts"] for c in comparisons)
    clicks = sum(c["clicks"] for c in comparisons)
    drifts = [abs(c["drift_ms"]) for c in comparisons if c["drift_ms"] is not None]
    return {
        "cuts": cuts,
        "clicks": clicks,
        "click_rate": clicks / cuts if cuts else None,
        "max_abs_drift_ms": max(drifts, default=None),
    }
