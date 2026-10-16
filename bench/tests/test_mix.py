import json

import numpy as np
import pytest
from conftest import ffmpeg
from test_report import write_wav

from vebench.cli import main
from vebench.mix import check, compare, joins


def test_talking_is_measured_against_the_music_under_it():
    # 100 ms steps: speech at -23 for 3 s, then a 2 s gap; music at -41 under speech, -29 after.
    voice = np.array([-23.0] * 30 + [-120.0] * 20)
    music = np.array([-41.0] * 30 + [-29.0] * 20)
    result = compare(voice, music)
    assert result["talking_blocks"] == 30
    assert result["over_music_db"] == pytest.approx(18.0)
    assert result["p5_over_music_db"] == pytest.approx(18.0)
    assert result["music_in_gaps_lufs"] == pytest.approx(-29.0)


def test_quiet_ends_of_phrases_show_in_the_low_percentile():
    voice = np.array([-23.0] * 90 + [-31.0] * 10)  # the last tenth 8 LU quieter
    music = np.full(100, -41.0)
    result = compare(voice, music)
    assert result["talking_blocks"] == 100
    assert result["p5_over_music_db"] == pytest.approx(10.0)
    assert result["over_music_db"] > 17


def test_silence_has_nothing_to_measure():
    assert compare(np.full(10, -120.0), np.full(10, -30.0))["over_music_db"] is None


def test_stems_are_metered_from_files(tmp_path, capsys):
    voice, music = tmp_path / "voice.wav", tmp_path / "music.wav"
    ffmpeg("-f", "lavfi", "-i", "sine=f=997:d=3:sample_rate=48000", "-ac", "2", str(voice))
    ffmpeg("-f", "lavfi", "-i", "sine=f=997:d=3:sample_rate=48000,volume=-18dB",
           "-ac", "2", str(music))  # fmt: skip
    main(["mix", "--voice", str(voice), "--music", str(music)])
    result = json.loads(capsys.readouterr().out)
    assert result["over_music_db"] == pytest.approx(18.0, abs=0.1)


def test_music_joins_are_checked_for_clicks(tmp_path):
    # The second range starts its 40 ms cross-fade at 1 s: the join is the cross-fade's middle.
    # One whose cross-fade went missing splices two waveforms that do not line up there.
    project = tmp_path / "project.json"
    second = {"start": 120_000, "in": 0, "out": 120_000, "fadeIn": 4_800}
    ranges = [{"start": 0, "in": 0, "out": 120_000}, second]
    project.write_text(json.dumps({"audio": {"music": ranges}}))
    assert joins(project) == [pytest.approx(1.02)]
    rate = 48_000
    t = np.arange(2 * rate) / rate
    smooth = 0.3 * np.sin(2 * np.pi * 220 * t)
    broken = np.where(t < 1.02, smooth, 0.3 * np.sin(2 * np.pi * 220 * t + np.pi))
    voice, music = tmp_path / "voice.wav", tmp_path / "music.wav"
    write_wav(voice, np.zeros_like(t))
    for samples, clicks in ((smooth, 0), (broken, 1)):
        write_wav(music, samples)
        assert check(voice, music, joins(project))["join_clicks"] == clicks
