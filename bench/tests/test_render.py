import numpy as np
import pytest
from conftest import ffmpeg

from vebench.render import RATE, check, compare

T = np.arange(2 * RATE) / RATE


def tone(t, phase=0.0, amp=0.5):
    return (amp * np.sin(2 * np.pi * 220 * t + phase)).astype(np.float32)


def test_phase_jump_at_a_cut_is_flagged():
    cut = RATE  # splice two takes of the same tone half a cycle apart
    audio = np.concatenate([tone(T[:cut]), tone(T[cut:], phase=np.pi)])
    assert compare(audio, RATE, [1.0])["clicks"] == 1


def test_continuous_audio_is_not_flagged():
    assert compare(tone(T), RATE, [0.5, 1.0, 1.5])["clicks"] == 0


def test_crossfaded_splice_is_not_flagged():
    cut, fade = RATE, int(0.03 * RATE)
    a, b = tone(T), tone(T, phase=np.pi)
    ramp = np.linspace(0, 1, fade, dtype=np.float32)
    audio = np.concatenate(
        [
            a[: cut - fade],
            a[cut - fade : cut] * (1 - ramp) + b[cut - fade : cut] * ramp,
            b[cut:],
        ]
    )
    assert compare(audio, RATE, [1.0])["clicks"] == 0


def test_cut_between_silences_is_not_flagged():
    assert compare(np.zeros(2 * RATE, dtype=np.float32), RATE, [1.0])["clicks"] == 0


def test_sudden_onset_out_of_silence_is_flagged():
    audio = np.concatenate([np.zeros(RATE, dtype=np.float32), tone(T[RATE:], phase=np.pi / 2)])
    assert compare(audio, RATE, [1.0])["clicks"] == 1


def test_drift_is_decoded_audio_length_minus_video_length():
    audio = np.zeros(int(2.1 * RATE), dtype=np.float32)
    assert compare(audio, RATE, [], video=2.0)["drift_ms"] == pytest.approx(100)


def test_check_measures_drift_of_a_real_file(tmp_path):
    out = tmp_path / "out.mov"
    ffmpeg(
        "-f", "lavfi", "-i", "testsrc2=s=64x64:r=30:d=2",
        "-f", "lavfi", "-i", "sine=f=220:d=2.25:sample_rate=48000",
        "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "pcm_s16le", str(out),
    )  # fmt: skip
    assert check(out, [])["drift_ms"] == pytest.approx(250, abs=5)


def test_drift_counts_b_frame_reordering_correctly(tmp_path):
    out = tmp_path / "bframes.mov"
    ffmpeg(
        "-f", "lavfi", "-i", "testsrc2=s=64x64:r=25:d=2",
        "-f", "lavfi", "-i", "sine=f=220:d=2:sample_rate=48000",
        "-c:v", "libx264", "-bf", "3", "-c:a", "pcm_s16le", str(out),
    )  # fmt: skip
    assert check(out, [])["drift_ms"] == pytest.approx(0, abs=5)


def test_drift_includes_audio_that_starts_late(tmp_path):
    out = tmp_path / "late.mov"
    ffmpeg(
        "-f", "lavfi", "-i", "testsrc2=s=64x64:r=25:d=2",
        "-itsoffset", "0.5", "-f", "lavfi", "-i", "sine=f=220:d=2:sample_rate=48000",
        "-map", "0", "-map", "1", "-c:v", "libx264", "-preset", "ultrafast",
        "-c:a", "pcm_s16le", str(out),
    )  # fmt: skip
    assert check(out, [])["drift_ms"] == pytest.approx(500, abs=5)


def test_output_without_audio_is_reported_not_crashed(tmp_path):
    out = tmp_path / "silent.mov"
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=64x64:r=25:d=1", "-c:v", "libx264", str(out))
    with pytest.raises(ValueError, match="no audio stream"):
        check(out, [0.5])


def test_missing_file_says_so(tmp_path):
    with pytest.raises(FileNotFoundError, match="missing.mp4"):
        check(tmp_path / "missing.mp4", [])


def test_cut_outside_the_media_is_an_error(tmp_path):
    out = tmp_path / "short.wav"
    ffmpeg("-f", "lavfi", "-i", "sine=d=1:sample_rate=48000", str(out))
    with pytest.raises(ValueError, match="outside the 1.00 s media: 5"):
        check(out, [0.5, 5.0])


def test_video_with_no_frames_has_no_video_end(tmp_path):
    from vebench.render import video_seconds

    out = tmp_path / "empty.mkv"
    # Trimming past the end leaves a video stream that holds no frames.
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=64x64:r=25:d=1,trim=start=5", "-f", "lavfi", "-i",
           "sine=d=1", "-map", "0:v", "-map", "1:a", "-c:v", "libx264", str(out))  # fmt: skip
    assert video_seconds(out) is None
