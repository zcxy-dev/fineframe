import json

import pytest

from vebench import edit
from vebench.cli import main, report

T = 120_000


def word(text, start, end):
    return {"text": text, "start": start, "end": end}


# 0.0-1.0 silence, 1.0 嗯 (filler), then a sentence, a 2 s pause, an abandoned take, its retake.
WORDS = [
    word("嗯，", 1.0, 1.2),
    word("大", 1.2, 1.4),
    word("家", 1.4, 1.6),
    word("好。", 1.6, 1.8),
    word("今", 3.8, 4.0),
    word("天，", 4.0, 4.2),
    word("不", 4.2, 4.4),
    word("對。", 4.4, 4.6),
    word("今", 5.6, 5.8),
    word("天", 5.8, 6.0),
    word("好。", 6.0, 6.2),
]
EDIT = {
    "group": "a",
    "fillers": [{"start": 1.0, "end": 1.2, "text": "嗯"}],
    "pauses": [
        {"start": 0.0, "end": 1.0},
        {"start": 1.8, "end": 3.8},
        {"start": 4.6, "end": 5.6},
        {"start": 6.2, "end": 8.0},
    ],
    "retakes": [{"takes": [{"start": 3.8, "end": 4.6}, {"start": 5.6, "end": 6.2}], "keep": 1}],
    "story": [{"start": 1.0, "end": 6.2, "order": 1, "topic": "開場"}],
}


def corpus(tmp_path, main, target=3.0, words=WORDS, truth=EDIT):
    clip = tmp_path / "a1"
    (clip / "truth").mkdir(parents=True)
    (clip / "source.mp4").write_bytes(b"")
    (clip / "truth" / "edit.json").write_text(json.dumps(truth))
    (clip / "truth" / "transcript.json").write_text(json.dumps({"words": words}))
    (clip / "index.json").write_text(json.dumps({"source": {"duration": 8.0}}))
    run = clip / "runs" / "ours"
    run.mkdir(parents=True)
    project = {
        "output": {"target": {"duration": round(target * T), "tolerance": 0.05}},
        "sources": [{"id": "a", "path": "../../source.mp4", "index": "../../index.json"}],
        "main": [{"source": "a", "in": round(a * T), "out": round(b * T)} for a, b in main],
    }
    (run / "project.json").write_text(json.dumps(project))
    return run / "project.json"


def test_a_clean_edit_scores_clean(tmp_path):
    # The filler, the long pause and the abandoned take are cut; each cut is between words.
    path = corpus(tmp_path, [(1.2, 2.0), (5.45, 6.45)], target=1.8)
    result = edit.score(path)
    assert result["length"] == {"seconds": 1.8, "target": 1.8, "error": 0.0, "within": True}
    assert result["cuts"] == {"checked": 4, "in_words": 0, "deepest_ms": 0.0}
    assert result["fillers"] == {"total": 1, "removed": 1, "removed_words": 0, "filler_words": 0}
    assert result["retakes"] == {"scored": 1, "correct": 1, "unused": 0}
    assert result["dead_air"] == {"count": 0, "seconds": 0.0}
    assert result["sources"] == ["a1"]


def test_cuts_inside_words_and_a_wrong_take_count_against_the_edit(tmp_path):
    # Starts inside 大 and ends inside 不: the abandoned take plays, the kept one does not.
    path = corpus(tmp_path, [(1.3, 4.3)], target=3.0)
    result = edit.score(path)
    assert result["cuts"]["in_words"] == 2
    assert result["cuts"]["deepest_ms"] == pytest.approx(100.0)
    assert result["retakes"] == {"scored": 1, "correct": 0, "unused": 0}
    # The 2 s pause plays whole.
    assert result["dead_air"] == {"count": 1, "seconds": 2.0}


def test_a_word_cut_out_that_is_no_filler_lowers_precision(tmp_path):
    # Keeps the filler, cuts 家 out from between 大 and 好.
    path = corpus(tmp_path, [(0.9, 1.4), (1.6, 1.9)], target=0.8)
    fillers = edit.score(path)["fillers"]
    assert fillers == {"total": 1, "removed": 0, "removed_words": 1, "filler_words": 0}
    pooled = edit.summarize([edit.score(path)])["fillers"]
    assert pooled["recall"] == 0.0
    assert pooled["precision"] == 0.0


def test_silences_on_both_sides_of_a_cut_add_up(tmp_path):
    # 0.6 s of the long pause, then a cut to 0.6 s before the retake: 1.2 s of dead air.
    path = corpus(tmp_path, [(1.2, 2.4), (5.0, 6.2)], target=2.4)
    assert edit.score(path)["dead_air"] == {"count": 1, "seconds": pytest.approx(1.2)}


def test_short_silences_joined_at_a_cut_are_dead_air(tmp_path):
    # Gaps of 0.9 s, each too short to be a truth pause, add up to 1.8 s across the cut.
    words = [
        word("大", 1.0, 1.2),
        word("家", 1.2, 1.4),
        word("好。", 1.4, 1.6),
        word("今", 2.5, 2.7),
        word("天", 2.7, 2.9),
        word("好。", 3.8, 4.0),
    ]
    truth = {**EDIT, "fillers": [], "retakes": [], "pauses": [{"start": 0.0, "end": 1.0}]}
    path = corpus(tmp_path, [(1.0, 2.5), (2.9, 4.0)], target=2.6, words=words, truth=truth)
    assert edit.score(path)["dead_air"] == {"count": 1, "seconds": pytest.approx(1.8)}


def test_fillers_in_a_take_the_truth_drops_count_toward_neither_rate(tmp_path):
    # A filler said in the abandoned take, next to the kept take the edit plays.
    truth = {**EDIT, "fillers": [*EDIT["fillers"], {"start": 4.4, "end": 4.6, "text": "呃"}]}
    path = corpus(tmp_path, [(1.2, 2.0), (5.45, 6.45)], target=1.8, truth=truth)
    assert edit.score(path)["fillers"] == {
        "total": 1,
        "removed": 1,
        "removed_words": 0,
        "filler_words": 0,
    }


def test_report_scores_the_edit_of_a_run(tmp_path, capsys):
    corpus(tmp_path, [(1.2, 2.0), (5.45, 6.45)], target=1.8)
    result = report(tmp_path, 0.1)
    pooled = result["ours"]["edit"]
    assert pooled["projects"] == 1
    assert pooled["length"]["within"] == 1
    assert pooled["fillers"]["recall"] == 1.0
    assert pooled["retakes"]["accuracy"] == 1.0
    main(["edit", "--project", str(tmp_path / "a1" / "runs" / "ours" / "project.json")])
    assert json.loads(capsys.readouterr().out)["cuts"]["in_words"] == 0


def test_b_roll_edges_are_measured_from_the_beats_of_the_music_under_them(tmp_path):
    path = corpus(tmp_path, [(1.2, 2.0), (5.45, 6.45)], target=1.8)
    project = json.loads(path.read_text())
    music = tmp_path / "music"
    music.mkdir()
    beats = [0.5 + 0.5 * i for i in range(8)]  # 120 bpm from 0.5 s
    (music / "beat-120.json").write_text(json.dumps({"beats": beats}))
    project["output"]["fps"] = {"num": 25, "den": 1}
    project["sources"].append({"id": "m", "path": "../../../music/beat-120.wav"})
    # From 1.0 s of the track at 0.2 s into the edit: its beats fall at 0.2, 0.7, 1.2 ...
    project["audio"] = {"music": [{"source": "m", "in": T, "out": 4 * T, "start": T // 5}]}
    # Edges at 0.68 and 1.2 (on the 25 fps grid) and 1.48, which no beat is near.
    project["broll"] = [
        {"source": "a", "in": 0, "out": round(0.52 * T), "start": round(0.68 * T)},
        {"source": "a", "in": 0, "out": round(0.28 * T), "start": round(1.2 * T)},
    ]
    path.write_text(json.dumps(project))
    beats_score = edit.score(path)["beats"]
    assert beats_score == {"edges": 4, "near": 3, "max_abs_ms": 20.0, "mean_abs_ms": 6.7}
    assert edit.summarize([edit.score(path)])["beats"]["max_abs_ms"] == 20.0


def test_callouts_are_scored_through_their_crop_against_the_region_on_screen(tmp_path):
    path = corpus(tmp_path, [(1.2, 2.0), (5.45, 6.45)], target=1.8)
    clip = tmp_path / "a1"
    index = {"source": {"duration": 8.0, "video": {"width": 1280, "height": 720}}}
    (clip / "index.json").write_text(json.dumps(index))
    # A field from 0.4 to 0.5 of the picture's width, on screen from 1 s to 2 s of the source.
    field = {"x": 0.4, "y": 0.2, "w": 0.1, "h": 0.1}
    regions = [{"start": 1.0, "end": 2.0, "name": "field", "rect": field}]
    (clip / "truth" / "regions.json").write_text(json.dumps({"regions": regions}))
    project = json.loads(path.read_text())
    project["output"] |= {"width": 1080, "height": 1920}
    # A 9:16 crop from 0.3 of the 16:9 picture: 0.316406 of its width.
    crop = {"type": "static", "rect": {"x": 0.3, "y": 0.0, "w": 0.316406, "h": 1.0}}
    for clip in project["main"]:
        clip["framing"] = {"crop": crop}
    on = {"x": (0.4 - 0.3) / 0.316406, "y": 0.2, "w": 0.1 / 0.316406, "h": 0.1}
    off = on | {"y": 0.6}

    def callout(start, rect):
        return {"template": "callout", "start": round(start * T), "duration": 3 * T,
                "params": {"rect": rect}}  # fmt: skip

    # Named 0.3 s after each start: at 1.5 s and 1.6 s of the source, then at 5.75 s, where
    # the truth has no region.
    project["overlays"] = [callout(0.0, on), callout(0.1, off), callout(0.8, on)]
    path.write_text(json.dumps(project))
    scored = edit.score(path)["callouts"]
    assert scored == {"count": 3, "on_target": 1, "mean_iou": 0.333, "ious": [1.0, 0.0, 0.0]}
    pooled = edit.summarize([edit.score(path)])["callouts"]
    assert pooled == {"count": 3, "scored": 3, "on_target": 1, "mean_iou": 0.333}


def test_a_callout_over_the_whole_picture_in_a_taller_frame_is_scored_where_it_shows(tmp_path):
    path = corpus(tmp_path, [(1.2, 2.0)], target=0.8)
    clip = tmp_path / "a1"
    index = {"source": {"duration": 8.0, "video": {"width": 1280, "height": 720}}}
    (clip / "index.json").write_text(json.dumps(index))
    field = {"x": 0.4, "y": 0.2, "w": 0.1, "h": 0.1}
    regions = [{"start": 1.0, "end": 2.0, "name": "field", "rect": field}]
    (clip / "truth" / "regions.json").write_text(json.dumps({"regions": regions}))
    project = json.loads(path.read_text())
    project["output"] |= {"width": 1080, "height": 1920}
    # The whole 16:9 picture in the middle of the 9:16 frame: the crop reaches past its top and
    # bottom, 3.16 times its height.
    h = (16 / 9) / (9 / 16)
    crop = {"type": "static", "rect": {"x": 0.0, "y": (1 - h) / 2, "w": 1.0, "h": h}}
    project["main"][0]["framing"] = {"crop": crop}
    on = {"x": 0.4, "y": (0.2 - (1 - h) / 2) / h, "w": 0.1, "h": 0.1 / h}
    project["overlays"] = [
        {"template": "callout", "start": 0, "duration": 3 * T, "params": {"rect": on}}
    ]
    path.write_text(json.dumps(project))
    assert edit.score(path)["callouts"]["ious"] == [1.0]


def test_the_part_on_screen_of_a_split_screen_is_its_top_half():
    # A 9:16 frame split in two: the top half, 9:8, shows the top crop narrowed to that shape and
    # ignores a scale, as the engine's visible() does.
    aspect, shape = 16 / 9, 9 / 16
    top = {"x": 0.1, "y": 0.2, "w": 0.4, "h": 0.6}
    crop = {"type": "static", "rect": top, "below": {"x": 0.5, "y": 0.2, "w": 0.4, "h": 0.6}}
    x, y, w, h = edit._visible({"crop": crop, "scale": 1.2}, 0, aspect, shape)
    # 0.6 of the height is 0.6 × 9/8 of it wide, 0.3797 of the picture's width, centred on top's.
    assert (round(x, 4), round(y, 4), round(w, 4), round(h, 4)) == (0.1102, 0.2, 0.3797, 0.6)
