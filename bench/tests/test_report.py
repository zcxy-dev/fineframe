import json
import wave

import numpy as np

from vebench.cli import report


def write_wav(path, samples, rate=48_000):
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(rate)
        f.writeframes((samples * 32767).astype("<i2").tobytes())


def test_report_pools_each_run_across_clips(tmp_path):
    t = np.arange(48_000 * 2) / 48_000
    clicky = (
        np.concatenate(
            [np.sin(2 * np.pi * 220 * t[:48_000]), np.sin(2 * np.pi * 220 * t[48_000:] + np.pi)]
        )
        * 0.5
    )

    for clip, ref_text, hyp_text in (
        ("a", "一二三四", "一二三四"),
        ("b", "五六七八九十", "五六七"),
    ):
        truth = tmp_path / clip / "truth"
        run = tmp_path / clip / "runs" / "ours"
        truth.mkdir(parents=True)
        run.mkdir(parents=True)
        (truth / "transcript.txt").write_text(ref_text)
        (run / "transcript.txt").write_text(hyp_text)
        (truth / "shots.json").write_text(json.dumps({"transitions": [{"start": 1.0}]}))
        (run / "shots.json").write_text(json.dumps([1.02]))
    write_wav(tmp_path / "a" / "runs" / "ours" / "output.wav", clicky)
    (tmp_path / "a" / "runs" / "ours" / "edit_cuts.json").write_text("[1.0]")
    # Stems of the render: the sound without the music, where the cut clicks, and music 20 dB
    # under it.
    write_wav(tmp_path / "a" / "runs" / "ours" / "voice.wav", clicky)
    write_wav(tmp_path / "a" / "runs" / "ours" / "music.wav", 0.05 * np.sin(2 * np.pi * 220 * t))

    result = report(tmp_path, tolerance=0.1)["ours"]
    assert result["clips"] == ["a", "b"]
    # 3 deletions over 10 reference characters, not the mean of 0% and 50%.
    assert result["transcript"]["mer"] == 0.3
    assert result["shots"]["f1"] == 1.0
    assert result["render"] == {"cuts": 1, "clicks": 1, "click_rate": 1.0, "max_abs_drift_ms": None}
    assert result["mix"]["edits"] == 1
    assert abs(result["mix"]["min_over_music_db"] - 20) < 0.1


def test_report_lists_missing_outputs_and_failures_instead_of_skipping(tmp_path):
    truth = tmp_path / "a" / "truth"
    run = tmp_path / "a" / "runs" / "other"
    truth.mkdir(parents=True)
    run.mkdir(parents=True)
    (truth / "transcript.txt").write_text("一二")
    (truth / "shots.json").write_text(json.dumps({"transitions": [{"start": 1.0}]}))
    (run / "output.wav").write_bytes(b"not audio")
    (run / "edit_cuts.json").write_text("[0.5]")

    result = report(tmp_path, tolerance=0.1)["other"]
    assert result["missing"] == ["a/transcript", "a/shots"]
    assert len(result["errors"]) == 1 and result["errors"][0].startswith("a/render: ")


def test_a_drum_hit_in_the_music_at_a_cut_is_not_a_click(tmp_path):
    # Cuts are in the main track's sound: the music under the edit plays on through them, and a
    # hit of it that lands on a cut is music, not a splice. The voice stem is where cuts click.
    t = np.arange(48_000 * 2) / 48_000
    voice = 0.3 * np.sin(2 * np.pi * 220 * t)
    hit = np.zeros_like(t)
    hit[48_000 : 48_000 + 96] = 0.4 * np.random.default_rng(0).uniform(-1, 1, 96)  # a 2 ms tick
    (tmp_path / "a" / "truth").mkdir(parents=True)
    run = tmp_path / "a" / "runs" / "ours"
    run.mkdir(parents=True)
    write_wav(run / "output.wav", voice + hit)
    write_wav(run / "voice.wav", voice)
    write_wav(run / "music.wav", hit)
    (run / "edit_cuts.json").write_text("[1.0]")
    assert report(tmp_path, tolerance=0.1)["ours"]["render"]["clicks"] == 0
