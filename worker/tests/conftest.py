import importlib.util
import os
import subprocess
import urllib.error
import urllib.request

import imageio_ffmpeg
import numpy as np
import pytest


def pytest_collection_modifyitems(items):
    if importlib.util.find_spec("torch") is None:
        skip = pytest.mark.skip(reason="needs the ml group (uv sync)")
        for item in items:
            if "ml" in item.keywords:
                item.add_marker(skip)
    elif any("beats" in item.keywords for item in items) and (why := _beats_unreachable()):
        skip = pytest.mark.skip(reason=why)
        for item in items:
            if "beats" in item.keywords:
                item.add_marker(skip)
    # Real API calls cost money and need your own key, so CI never makes them.
    if not os.environ.get("ANTHROPIC_API_KEY"):
        skip = pytest.mark.skip(reason="needs ANTHROPIC_API_KEY (uv run --env-file ../.env)")
        for item in items:
            if "claude" in item.keywords:
                item.add_marker(skip)


def _beats_unreachable() -> str | None:
    """Why the Beat This! checkpoint cannot be had: not cached, and none of its hosts answering
    or each failing on its side (#155). Asked once per run; any other answer lets the tests run,
    and fail if the download or its checksum is wrong."""
    from vework import beats

    if beats.checkpoint_path().exists():
        return None
    problems = []
    for address in beats.URLS:
        request = urllib.request.Request(address, headers={"Range": "bytes=0-0"})
        try:
            with urllib.request.urlopen(request, timeout=30):
                return None
        except urllib.error.HTTPError as error:
            if error.code < 500:
                return None
            problems.append(f"HTTP {error.code}")
        except OSError as error:
            problems.append(str(getattr(error, "reason", error)))
    return f"the Beat This! checkpoint is not cached and its hosts failed ({'; '.join(problems)})"


def ffmpeg(*args):
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-y", *args], check=True)


def tone(*spans, length=3.0, rate=16_000):
    """16 kHz audio: a 220 Hz tone in each (start, end) span, or (start, end, gain) for a quieter
    one, over a faint noise floor, like a room."""
    t = np.arange(int(length * rate)) / rate
    noise = np.random.default_rng(0).normal(0, 1e-4, len(t))
    gain = np.zeros(len(t))
    for start, end, *level in spans:
        gain[(t >= start) & (t < end)] = level[0] if level else 0.5
    return (gain * np.sin(2 * np.pi * 220 * t) + noise).astype(np.float32)


@pytest.fixture(scope="session")
def shots_video(tmp_path_factory):
    """Hard cuts at 3.0 s and 6.0 s, then a one-second dissolve from 8.0 s to 9.0 s."""
    out = tmp_path_factory.mktemp("media") / "shots.mp4"
    sources = [
        "testsrc2=s=320x180:r=30:d=3",
        "mandelbrot=s=320x180:r=30,trim=duration=3",
        "life=s=320x180:r=30:mold=10:ratio=0.1:life_color=#00ff00,trim=duration=3",
        "cellauto=s=320x180:r=30:rule=110,trim=duration=4",
    ]
    inputs = [arg for s in sources for arg in ("-f", "lavfi", "-i", s)]
    graph = (
        "".join(f"[{i}:v]format=yuv420p,setsar=1[s{i}];" for i in range(4))
        + "[s2][s3]xfade=transition=fade:duration=1:offset=2[x];"
        + "[s0][s1][x]concat=n=3:v=1:a=0[v]"
    )
    ffmpeg(*inputs, "-filter_complex", graph, "-map", "[v]", "-c:v", "libx264",
           "-preset", "ultrafast", "-r", "30", str(out))  # fmt: skip
    return out


@pytest.fixture
def cover_art_audio(tmp_path):
    """An m4a whose only picture is attached cover art."""
    cover, out = tmp_path / "cover.png", tmp_path / "song.m4a"
    ffmpeg("-f", "lavfi", "-i", "color=c=red:s=64x64:d=1", "-frames:v", "1", str(cover))
    tone = "sine=f=440:d=2:sample_rate=48000"
    ffmpeg("-f", "lavfi", "-i", tone, "-i", str(cover), "-map", "0", "-map", "1",
           "-c:a", "aac", "-c:v", "png", "-disposition:v", "attached_pic", str(out))  # fmt: skip
    return out


@pytest.fixture
def no_credentials(monkeypatch, tmp_path):
    """No key in the environment and no `ant auth login` profile on disk."""
    for name in ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_PROFILE",
                 "ANTHROPIC_CONFIG_DIR", "ANTHROPIC_FEDERATION_RULE_ID",
                 "ANTHROPIC_IDENTITY_TOKEN", "ANTHROPIC_IDENTITY_TOKEN_FILE"):  # fmt: skip
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("HOME", str(tmp_path))
