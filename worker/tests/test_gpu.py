import shutil
import subprocess
import sys
from types import SimpleNamespace

import av
import numpy as np
import pytest
from conftest import ffmpeg
from test_voice import vowels

from vework import denoise, framing, gpu, index, probe, shots, transcribe


def on_mac_gpu(monkeypatch, on=True):
    monkeypatch.setattr(gpu, "available", lambda: on)


def loader(gpu_run, cpu_run, loaded):
    def load(on):
        loaded.append(on)
        return gpu_run if on else cpu_run

    return load


def test_a_step_that_fails_on_the_gpu_runs_on_the_cpu_from_then_on_and_says_why(monkeypatch):
    on_mac_gpu(monkeypatch)

    def broken(x):
        raise RuntimeError("MPS backend out of memory")

    lines, loaded = [], []
    step = gpu.Fallback("shot detection", lines.append, loader(broken, lambda x: x + 1, loaded))
    assert step(1) == 2 and step(2) == 3
    assert loaded == [True, False]
    assert lines == [
        "shot detection: on the GPU (MPS)",
        "shot detection: failed on the GPU (RuntimeError: MPS backend out of memory); "
        "running it on the CPU",
    ]


def test_nan_or_empty_output_on_the_gpu_counts_as_a_failure(monkeypatch):
    on_mac_gpu(monkeypatch)
    for bad in (np.array([0.5, np.nan]), np.array([])):
        lines, loaded = [], []
        step = gpu.Fallback(
            "denoising",
            lines.append,
            loader(lambda bad=bad: bad, lambda: np.array([0.5]), loaded),
            gpu.finite,
            backend="Core ML",
        )
        assert step().tolist() == [0.5]
        assert lines[-1] == (
            "denoising: failed on the GPU (its output was NaN or empty); running it on the CPU"
        )


def test_a_step_that_works_on_the_gpu_stays_there(monkeypatch):
    on_mac_gpu(monkeypatch)
    lines, loaded = [], []
    step = gpu.Fallback("aligner", lines.append, loader(lambda x: x * 2, None, loaded))
    assert [step(1), step(2)] == [2, 4]
    assert loaded == [True] and lines == ["aligner: on the GPU (MPS)"]


def test_without_the_macs_gpu_nothing_changes_and_nothing_is_said(monkeypatch):
    on_mac_gpu(monkeypatch, on=False)
    lines, loaded = [], []
    step = gpu.Fallback("aligner", lines.append, loader(None, lambda x: x, loaded))
    assert step(1) == 1 and loaded == [False] and lines == []
    assert gpu.decode("faces", lines.append, lambda hwaccel: hwaccel) is None and lines == []


def test_the_cpu_is_chosen_on_a_mac_by_the_environment(monkeypatch):
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setenv(gpu.ENV, "cpu")
    assert not gpu.available()


def test_video_videotoolbox_cannot_decode_is_decoded_in_software(monkeypatch):
    on_mac_gpu(monkeypatch)
    monkeypatch.setattr(av.codec.hwaccel, "hwdevices_available", lambda: ["videotoolbox"])
    tried, lines = [], []

    def attempt(hwaccel):
        tried.append(hwaccel)
        if hwaccel is not None:
            raise av.error.FFmpegError(1, "no hardware decoder")
        return "decoded"

    assert gpu.decode("faces", lines.append, attempt) == "decoded"
    assert isinstance(tried[0], av.codec.hwaccel.HWAccel) and tried[1] is None
    assert lines[0] == "faces: decoding video with VideoToolbox"
    assert lines[1].startswith("faces: decoding with VideoToolbox failed (FFmpegError:")
    assert lines[1].endswith("); decoding in software")


def test_a_speech_model_that_hears_nothing_on_the_gpu_hears_it_all_again_on_the_cpu(monkeypatch):
    on_mac_gpu(monkeypatch)
    heard = {True: ("", None), False: ("大家", "Chinese")}
    monkeypatch.setattr(transcribe, "_recognizer", lambda model, on: lambda wav, context: heard[on])
    monkeypatch.setattr(
        transcribe,
        "_aligner",
        lambda half, on: lambda wav, text: [("大", 0.1, 0.3), ("家", 0.3, 0.5)],
    )
    lines = []
    samples = np.zeros(16_000, np.float32)
    found = transcribe.transcribe(samples, [{"start": 0.05, "end": 0.6}], progress=lines.append)
    assert [w["text"] for w in found["words"]] == ["大", "家"]
    assert (
        "speech model: failed on the GPU (it heard nothing in any chunk); running it on the CPU"
        in lines
    )
    assert lines.count("transcribing 1/1") == 2


@pytest.fixture
def mac_gpu():
    """Skips unless this Mac's GPU runs the analysis, which needs the ml group to tell."""
    if not gpu.available():
        pytest.skip("needs a Mac whose GPU PyTorch can use (MPS)")
    if "videotoolbox" not in av.codec.hwaccel.hwdevices_available():
        pytest.skip("needs a PyAV whose FFmpeg has VideoToolbox")


def decoded(path, hwaccel):
    with av.open(str(path), hwaccel=hwaccel) as container:
        return [(f.time, f.width, f.height) for f in container.decode(container.streams.video[0])]


@pytest.mark.ml
def test_videotoolbox_decodes_the_frames_software_does_at_their_times(mac_gpu, shots_video):
    accel = av.codec.hwaccel.HWAccel("videotoolbox", allow_software_fallback=False)
    assert decoded(shots_video, accel) == decoded(shots_video, None)
    software, hardware = [], []
    thumbs = [list(shots.thumbnails(shots_video, times, hwaccel=h)) for times, h in
              ((software, None), (hardware, accel))]  # fmt: skip
    assert len(thumbs[0]) == len(thumbs[1]) == 300 and hardware == software
    assert {(t.shape, t.dtype) for t in thumbs[0] + thumbs[1]} == {((27, 48, 3), np.uint8)}
    video = probe.probe(shots_video).video
    samples = [
        [(t, image.shape, image.dtype) for t, image, _ in framing.sampled_frames(
            shots_video, video, [], h)]
        for h in (None, accel)
    ]  # fmt: skip
    assert samples[0] == samples[1]


@pytest.mark.ml
def test_shots_found_on_the_gpu_are_the_cpus(mac_gpu, shots_video, monkeypatch):
    lines = []
    found = shots.detect(shots_video, lines.append)
    assert "shot detection: on the GPU (MPS)" in lines
    assert "shot detection: decoding video with VideoToolbox" in lines
    assert not any("failed" in line for line in lines)
    monkeypatch.setenv(gpu.ENV, "cpu")
    assert found == shots.detect(shots_video)


@pytest.mark.ml
def test_the_denoiser_on_the_gpu_removes_what_the_cpu_does(mac_gpu, monkeypatch):
    noisy, _, _ = vowels(8.0, [1.0, 3.0, 5.0])
    lines = []
    on_gpu = denoise.enhance(noisy, progress=lines.append)
    assert lines == ["denoising: on the GPU (Core ML)"]
    monkeypatch.setenv(gpu.ENV, "cpu")
    cpu = denoise.enhance(noisy)
    # Within 60 dB of the speech: the GPU's 32-bit floats round differently, nothing more.
    assert np.sqrt(np.mean((on_gpu - cpu) ** 2)) < 1e-3 * np.sqrt(np.mean(cpu**2))


@pytest.fixture
def spoken_video(tmp_path):
    """Four seconds of the system's voice over a test pattern, from macOS's `say`."""
    if shutil.which("say") is None:
        pytest.skip("needs macOS's say")
    voice, out = tmp_path / "voice.aiff", tmp_path / "talk.mp4"
    subprocess.run(["say", "-o", str(voice), "Hello everyone. Today we look at a new camera."],
                   check=True)  # fmt: skip
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=320x180:r=30:d=6", "-i", str(voice), "-af",
           "adelay=500:all=1,apad", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
           "-t", "6", str(out))  # fmt: skip
    return out


@pytest.mark.ml
def test_an_analysis_on_the_mac_says_where_each_step_ran(mac_gpu, spoken_video, tmp_path):
    # The words come from a stand-in for cloud speech, so the aligner is the only speech model;
    # its timings on the GPU are what the editor cuts by.
    text = "Hello everyone. Today we look at a new camera."
    cloud = SimpleNamespace(
        recognize=lambda wavs, progress: [(text, "English")] + [("", None)] * (len(wavs) - 1),
        cost=0.0,
        model="stand-in",
    )
    lines = []
    found = index.build(spoken_video, progress=lines.append, stem=tmp_path / "talk.voice.wav",
                        cloud=cloud)  # fmt: skip
    print("\n".join(f"vework: {line}" for line in lines))
    for said in (
        "shot detection: on the GPU (MPS)",
        "shot detection: decoding video with VideoToolbox",
        "faces: decoding video with VideoToolbox",
        "denoising: on the GPU (Core ML)",
        "aligner: on the GPU (MPS)",
    ):
        assert said in lines
    assert not any("failed" in line for line in lines)
    words = found["transcript"]["words"]
    assert [w["text"] for w in words][:2] == ["Hello", "everyone."]
    voiced = found["speech"]
    for word in words:
        assert word["start"] < word["end"]
        assert any(s["start"] - 0.05 <= word["start"] and word["end"] <= s["end"] + 0.05
                   for s in voiced)  # fmt: skip
