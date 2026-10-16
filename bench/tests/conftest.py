import importlib.util
import subprocess

import imageio_ffmpeg
import pytest


def pytest_collection_modifyitems(items):
    if importlib.util.find_spec("kokoro") is None:
        skip = pytest.mark.skip(reason="needs the synth extra (uv sync --extra synth)")
        for item in items:
            if "synth" in item.keywords:
                item.add_marker(skip)


def ffmpeg(*args):
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-y", *args], check=True)
