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


def said(capsys):
    return capsys.readouterr().err.splitlines()


def loader(gpu_run, cpu_run, loaded):
    def load(on):
        loaded.append(on)
        return gpu_run if on else cpu_run

    return load


def test_a_step_that_fails_on_the_gpu_runs_on_the_cpu_from_then_on_and_says_why(
    monkeypatch, capsys
):
    on_mac_gpu(monkeypatch)

    def broken(x):
        raise RuntimeError("MPS backend out of memory")

    loaded = []
    step = gpu.Fallback("shot detection", loader(broken, lambda x: x + 1, loaded))
    assert step(1) == 2 and step(2) == 3
    assert loaded == [True, False]
    assert said(capsys) == [
        "vework: shot detection: on the GPU (MPS)",
        "vework: shot detection: failed on the GPU (RuntimeError: MPS backend out of memory); "
        "running it on the CPU",
    ]


def test_nan_or_empty_output_on_the_gpu_counts_as_a_failure(monkeypatch, capsys):
    on_mac_gpu(monkeypatch)
    for bad in (np.array([0.5, np.nan]), np.array([])):
        step = gpu.Fallback(
            "denoising",
            loader(lambda bad=bad: bad, lambda: np.array([0.5]), []),
            gpu.finite,
            backend="Core ML",
        )
        assert step().tolist() == [0.5]
        assert said(capsys) == [
            "vework: denoising: on the GPU (Core ML)",
            "vework: denoising: failed on the GPU (its output was NaN or empty); "
            "running it on the CPU",
        ]


def test_a_step_that_works_on_the_gpu_stays_there(monkeypatch, capsys):
    on_mac_gpu(monkeypatch)
    loaded = []
    step = gpu.Fallback("aligner", loader(lambda x: x * 2, None, loaded))
    assert [step(1), step(2)] == [2, 4]
    assert loaded == [True] and said(capsys) == ["vework: aligner: on the GPU (MPS)"]


def test_without_the_macs_gpu_nothing_changes_and_nothing_is_said(monkeypatch, capsys):
    on_mac_gpu(monkeypatch, on=False)
    loaded = []
    step = gpu.Fallback("aligner", loader(None, lambda x: x, loaded))
    assert step(1) == 1 and loaded == [False]
    assert gpu.decode("faces", lambda hwaccel: hwaccel) is None
    assert said(capsys) == []


def test_the_cpu_is_chosen_on_a_mac_by_the_environment(monkeypatch):
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setenv(gpu.ENV, "cpu")
    assert not gpu.available()


def test_video_videotoolbox_cannot_decode_is_decoded_in_software(monkeypatch, capsys):
    on_mac_gpu(monkeypatch)
    monkeypatch.setattr(av.codec.hwaccel, "hwdevices_available", lambda: ["videotoolbox"])
    tried = []

    def attempt(hwaccel):
        tried.append(hwaccel)
        if hwaccel is not None:
            raise av.error.FFmpegError(1, "no hardware decoder")
        return "decoded"

    assert gpu.decode("faces", attempt) == "decoded"
    assert isinstance(tried[0], av.codec.hwaccel.HWAccel) and tried[1] is None
    lines = said(capsys)
    assert lines[0] == "vework: faces: decoding video with VideoToolbox"
    assert lines[1].startswith("vework: faces: decoding with VideoToolbox failed (FFmpegError:")
    assert lines[1].endswith("); decoding in software")


def test_a_speech_model_that_hears_nothing_on_the_gpu_hears_it_all_again_on_the_cpu(
    monkeypatch, capsys
):
    on_mac_gpu(monkeypatch)
    heard = {True: ("", None), False: ("大家", "Chinese")}
    monkeypatch.setattr(transcribe, "_recognizer", lambda model, on: lambda wav, ctx: heard[on])
    timed = [("大", 0.1, 0.3), ("家", 0.3, 0.5)]
    monkeypatch.setattr(transcribe, "_aligner", lambda half, on: lambda wav, text: timed)
    steps = []
    samples = np.zeros(16_000, np.float32)
    found = transcribe.transcribe(samples, [{"start": 0.05, "end": 0.6}], progress=steps.append)
    assert [w["text"] for w in found["words"]] == ["大", "家"]
    assert (
        "vework: speech model: failed on the GPU (it heard nothing in any chunk); "
        "running it on the CPU"
    ) in said(capsys)
    assert steps.count("transcribing 1/1") == 2


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
    assert len(thumbs[0]) == len(thumbs[1]) == 360 and hardware == software
    assert {(t.shape, t.dtype) for t in thumbs[0] + thumbs[1]} == {((27, 48, 3), np.uint8)}
    video = probe.probe(shots_video).video
    samples = [
        [(t, image.shape, image.dtype) for t, image, _ in framing.sampled_frames(
            shots_video, video, [], h)]
        for h in (None, accel)
    ]  # fmt: skip
    assert samples[0] == samples[1]


@pytest.mark.ml
def test_shots_found_on_the_gpu_are_the_cpus(mac_gpu, shots_video, monkeypatch, capsys):
    found = shots.detect(shots_video)
    lines = said(capsys)
    assert "vework: shot detection: on the GPU (MPS)" in lines
    assert "vework: shot detection: decoding video with VideoToolbox" in lines
    assert not any("failed" in line for line in lines)
    monkeypatch.setenv(gpu.ENV, "cpu")
    assert found == shots.detect(shots_video)


@pytest.mark.ml
def test_the_denoiser_on_the_gpu_removes_what_the_cpu_does(mac_gpu, monkeypatch, capsys):
    noisy, _, _ = vowels(8.0, [1.0, 3.0, 5.0])
    on_gpu = denoise.enhance(noisy)
    assert said(capsys) == ["vework: denoising: on the GPU (Core ML)"]
    monkeypatch.setenv(gpu.ENV, "cpu")
    cpu = denoise.enhance(noisy)
    # Within 60 dB of the speech: the GPU's 32-bit floats round differently, nothing more.
    assert np.sqrt(np.mean((on_gpu - cpu) ** 2)) < 1e-3 * np.sqrt(np.mean(cpu**2))


@pytest.fixture
def spoken_video(tmp_path):
    """Six seconds of the system's voice over a test pattern, from macOS's `say`."""
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
def test_an_analysis_on_the_mac_says_where_each_step_ran(mac_gpu, spoken_video, tmp_path, capsys):
    # The words come from a stand-in for cloud speech, so the aligner is the only speech model;
    # its timings, from the GPU or from the CPU after it, are what the editor cuts by.
    text = "Hello everyone. Today we look at a new camera."
    cloud = SimpleNamespace(
        recognize=lambda wavs, progress: [(text, "English")] + [("", None)] * (len(wavs) - 1),
        cost=0.0,
        model="stand-in",
    )
    found = index.build(spoken_video, stem=tmp_path / "talk.voice.wav", cloud=cloud)
    lines = said(capsys)
    print("\n".join(lines))
    for line in (
        "shot detection: on the GPU (MPS)",
        "shot detection: decoding video with VideoToolbox",
        "faces: decoding video with VideoToolbox",
        "denoising: on the GPU (Core ML)",
        "aligner: on the GPU (MPS)",
    ):
        assert f"vework: {line}" in lines
    # Only the aligner may fail on the GPU: MPS cannot build its bfloat16 matrix kernels on CI's
    # virtualised M1. Its words are then timed on the CPU.
    failed = [line for line in lines if "failed" in line]
    assert all(line.startswith("vework: aligner: failed on the GPU (") for line in failed)
    words = found["transcript"]["words"]
    assert [w["text"] for w in words][:2] == ["Hello", "everyone."]
    for word in words:
        assert word["start"] < word["end"]
        assert any(s["start"] - 0.05 <= word["start"] and word["end"] <= s["end"] + 0.05
                   for s in found["speech"])  # fmt: skip
