import json

import pytest

from vebench.transcript import Unit, load, score, tokenize


def test_tokenize_splits_han_per_character_and_keeps_latin_words():
    assert tokenize("我們用 OpenAI 的 API，don’t 擔心！2026年") == [
        ("我", True),
        ("們", True),
        ("用", True),
        ("openai", False),
        ("的", True),
        ("api", False),
        ("don't", False),
        ("擔", True),
        ("心", True),
        ("2026", False),
        ("年", True),
    ]


def test_tokenize_folds_full_width_and_case():
    assert tokenize("ＡＰＩ Api") == [("api", False), ("api", False)]


def test_score_counts_mixed_script_errors_separately():
    ref = [Unit("今天 我們 來 測試 Claude API")]
    hyp = [Unit("今天 我門 來 測試 Cloud API 喔")]
    result = score(ref, hyp)
    # 今天我們來測試 = 7 chars, claude + api = 2 words.
    assert result["ref_tokens"] == 9
    assert (result["substitutions"], result["deletions"], result["insertions"]) == (2, 0, 1)
    assert result["mer"] == pytest.approx(3 / 9)
    assert result["cjk_error_rate"] == pytest.approx(2 / 7)  # 們→門 and the inserted 喔
    assert result["latin_error_rate"] == pytest.approx(1 / 2)  # claude→cloud
    assert result["timing"] is None


def test_timing_compares_matched_tokens_and_splits_multi_character_units():
    ref = [Unit("大家", 1.0, 1.4), Unit("好", 1.4, 1.6)]
    hyp = [Unit("大", 1.0, 1.2), Unit("家", 1.2, 1.4), Unit("好", 1.48, 1.6)]
    timing = score(ref, hyp)["timing"]
    assert timing["matched_tokens"] == 3
    assert timing["start_abs_ms"]["p50"] == pytest.approx(0)
    assert timing["within_50ms"] == 2 / 3
    assert timing["within_100ms"] == 1


def test_perfect_transcript_scores_zero():
    units = [Unit("Hello 世界", 0.0, 1.0)]
    assert score(units, units)["mer"] == 0


def test_load_reads_seconds_and_srt(tmp_path):
    seconds = tmp_path / "seconds.json"
    seconds.write_text(
        json.dumps(
            {
                "words": [
                    {"text": "你好", "start": 0.1, "end": 0.4, "type": "word"},
                    {"text": " ", "start": 0.4, "end": 0.5, "type": "spacing"},
                    {"text": "(laughter)", "start": 0.5, "end": 1.0, "type": "audio_event"},
                ]
            }
        )
    )
    assert load(seconds) == [Unit("你好", 0.1, 0.4)]

    srt = tmp_path / "subs.srt"
    srt.write_text(
        "1\n00:00:00,000 --> 00:00:01,000\n第一行\n第二行\n\n2\n00:00:01,000 --> "
        "00:00:02,000\nnext\n",
        encoding="utf-8",
    )
    assert load(srt) == [Unit("第一行 第二行"), Unit("next")]


def test_srt_markup_is_not_scored_as_words(tmp_path):
    srt = tmp_path / "subs.srt"
    srt.write_text(
        '1\n00:00:00,000 --> 00:00:01,000\n{\\an8}<i>你好</i>\n<font color="#ffffff">世界</font>\n',
        encoding="utf-8",
    )
    assert score([Unit("你好世界")], load(srt))["mer"] == 0


def test_tokenize_cjk_edges():
    # The katakana middle dot is punctuation; 〇 and bopomofo are single CJK tokens.
    assert tokenize("史蒂夫・賈伯斯") == tokenize("史蒂夫·賈伯斯")
    assert tokenize("一〇〇年 ㄅㄆ") == [
        ("一", True),
        ("〇", True),
        ("〇", True),
        ("年", True),
        ("ㄅ", True),
        ("ㄆ", True),
    ]


def test_unknown_json_names_the_problem(tmp_path):
    odd = tmp_path / "odd.json"
    odd.write_text('{"results": []}')
    with pytest.raises(ValueError, match="odd.json: not a recognized transcript"):
        load(odd)


def test_a_machine_draft_is_not_truth(tmp_path):
    # Scoring an uncorrected draft would only measure agreement with the model that wrote it.
    draft = tmp_path / "transcript.json"
    draft.write_text('{"draft": "correct me", "words": [{"text": "你好"}]}')
    with pytest.raises(ValueError, match="transcript.json: a machine draft"):
        load(draft)
