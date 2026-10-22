import numpy as np
import pytest
from conftest import ffmpeg

from vework import gpu, shots

TIMES = np.arange(20) / 10


def probs(values):
    p = np.zeros(20)
    for i, v in values.items():
        p[i] = v
    return p


def test_hard_cut_lands_on_the_first_frame_of_the_new_shot():
    # The model flags the last frame of the old shot.
    center = probs({4: 0.9})
    assert shots.transitions(center, center, TIMES) == [{"start": 0.5, "end": 0.5}]


def test_dissolve_spans_every_frame_inside_it():
    center = probs({10: 0.7, 11: 0.6})
    inside = probs({i: 0.9 for i in range(7, 15)})
    assert shots.transitions(center, inside, TIMES) == [
        {"start": pytest.approx(0.7), "end": pytest.approx(1.5)}
    ]


def test_frames_only_inside_a_transition_are_not_a_cut_on_their_own():
    # Motion can raise the "inside" head without any center frame: no transition.
    assert shots.transitions(probs({}), probs({3: 0.9, 4: 0.9}), TIMES) == []


def test_dissolve_with_a_dip_in_center_probability_is_one_transition():
    center = probs({9: 0.6, 11: 0.6})
    inside = probs({i: 0.9 for i in range(6, 15)})
    assert len(shots.transitions(center, inside, TIMES)) == 1


def test_hard_cut_stays_on_the_new_shot_when_inside_covers_the_frame_before():
    center = probs({4: 0.9})
    inside = probs({3: 0.9, 4: 0.9})
    assert shots.transitions(center, inside, TIMES) == [{"start": 0.5, "end": 0.5}]


def test_flag_on_the_final_frame_has_no_new_shot():
    center = probs({19: 0.9})
    assert shots.transitions(center, center, TIMES) == []


def test_thumbnail_times_follow_display_order_without_usable_timestamps(tmp_path):
    base = tmp_path / "base.mp4"
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=64x64:r=25:d=2", "-c:v", "libx264", "-bf", "3",
           str(base))  # fmt: skip
    for name, args in (("x.avi", ["-c:v", "copy"]), ("x.h264", ["-c:v", "copy", "-f", "h264"])):
        out = tmp_path / name
        ffmpeg("-i", str(base), *args, str(out))
        times = []
        assert len(list(shots.thumbnails(out, times))) == 50
        # AVI shows its first frame one frame late (B-frame delay), as ffmpeg plays it.
        assert times[0] < 0.05, name
        assert (np.diff(times) > 0).all(), name
        assert np.median(np.diff(times)) == pytest.approx(0.04), name


def test_thumbnails_report_how_far_they_are(shots_video):
    said = []
    count = len(list(shots.thumbnails(shots_video, [], said.append)))
    assert count == 360
    assert said == [f"detecting shots {p}%" for p in range(5, 100, 5)]


def test_cover_art_audio_has_no_shots(cover_art_audio):
    with pytest.raises(ValueError, match="no video stream"):
        next(shots.thumbnails(cover_art_audio, []))


@pytest.mark.parametrize("count", [1, 26, 49, 50, 51, 75, 76, 100, 101, 175])
def test_windows_match_the_padded_clip_transnetv2_slides_over(count):
    frames = np.repeat(np.arange(count, dtype=np.uint8), 27 * 48 * 3).reshape(count, 27, 48, 3)
    # transnetv2-pytorch's predict_frames pads the whole clip: 25 copies of the first frame,
    # then copies of the last up to a whole step, and slides 100 frames over it 50 at a time.
    tail = 25 + 50 - (count % 50 or 50)
    padded = np.concatenate([frames[:1]] * 25 + [frames] + [frames[-1:]] * tail)
    expected = [padded[at : at + 100] for at in range(0, len(padded) - 99, 50)]
    found = list(shots.windows(iter(frames)))
    pairs = zip(found, expected, strict=True)
    assert all(np.array_equal(window, want) for (window, _), want in pairs)
    assert sum(scored for _, scored in found) == count


@pytest.mark.ml
def test_streamed_windows_score_exactly_like_the_whole_clip(shots_video, monkeypatch):
    import torch

    # The library's own path on the same device; test_gpu compares the Mac's GPU with its CPU.
    monkeypatch.setenv(gpu.ENV, "cpu")
    from transnetv2_pytorch import TransNetV2

    times = []
    frames = list(shots.thumbnails(shots_video, times))
    # The reference: the library's own whole-clip path, which pads the clip itself.
    model = TransNetV2(device="cuda" if torch.cuda.is_available() else "cpu")
    with torch.no_grad():
        whole = model.predict_frames(
            torch.from_numpy(np.stack(frames)).to(model.device), quiet=True
        )
    center, inside = (p.cpu().numpy() for p in whole)
    streamed = shots.predict(iter(frames))
    assert np.array_equal(streamed[0], center) and np.array_equal(streamed[1], inside)
    assert shots.detect(shots_video) == shots.transitions(center, inside, np.array(times))


@pytest.mark.ml
def test_detects_hard_cuts_and_a_dissolve(shots_video):
    found = shots.detect(shots_video)
    assert found[:2] == [{"start": 3.0, "end": 3.0}, {"start": 6.0, "end": 6.0}]
    assert found[2]["start"] == pytest.approx(8.0, abs=0.1)
    assert found[2]["end"] == pytest.approx(9.0, abs=0.1)
    assert len(found) == 3
