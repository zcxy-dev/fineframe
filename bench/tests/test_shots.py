import pytest

from vebench.shots import Transition, score


def test_hard_cuts_match_within_tolerance_one_to_one():
    truth = [Transition(10.0, 10.0), Transition(20.0, 20.0)]
    # Two detections near 10s may only claim one transition; 30s is a false positive.
    result = score(truth, [10.05, 9.97, 30.0], tolerance=0.1)
    assert (result["tp"], result["fp"], result["fn"]) == (1, 2, 1)
    assert result["precision"] == pytest.approx(1 / 3)
    assert result["recall"] == pytest.approx(1 / 2)
    assert result["hard_recall"] == pytest.approx(1 / 2)


def test_gradual_transition_matches_anywhere_in_its_span():
    truth = [Transition(5.0, 6.0), Transition(12.0, 12.0)]
    result = score(truth, [5.6, 12.0])
    assert result["f1"] == 1.0
    assert result["gradual_recall"] == 1.0


def test_overlapping_windows_still_find_the_maximum_matching():
    # A long dissolve containing a hard cut: a naive start-ordered greedy would give the
    # dissolve the 4.1 detection and leave the hard cut unmatched.
    truth = [Transition(3.0, 6.0), Transition(4.1, 4.1)]
    assert score(truth, [4.1, 5.5], tolerance=0.05)["tp"] == 2


def test_no_detections():
    result = score([Transition(1.0, 1.0)], [])
    # Precision is undefined without detections, but missing every cut still scores F1 = 0.
    assert (result["tp"], result["fn"], result["precision"], result["f1"]) == (0, 1, None, 0.0)


def test_f1_is_undefined_only_with_nothing_to_find_and_nothing_found():
    assert score([], [])["f1"] is None


def test_detection_exactly_at_tolerance_matches_despite_float_rounding():
    assert score([Transition(12.4, 12.4)], [12.36], tolerance=0.04)["tp"] == 1
    assert score([Transition(0.4, 0.4)], [0.3], tolerance=0.1)["tp"] == 1
