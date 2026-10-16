import json

import pytest

from vebench.beats import fmeasure, score
from vebench.cli import main


def test_beats_within_70_ms_are_hits_once_each():
    result = fmeasure([1.0, 2.0, 3.0, 4.0], [1.02, 1.03, 2.1, 2.95, 4.0])
    # 1.02 takes 1.0, so 1.03 is a false alarm; 2.1 is 100 ms late, a miss and a false alarm.
    assert result["precision"] == pytest.approx(3 / 5)
    assert result["recall"] == pytest.approx(3 / 4)
    assert result["f"] == pytest.approx(2 * 0.6 * 0.75 / 1.35)
    assert result["offset_ms"]["mean"] == pytest.approx((20 - 50 + 0) / 3)
    assert result["offset_ms"]["max_abs"] == pytest.approx(50)


def test_nothing_found_scores_zero():
    assert fmeasure([1.0], [])["f"] == 0.0
    assert fmeasure([1.0], [])["offset_ms"] == {"mean": None, "max_abs": None}


def test_a_music_index_is_scored_against_its_truth(tmp_path, capsys):
    truth, found = tmp_path / "beat-120.json", tmp_path / "beat-120.music.json"
    beats = [0.5 + 0.5 * i for i in range(16)]
    truth.write_text(json.dumps({"bpm": 120, "beats": beats, "downbeats": beats[::4]}))
    found.write_text(
        json.dumps({"tempo": {"bpm": 119.0}, "beats": beats[1:], "downbeats": beats[2::4]})
    )
    main(["beats", "--ref", str(truth), "--hyp", str(found)])
    result = json.loads(capsys.readouterr().out)
    assert result["beats"]["recall"] == pytest.approx(15 / 16)
    assert result["downbeats"]["f"] == 0.0
    assert result["bpm"]["error"] == pytest.approx(-1 / 120)
    assert score(truth, truth)["beats"]["f"] == 1.0
