import itertools
import re

import numpy as np
import pytest

from vebench.synth import music, speech
from vebench.synth.layout import PAUSE_MIN, RATE, lay_out, speaker_turns, transitions
from vebench.synth.script import CLIPS, FILLER, Line, Pause, Retake, Show, phrases
from vebench.synth.speech import WORD


def fake_say(text, speaker, seed):
    """Kokoro's shape without the model: a lead-in, 0.2 s per word, a tail."""
    found = list(WORD.finditer(text))
    words = []
    for i, m in enumerate(found):
        end = found[i + 1].start() if i + 1 < len(found) else len(text)
        words.append((text[m.start() : end].strip(), 0.1 + 0.2 * i, 0.3 + 0.2 * i, m.start()))
    t = np.arange(round((0.4 + 0.2 * len(found)) * RATE)) / RATE
    audio = (0.3 * np.sin(2 * np.pi * 150 * t)).astype(np.float32)
    return audio, words


@pytest.fixture(scope="module")
def layouts():
    return {
        clip.name: lay_out(clip, fake_say, np.random.default_rng([0, i]))
        for i, clip in enumerate(CLIPS)
    }


def texts(clip):
    for item in clip.items:
        if isinstance(item, Line):
            yield item.text
        elif isinstance(item, Retake):
            yield from (phrase for take in item.takes for phrase in phrases(take))


def spoken(words):
    return "".join(re.sub(r"[^\w']", "", w["text"]) for w in words)


def test_corpus_covers_what_the_editor_must_handle():
    marks = {m for clip in CLIPS for text in texts(clip) for m in FILLER.findall(text)}
    assert {"嗯", "那個", "um", "uh"} <= marks
    # "那個" also appears as speech ("that"), which an edit must keep.
    assert any("那個" in FILLER.sub("", text) for clip in CLIPS for text in texts(clip))
    for clip in CLIPS:
        mixed = [
            t
            for t in texts(clip)
            if re.search(r"[一-鿿]", t) and re.search("[A-Za-z]", FILLER.sub("", t))
        ]
        assert mixed, f"{clip.name}: no line mixes Chinese and English"
        assert any(isinstance(i, Pause) for i in clip.items), clip.name
        assert any(isinstance(i, Retake) for i in clip.items), clip.name
    views = {i.view for clip in CLIPS for i in clip.items if isinstance(i, Show)}
    assert {"terminal", "editor", "slide"} <= views
    assert any(len(clip.speakers) == 2 for clip in CLIPS)
    assert any(clip.portrait for clip in CLIPS)
    assert len({clip.fps for clip in CLIPS}) > 1
    groups = [clip.group for clip in CLIPS]
    assert sum(groups.count(g) > 1 for g in set(groups)) >= 2


def test_every_filler_mark_is_a_timed_filler(layouts):
    for clip in CLIPS:
        plan = layouts[clip.name]
        fillers = plan.edit["fillers"]
        assert [f["text"] for f in fillers] == [
            m for text in texts(clip) for m in FILLER.findall(text)
        ]
        for f in fillers:
            inside = [w for w in plan.words if f["start"] <= w["start"] and w["end"] <= f["end"]]
            assert spoken(inside) == f["text"].replace(" ", "")


def test_scripted_pauses_last_two_to_five_seconds(layouts):
    for clip in CLIPS:
        plan = layouts[clip.name]
        long = [p for p in plan.edit["pauses"] if 2.0 <= p["end"] - p["start"] <= 5.0]
        assert len(long) >= sum(isinstance(i, Pause) for i in clip.items), clip.name
        words = plan.words
        for p in plan.edit["pauses"]:
            assert p["end"] - p["start"] >= 1.0
            assert not any(w["start"] < p["end"] and p["start"] < w["end"] for w in words)


def test_every_abandoned_take_is_an_attempt_at_the_kept_line():
    for clip in CLIPS:
        for retake in (i for i in clip.items if isinstance(i, Retake)):
            kept = retake.takes[-1]
            for take in retake.takes[:-1]:
                assert phrases(take)[0][:4] == kept[:4], (clip.name, take)


def test_an_abandoned_take_runs_to_the_end_of_the_words_that_abandon_it(layouts):
    plan = layouts["talk-a1"]
    (retake,) = plan.edit["retakes"]
    assert retake["keep"] == 1
    first = retake["takes"][0]
    said = spoken(
        w for w in plan.words if first["start"] <= w["start"] and w["end"] <= first["end"]
    )
    assert said.startswith("所以我的目標是") and said.endswith("不對我重講一次")


def test_retakes_keep_the_clean_last_take(layouts):
    for clip in CLIPS:
        scripted = [i for i in clip.items if isinstance(i, Retake)]
        retakes = layouts[clip.name].edit["retakes"]
        assert [r["keep"] for r in retakes] == [len(i.takes) - 1 for i in scripted]
        for r in retakes:
            assert all(a["end"] < b["start"] for a, b in itertools.pairwise(r["takes"]))


def test_story_order_puts_the_hook_recorded_last_first(layouts):
    talk = [s for name in ("talk-a1", "talk-a2", "talk-a3") for s in layouts[name].edit["story"]]
    assert sorted(s["order"] for s in talk) == list(range(6))
    hook = layouts["talk-a3"].edit["story"][-1]
    assert hook["order"] == 0 and hook["start"] > layouts["talk-a3"].edit["story"][0]["end"]
    assert {layouts[n].edit["group"] for n in ("talk-a1", "talk-a2", "talk-a3")} == {"talk-a"}


def test_multicam_cuts_to_each_speaker_and_dissolves_once(layouts):
    for name in ("chat-b1", "chat-b2", "chat-b3"):
        shots = layouts[name].shots
        frames = [s["frame"] for s in shots]
        assert frames == sorted(set(frames)) and frames[0] == 0
        assert {s["view"] for s in shots} >= {"a", "b"}
        assert sum(s["dissolve"] > 0 for s in shots) == 1


def test_scripted_cuts_fall_between_lines(layouts):
    plan = layouts["talk-a2"]
    for t in transitions(plan.shots, 25):
        assert not any(w["start"] < t["start"] < w["end"] for w in plan.words)


def test_phone_footage_is_one_unbroken_shot(layouts):
    assert [s["view"] for s in layouts["phone-c"].shots] == ["street"]


def test_speaker_turns_cover_each_word_and_know_whose_face_is_on_screen(layouts):
    hidden = 0
    for clip in CLIPS:
        plan = layouts[clip.name]
        turns = speaker_turns(clip, plan.words, plan.shots)
        for w in plan.words:
            # A shot can change during a word, splitting it between two turns.
            covered = sum(
                max(0.0, min(t["end"], w["end"]) - max(t["start"], w["start"]))
                for t in turns
                if t["speaker"] == w["speaker"]
            )
            assert covered == pytest.approx(w["end"] - w["start"], abs=2e-3), (clip.name, w)
        assert all(a["end"] <= b["start"] for a, b in zip(turns, turns[1:], strict=False))
        for a, b in zip(turns, turns[1:], strict=False):
            # Turns of one speaker part at a pause or where their face comes or goes.
            assert (
                a["speaker"] != b["speaker"]
                or b["start"] - a["end"] >= PAUSE_MIN - 1e-3
                or (a["visible"] != b["visible"])
            )
        if clip.name == "screen-d":
            assert not any(t["visible"] for t in turns)
        if clip.name.startswith("chat-"):
            assert {("A", True), ("B", True)} <= {(t["speaker"], t["visible"]) for t in turns}
            hidden += sum(not t["visible"] for t in turns)
    # Live switching sometimes stays on one person while the other answers.
    assert hidden > 0


def test_a_speaker_is_on_screen_in_their_own_close_up_and_in_either_shot_of_a_dissolve():
    clip = next(c for c in CLIPS if c.name == "chat-b1")
    words = [{"text": "好", "start": 0.0, "end": 9.0, "speaker": "A"}]
    shots = [
        {"view": "a", "frame": 0, "dissolve": 0, "text": []},
        {"view": "b", "frame": 3 * clip.fps, "dissolve": clip.fps, "text": []},
        {"view": "wide", "frame": 6 * clip.fps, "dissolve": 0, "text": []},
    ]
    assert speaker_turns(clip, words, shots) == [
        {"start": 0.0, "end": 4.0, "speaker": "A", "visible": True},
        {"start": 4.0, "end": 6.0, "speaker": "A", "visible": False},
        {"start": 6.0, "end": 9.0, "speaker": "A", "visible": True},
    ]


def test_transitions_start_on_the_new_shots_first_frame():
    shots = [
        {"frame": 0, "dissolve": 0},
        {"frame": 75, "dissolve": 0},
        {"frame": 100, "dissolve": 20},
    ]
    assert transitions(shots, 25) == [{"start": 3.0, "end": 3.0}, {"start": 4.0, "end": 4.8}]


def test_same_seed_same_layout():
    clip = CLIPS[3]
    a, b, c = (lay_out(clip, fake_say, np.random.default_rng(s)) for s in (5, 5, 6))
    assert (a.words, a.edit, a.shots) == (b.words, b.edit, b.shots)
    assert a.edit != c.edit


def test_music_hits_fall_on_the_beats():
    samples, truth = music.track(120, bars=4, pickup=2, seed=0)
    beats = truth["beats"]
    assert np.allclose(np.diff(beats), 0.5) and len(beats) == 2 + 16
    assert truth["downbeats"] == beats[2::4]

    def energy(at):
        i = round(at * music.RATE)
        return float(np.mean(samples[i : i + 480] ** 2))

    # Every beat is a hit; a quarter of a beat later, nothing new has started.
    assert all(energy(b) > 4 * energy(b + 0.125 + 0.03) for b in beats)


def test_music_sections_play_their_parts_and_start_on_downbeats():
    samples, truth = music.track(120, 8, 1, 0, [(4, "h"), (4, music.ALL)])
    downbeats = truth["downbeats"]
    assert truth["sections"] == [
        {"start": 0.0, "end": downbeats[4], "parts": "h"},
        {"start": downbeats[4], "end": truth["duration"], "parts": music.ALL},
    ]

    def level(start, end):
        return float(np.mean(samples[round(start * music.RATE) : round(end * music.RATE)] ** 2))

    # Hats alone are far quieter than the full kit.
    assert level(downbeats[0], downbeats[4]) < level(downbeats[4], downbeats[7]) / 10
    with pytest.raises(ValueError, match="add up to 4, not 8"):
        music.track(120, 8, 0, 0, [(4, "h")])


def test_music_is_the_same_for_the_same_seed():
    assert np.array_equal(music.track(96, 2, 0, 3)[0], music.track(96, 2, 0, 3)[0])


def test_word_edges_at_silence_follow_the_sound():
    # Kokoro stretches a phrase's last syllable over the silence after it, and its sound starts
    # a little before the first syllable's duration frame does.
    t = np.arange(speech.RATE) / speech.RATE
    audio = np.where((t >= 0.2) & (t < 0.5), 0.5 * np.sin(2 * np.pi * 200 * t), 0)
    words = [("好", 0.225, 0.35, 0), ("道。", 0.35, 0.9, 1)]
    (first, start, end, _), (last, start2, end2, _) = speech.fit_to_sound(audio, words)
    assert start == pytest.approx(0.2, abs=0.006)
    assert end == start2 == 0.35  # between two words the model's boundary stands
    assert end2 == pytest.approx(0.5, abs=0.006)
