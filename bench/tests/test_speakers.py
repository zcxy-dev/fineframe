import json

import pytest

from vebench import speakers
from vebench.cli import report


def turn(start, end, speaker, visible=True):
    return {"start": start, "end": end, "speaker": speaker, "visible": visible}


TRUTH = [turn(0.0, 4.0, "A"), turn(5.0, 9.0, "B"), turn(10.0, 12.0, "A", visible=False)]


def test_a_system_naming_each_speaker_is_right_whatever_its_labels():
    # Faces are numbered per shot: two labels for A.
    hyp = [turn(0.0, 2.0, "face-0"), turn(2.0, 4.0, "face-7"), turn(5.0, 9.0, "face-1")]
    result = speakers.summarize([speakers.compare(TRUTH, hyp)])
    assert result == {
        "seconds": 8.0,
        "accuracy": 1.0,
        "wrong": 0.0,
        "missed": 0.0,
        "offscreen_seconds": 2.0,
        "offscreen_named": 0.0,
    }


def test_wrong_and_missed_speech_and_naming_a_voice_over_are_counted_apart():
    hyp = [turn(0.0, 3.0, "x"), turn(3.0, 4.0, "y"), turn(6.0, 9.0, "y"), turn(10.0, 11.0, "x")]
    compared = speakers.compare(TRUTH, hyp)
    # x is A; y overlaps A for 1 s and B for 3 s, so it is B, and wrong while A talks.
    assert compared == {
        "seconds": 8.0,
        "correct": 6.0,
        "wrong": 1.0,
        "missed": 1.0,
        "offscreen_seconds": 2.0,
        "offscreen_named": 1.0,
    }


def test_crosstalk_is_not_scored():
    truth = [turn(0.0, 4.0, "A"), turn(3.0, 6.0, "B")]
    compared = speakers.compare(truth, [turn(0.0, 6.0, "face-0")])
    assert compared["seconds"] == 5.0 and compared["correct"] == 3.0


def test_a_malformed_file_names_the_expected_format(tmp_path):
    path = tmp_path / "speakers.json"
    path.write_text(json.dumps({"turns": [{"start": 2.0, "end": 1.0, "speaker": "A"}]}))
    with pytest.raises(ValueError, match="start <= end"):
        speakers.load(path)
    path.write_text(json.dumps({"turns": [{"start": -0.5, "end": 1.0, "speaker": "A"}]}))
    with pytest.raises(ValueError, match="start <= end"):
        speakers.load(path)
    path.write_text(json.dumps({"turns": [{"start": 0.0, "end": 1.0, "speaker": "A"}]}))
    assert speakers.load(path) == [turn(0.0, 1.0, "A")]


def test_report_pools_speakers_and_lists_a_run_without_them(tmp_path):
    for clip in ("a", "b"):
        (tmp_path / clip / "truth").mkdir(parents=True)
        (tmp_path / clip / "truth" / "speakers.json").write_text(json.dumps({"turns": TRUTH}))
        for system in ("ours", "theirs"):
            (tmp_path / clip / "runs" / system).mkdir(parents=True)
    hyp = {"turns": [turn(0.0, 4.0, "f0"), turn(5.0, 7.0, "f1")]}
    for clip in ("a", "b"):
        (tmp_path / clip / "runs" / "ours" / "speakers.json").write_text(json.dumps(hyp))
    result = report(tmp_path, tolerance=0.1)
    assert result["ours"]["speakers"]["seconds"] == 16.0
    assert result["ours"]["speakers"]["accuracy"] == 0.75
    assert result["theirs"]["speakers"] is None
    assert result["theirs"]["missing"] == ["a/speakers", "b/speakers"]
