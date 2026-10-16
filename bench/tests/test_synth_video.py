import subprocess

import imageio_ffmpeg
import numpy as np
import pytest

pytest.importorskip("PIL", reason="needs the synth extra (uv sync --extra synth)")

from vebench.synth.layout import RATE, Layout, transitions  # noqa: E402
from vebench.synth.script import Clip  # noqa: E402
from vebench.synth.video import render  # noqa: E402


def decode(path, size="64x36"):
    """Small grayscale frames, as players show them (rotation applied)."""
    out = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-i", str(path), "-vf",
         f"scale={size}", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        check=True, capture_output=True,
    ).stdout  # fmt: skip
    w, h = map(int, size.split("x"))
    return np.frombuffer(out, np.uint8).reshape(-1, h, w).astype(np.float32)


def shot(view, frame, dissolve=0, text=()):
    return {"view": view, "frame": frame, "dissolve": dissolve, "text": list(text)}


def test_picture_changes_exactly_where_the_shot_truth_says(tmp_path):
    clip = Clip("t", "t", "multicam", 25, (), speakers=("A", "B"))
    tone = 0.3 * np.sin(2 * np.pi * 150 * np.arange(4 * RATE) / RATE).astype(np.float32)
    shots = [shot("wide", 0), shot("a", 25), shot("terminal", 50), shot("b", 70, dissolve=10)]
    plan = Layout(4.0, {"A": tone, "B": np.zeros_like(tone)}, [], {}, shots)
    render(clip, plan, tmp_path / "x.mp4", seed=0)

    frames = decode(tmp_path / "x.mp4")
    assert len(frames) == 100
    change = np.abs(np.diff(frames, axis=0)).mean(axis=(1, 2))  # change[k]: frame k to k + 1
    cuts = [round(t["start"] * 25) for t in transitions(shots, 25) if t["start"] == t["end"]]
    assert cuts == [25, 50]
    steady = np.median(change)
    for k in cuts:
        assert change[k - 1] > 10 * steady + 2
    # A dissolve spreads the change over its frames instead of one jump.
    assert change[69:80].max() < change[24] and change[69:80].sum() > change[24]


def test_portrait_footage_is_stored_sideways_and_displays_upright(tmp_path):
    clip = Clip("p", "p", "phone", 30, (), portrait=True, speakers=("B",))
    plan = Layout(1.0, {"B": np.zeros(RATE, np.float32)}, [], {}, [shot("street", 0)])
    render(clip, plan, tmp_path / "p.mp4", seed=0)
    info = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-i", str(tmp_path / "p.mp4")],
        capture_output=True, text=True,
    ).stderr  # fmt: skip
    assert "1280x720" in info and "rotation of 90" in info
    frame = decode(tmp_path / "p.mp4", "36x64")[0]
    # Sky at the top of the displayed picture, street at the bottom.
    assert frame[:8].mean() > frame[-8:].mean()
