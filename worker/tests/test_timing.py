from itertools import pairwise

import numpy as np
import pytest
from conftest import tone

from vework.timing import STEP, WINDOW, noise_floor, refine

RATE = 16_000
END = 3.0  # the chunk's end, past every word here
# A sharp edge reads up to half the level window early or late, plus one step.
NEAR = WINDOW / 2 + STEP


def word(text, start, end):
    return {"text": text, "start": start, "end": end}


def seg(start, end):
    return {"start": start, "end": end}


def times(words):
    return [(w["start"], w["end"]) for w in words]


def test_a_shared_boundary_moves_to_the_dip_between_syllables():
    # Two syllables with a dip at 0.85-0.88; the aligner says 0.80, the start of its 80 ms cell.
    audio = tone((0.5, 0.85), (0.85, 0.88, 0.05), (0.88, 1.2))
    words = refine([word("大", 0.48, 0.80), word("家", 0.80, 1.20)], audio, [seg(0.45, 1.25)], END)
    assert words[0]["end"] == words[1]["start"]
    assert 0.85 <= words[1]["start"] <= 0.88


def test_a_start_after_a_pause_moves_to_where_the_sound_starts():
    audio = tone((1.05, 1.5))
    words = refine([word("好", 1.0, 1.48)], audio, [seg(0.97, 1.53)], END)
    assert words[0]["start"] == pytest.approx(1.05, abs=NEAR)


def test_a_start_at_the_beginning_of_the_file_reads_the_pause_from_the_audio_there():
    # The pause before 0.05 is shorter than a grid step; time before 0 is not silence.
    audio = tone((0.05, 0.5))
    words = refine([word("好", 0.0, 0.48)], audio, [seg(0.0, 0.53)], END)
    assert words[0]["start"] == pytest.approx(0.05, abs=NEAR)


def test_an_end_before_a_pause_moves_to_where_the_sound_stops():
    audio = tone((1.0, 1.67))
    words = refine([word("好", 1.04, 1.60)], audio, [seg(0.97, 1.75)], END)
    assert words[0]["end"] == pytest.approx(1.67, abs=NEAR)


def test_an_edge_stays_inside_the_aligner_cell():
    # The dip lies past 0.80, outside the cell [0.72, 0.80) the aligner chose.
    audio = tone((0.5, 0.85), (0.85, 0.88, 0.05), (0.88, 1.2))
    words = refine([word("大", 0.48, 0.72), word("家", 0.72, 1.20)], audio, [seg(0.45, 1.25)], END)
    assert 0.72 <= words[1]["start"] <= 0.80


def test_an_edge_never_passes_the_next_one():
    # "家" lasts 30 ms, and the dip lies at its end; its start stops short of it.
    audio = tone((0.5, 0.82), (0.82, 0.835, 0.05), (0.835, 1.2))
    words = [word("大", 0.48, 0.80), word("家", 0.80, 0.83), word("好", 0.83, 1.2)]
    refine(words, audio, [seg(0.45, 1.25)], END)
    assert all(w["start"] < w["end"] <= nxt["start"] for w, nxt in pairwise(words))
    assert words[1]["end"] - words[1]["start"] >= 0.02 - 1e-9


def test_an_end_sounding_through_the_cell_moves_to_its_end():
    # The pause starts after the cell, so the word lasts at least to the cell's end.
    audio = tone((1.0, 1.70))
    words = refine([word("好", 1.04, 1.60)], audio, [seg(0.97, 1.75)], END)
    assert words[0]["end"] == pytest.approx(1.68)


def test_an_edge_never_leaves_its_speech_segment():
    audio = tone((1.0, 1.67))
    words = refine([word("好", 1.04, 1.60)], audio, [seg(0.97, 1.63)], END)
    assert 1.60 <= words[0]["end"] <= 1.63


def test_zero_length_words_at_a_boundary_move_with_it():
    audio = tone((0.5, 0.85), (0.85, 0.88, 0.05), (0.88, 1.2))
    words = [word("了", 0.48, 0.80), word("我", 0.80, 0.80), word("的", 0.80, 1.20)]
    refine(words, audio, [seg(0.45, 1.25)], END)
    assert words[0]["end"] == words[1]["start"] == words[1]["end"] == words[2]["start"]
    assert 0.85 <= words[2]["start"] <= 0.88


def test_a_gap_the_aligner_left_in_unbroken_speech_closes_at_the_dip():
    # talk-a1 at 97.2 s: the aligner ends 這 two cells before 個 starts, though the speaker
    # runs them together; only the dip between their syllables lies in between (0.85-0.88).
    audio = tone((0.5, 0.85), (0.85, 0.88, 0.05), (0.88, 1.0), (1.03, 1.4))
    words = [word("這", 0.48, 0.64), word("個", 0.88, 1.04), word("project", 1.04, 1.36)]
    refine(words, audio, [seg(0.47, 1.43)], END)
    assert words[0]["end"] == words[1]["start"]
    assert 0.85 <= words[1]["start"] <= 0.88


def test_sound_the_aligner_left_untimed_before_a_pause_joins_the_word_before():
    # chat-b1 at 76.1 s: the aligner times 誰 (0.915-1.1) after the pause that follows it,
    # leaving it in the gap after 切; a gap holds only silence.
    audio = tone((0.5, 0.9), (0.9, 0.93, 0.05), (0.93, 1.1), (1.4, 1.8))
    words = [word("切", 0.48, 0.80), word("誰，", 1.36, 1.52), word("但", 1.52, 1.80)]
    refine(words, audio, [seg(0.47, 1.13), seg(1.37, 1.83)], END)
    assert words[0]["end"] == pytest.approx(1.10, abs=NEAR)
    assert words[1]["start"] == pytest.approx(1.40, abs=NEAR)


def test_silence_moves_nothing():
    words = [word("大", 0.48, 0.80), word("家", 0.80, 1.20)]
    refine(words, np.zeros(RATE * 2, np.float32), [seg(0.45, 1.25)], END)
    assert times(words) == [(0.48, 0.80), (0.80, 1.20)]


def test_the_noise_floor_is_the_room_between_words_not_digital_silence():
    audio = tone((1.0, 1.5), length=5.0)
    audio[int(2.0 * RATE) :] = 0  # a muted end, longer than the room before the speech
    assert noise_floor(audio, [seg(0.97, 1.53)]) == pytest.approx(-80, abs=1)
