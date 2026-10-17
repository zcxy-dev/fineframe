from itertools import pairwise

import numpy as np
import pytest
from conftest import tone

from vework import transcribe
from vework.transcribe import attach_punctuation, plan_chunks, repair_durations, to_traditional


def seg(start, end):
    return {"start": start, "end": end}


def test_chunks_hold_only_speech_and_split_at_pauses():
    # A sentence-length pause starts a new chunk; breaths inside a sentence do not.
    speech = [seg(0.5, 3.8), seg(5.3, 7.8), seg(8.0, 11.3), seg(11.7, 15.0)]
    assert plan_chunks(speech) == [(0.5, 3.8), (5.3, 15.0)]


def test_chunks_stay_under_the_length_limit():
    speech = [seg(i, i + 0.9) for i in range(0, 70)]  # 0.1 s pauses, never sentence-length
    chunks = plan_chunks(speech, max_len=30)
    assert all(end - start <= 30 for start, end in chunks)
    assert chunks[0] == (0, 29.9) and chunks[-1][1] == 69.9


def test_speech_longer_than_a_chunk_is_split_at_fixed_points():
    assert plan_chunks([seg(0, 70)], max_len=30) == [(0, 30), (30, 60), (60, 70)]


def aligned(text):
    """The tokens the aligner times for `text`, with made-up one-second timings."""
    from transformers import AutoProcessor

    processor = AutoProcessor.from_pretrained(
        transcribe.ALIGNER_MODEL, revision=transcribe.REVISIONS[transcribe.ALIGNER_MODEL]
    )
    tokens = processor.split_words_for_alignment(text)
    return [(t, float(i), float(i + 1)) for i, t in enumerate(tokens)]


def display(text):
    return [w["text"] for w in attach_punctuation(text, aligned(text))]


@pytest.mark.ml
def test_punctuation_follows_the_words_it_belongs_to():
    assert display("他說「你好」，我們用 Claude API。") == [
        "他", "說", "「你", "好」，", "我", "們", "用", "Claude", "API。"
    ]  # fmt: skip
    assert display("請看《紅樓夢》（大家）都在。")[:6] == ["請", "看", "《紅", "樓", "夢》", "（大"]


@pytest.mark.ml
def test_words_the_aligner_normalizes_appear_once_as_written():
    assert display("It costs 3.5 dollars, about 1,000 yen.") == [
        "It", "costs", "3.5", "dollars,", "about", "1,000", "yen."
    ]  # fmt: skip
    assert display("We use a state-of-the-art model from the U.S. — I don’t know.") == [
        "We", "use", "a", "state-of-the-art", "model", "from", "the", "U.S. —", "I", "don’t",
        "know.",
    ]  # fmt: skip
    assert display("這是 3.5 版，用 Wi-Fi 😀 很好。") == [
        "這", "是", "3.5", "版，", "用", "Wi-Fi 😀", "很", "好。"
    ]  # fmt: skip


def test_tokens_that_do_not_match_the_text_keep_their_timing_without_punctuation():
    words = attach_punctuation("hello world", [("hello", 0, 1), ("there", 1, 2), ("world", 2, 3)])
    assert [(w["text"], w["start"]) for w in words] == [("hello", 0), ("there", 1), ("world", 2)]


def test_zero_length_word_takes_the_gap_around_it():
    words = [
        {"text": "易", "start": 1.76, "end": 2.0},
        {"text": "幾", "start": 2.08, "end": 2.08},
        {"text": "乎", "start": 2.24, "end": 2.48},
    ]
    assert repair_durations(words)[1] == {"text": "幾", "start": 2.0, "end": 2.24}


def test_a_run_of_zero_length_words_shares_the_gap():
    words = [
        {"text": "a", "start": 0.0, "end": 1.0},
        {"text": "b", "start": 1.0, "end": 1.0},
        {"text": "c", "start": 1.0, "end": 1.0},
        {"text": "d", "start": 2.0, "end": 2.5},
    ]
    assert [(w["start"], w["end"]) for w in repair_durations(words)] == [
        (0.0, 1.0), (1.0, 1.5), (1.5, 2.0), (2.0, 2.5)
    ]  # fmt: skip


def test_zero_length_word_without_free_time_takes_a_share_of_its_neighbors():
    # The aligner gave "了" the time of "了我"; no gap is left for "我".
    words = [
        {"text": "了", "start": 10.978, "end": 11.218},
        {"text": "我", "start": 11.218, "end": 11.218},
        {"text": "的", "start": 11.218, "end": 11.298},
    ]
    assert [(w["start"], w["end"]) for w in repair_durations(words)] == [
        (10.978, 11.085), (11.085, 11.191), (11.191, 11.298)
    ]  # fmt: skip


def test_a_zero_length_word_takes_no_share_of_an_english_neighbor():
    # "JS" is several syllables, not one to split evenly with "個"; "這" shares its time.
    words = [
        {"text": "這", "start": 1.0, "end": 1.16},
        {"text": "個", "start": 1.16, "end": 1.16},
        {"text": "JS", "start": 1.16, "end": 1.64},
    ]
    assert [(w["start"], w["end"]) for w in repair_durations(words)] == [
        (1.0, 1.08), (1.08, 1.16), (1.16, 1.64)
    ]  # fmt: skip


def test_a_lone_zero_length_word_stays_put():
    assert repair_durations([{"text": "嗯", "start": 1.0, "end": 1.0}]) == [
        {"text": "嗯", "start": 1.0, "end": 1.0}
    ]


def test_traditional_uses_taiwan_vocabulary_and_leaves_english():
    assert to_traditional("这个软件用 Claude API 处理视频") == "這個軟體用 Claude API 處理影片"


def fake_models(monkeypatch, text, language, item_times=None):
    calls = []

    def align(wav, text):
        calls.append((text, language, len(wav)))
        chars = [c for c in text if c.strip() and c not in "。，"]
        times = item_times or [(i * 0.2, (i + 1) * 0.2) for i in range(len(chars))]
        return [(c, s, e) for c, (s, e) in zip(chars, times, strict=False)]

    detected = language
    monkeypatch.setattr(
        transcribe, "_models", lambda model: (lambda wav, context: (text, detected), align)
    )
    return calls


def test_zero_length_words_never_stretch_across_chunks(monkeypatch):
    fake_models(monkeypatch, "你好。", "Chinese", item_times=[(0.0, 0.3), (0.5, 0.5)])
    audio = np.zeros(16_000 * 300, np.float32)
    words = transcribe.transcribe(audio, [seg(10, 12), seg(250, 252)])["words"]
    assert all(w["end"] - w["start"] < 2 for w in words)


def test_word_times_stay_inside_the_real_audio_of_a_padded_chunk(monkeypatch):
    fake_models(monkeypatch, "嗯。", "Chinese", item_times=[(0.05, 0.45)])
    words = transcribe.transcribe(np.zeros(16_000 * 2, np.float32), [seg(1.0, 1.2)])["words"]
    assert words == [{"text": "嗯。", "start": 1.05, "end": 1.2}]


def test_word_edges_are_read_from_the_audio_below_the_aligner_grid(monkeypatch):
    # Syllables sound at 1.0-1.37 and 1.40-1.64; the aligner reports the boundary at 1.32, the
    # start of the 80 ms frame holding the dip between them.
    fake_models(monkeypatch, "大家", "Chinese", item_times=[(0.0, 0.32), (0.32, 0.64)])
    audio = tone((1.0, 1.37), (1.37, 1.40, 0.05), (1.40, 1.64))
    words = transcribe.transcribe(audio, [seg(1.0, 1.7)])["words"]
    assert words[0]["end"] == words[1]["start"]
    assert 1.37 <= words[1]["start"] <= 1.40


def test_a_word_the_aligner_gave_no_time_is_not_read_as_a_pause(monkeypatch):
    # "我" sounds at 1.34-1.59, between shallow dips; the aligner gives it no duration and leaves
    # a gap before "請". The edges around it are boundaries between words, not pause edges.
    fake_models(
        monkeypatch, "天我請", "Chinese", item_times=[(0.0, 0.32), (0.32, 0.32), (0.56, 0.8)]
    )
    audio = tone((1.0, 1.33), (1.33, 1.35, 0.25), (1.35, 1.58), (1.58, 1.60, 0.25), (1.60, 1.8))
    words = transcribe.transcribe(audio, [seg(1.0, 1.85)])["words"]
    assert 1.33 <= words[1]["start"] <= 1.35
    assert 1.58 <= words[1]["end"] <= 1.60


def test_word_edges_never_cross_into_the_next_chunk(monkeypatch):
    # One minute of speech without a pause is split at 30 s. A dip just after the split would
    # draw the first chunk's last edge past the second chunk's first word.
    fake_models(monkeypatch, "大好", "Chinese", item_times=[(0.0, 0.3), (29.875, 30.0)])
    audio = tone((0.0, 30.05), (30.05, 30.07, 0.05), (30.07, 60.0), length=60.0)
    words = transcribe.transcribe(audio, [seg(0.0, 59.99)])["words"]
    assert words[1]["end"] <= 30.0
    assert all(w["end"] <= nxt["start"] for w, nxt in pairwise(words))


def test_japanese_keeps_its_punctuation(monkeypatch):
    fake_models(monkeypatch, "会社に行く。", "Japanese")
    words = transcribe.transcribe(np.zeros(16_000 * 3, np.float32), [seg(0.5, 2.5)])["words"]
    assert [w["text"] for w in words] == ["会", "社", "に", "行", "く。"]


def test_japanese_is_not_converted_to_chinese(monkeypatch):
    calls = fake_models(monkeypatch, "会社に行く", "Japanese")
    transcribe.transcribe(np.zeros(16_000 * 3, np.float32), [seg(0.5, 2.5)])
    assert calls[0][:2] == ("会社に行く", "Japanese")


def test_main_language_is_weighted_by_speaking_time(monkeypatch):
    texts = iter(
        [("我們今天來聊聊", "Chinese"), ("Okay so basically what we are doing", "English")]
    )

    monkeypatch.setattr(
        transcribe, "_models", lambda model: (lambda wav, context: next(texts), lambda *a: [])
    )
    # 20 s of Chinese against 3 s of fast English.
    result = transcribe.transcribe(np.zeros(16_000 * 30, np.float32), [seg(1, 21), seg(25, 28)])
    assert result["language"] == "zh"


def test_transcribe_converts_aligns_and_offsets_each_chunk(monkeypatch):
    calls = []

    def align(wav, text):
        calls.append((text, len(wav)))
        chars = [c for c in text if c != "。"]
        return [(c, i * 0.2, (i + 1) * 0.2) for i, c in enumerate(chars)]

    monkeypatch.setattr(
        transcribe, "_models", lambda model: (lambda wav, context: ("处理视频。", "Chinese"), align)
    )
    result = transcribe.transcribe(np.zeros(16_000 * 300, np.float32), [seg(10, 12), seg(250, 251)])

    assert calls == [("處理影片。", 32_000), ("處理影片。", 16_000)]
    assert result["language"] == "zh"
    assert result["words"][0] == {"text": "處", "start": 10.0, "end": 10.2}
    assert result["words"][4] == {"text": "處", "start": 250.0, "end": 250.2}
    assert result["words"][3]["text"] == "片。"


def test_the_aligner_times_the_corrected_text(monkeypatch):
    calls = fake_models(monkeypatch, "我們在來看。", "Chinese")
    seen = []

    def correct(chunks):
        seen.extend((c["start"], c["end"], c["text"], c["language"]) for c in chunks)
        return ["我們再來看。"]

    result = transcribe.transcribe(
        np.zeros(16_000 * 3, np.float32), [seg(0.5, 2.5)], correct=correct
    )
    assert seen == [(0.5, 2.5, "我們在來看。", "Chinese")]
    assert calls[0][0] == "我們再來看。"
    assert result["text"] == "我們再來看。" and result["words"][2]["text"] == "再"


def test_the_context_prompt_reaches_the_speech_model(monkeypatch):
    contexts = []

    def recognize(wav, context):
        contexts.append(context)
        return "", None

    monkeypatch.setattr(transcribe, "_models", lambda model: (recognize, None))
    transcribe.transcribe(np.zeros(16_000 * 3, np.float32), [seg(0.5, 2.5)], context="林佳穎")
    assert contexts == ["林佳穎"]


def test_short_speech_is_padded_to_the_model_minimum(monkeypatch):
    lengths = []

    def recognize(wav, context):
        lengths.append(len(wav))
        return "", None

    monkeypatch.setattr(transcribe, "_models", lambda model: (recognize, None))
    result = transcribe.transcribe(np.zeros(16_000, np.float32), [seg(0.1, 0.3)])
    assert lengths == [8_000]
    assert result == {"language": None, "text": "", "words": []}


@pytest.mark.ml
@pytest.mark.big
def test_models_load_and_handle_silence():
    # Real weights: silence must not produce invented words.
    result = transcribe.transcribe(
        np.zeros(16_000 * 2, np.float32), [seg(0.2, 1.8)], asr_model=transcribe.CPU_ASR_MODEL
    )
    assert result["words"] == []


@pytest.mark.ml
def test_default_model_fits_the_hardware(monkeypatch):
    import torch

    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    assert transcribe.default_asr_model() == transcribe.CPU_ASR_MODEL
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    assert transcribe.default_asr_model() == transcribe.GPU_ASR_MODEL


def test_a_cloud_recognizer_hears_every_chunk_at_once_and_only_the_aligner_loads(monkeypatch):
    monkeypatch.setattr(transcribe, "_models", lambda model: pytest.fail("speech model loaded"))
    aligned = []

    def align(wav, text):
        aligned.append((text, len(wav)))
        return [(c, i * 0.2, (i + 1) * 0.2) for i, c in enumerate(c for c in text if c != "。")]

    monkeypatch.setattr(transcribe, "_aligner", lambda half: half and align)
    sent = []

    def recognizer(wavs, progress):
        sent.extend(len(w) for w in wavs)
        return [("处理视频。", None), ("", None)]

    result = transcribe.transcribe(
        np.zeros(16_000 * 300, np.float32), [seg(10, 12), seg(250, 250.2)], recognizer=recognizer
    )
    # Chunks are padded as for the local model; a language the cloud did not name is read from
    # the script, so the one-language-per-chunk rule and the Taiwan conversion still hold.
    assert sent == [32_000, 8_000]
    assert aligned == [("處理影片。", 32_000)]
    assert result["language"] == "zh" and result["words"][0]["start"] == 10.0


def test_the_aligner_does_not_load_when_the_cloud_heard_nothing(monkeypatch):
    monkeypatch.setattr(transcribe, "_aligner", lambda half: pytest.fail("aligner loaded"))
    result = transcribe.transcribe(
        np.zeros(16_000 * 3, np.float32), [seg(0.5, 2.5)], recognizer=lambda w, p: [("", None)]
    )
    assert result == {"language": None, "text": "", "words": []}


@pytest.mark.parametrize(
    ("text", "language"),
    [("会社に行く", "Japanese"), ("안녕하세요", "Korean"), ("hello there", "English")],
)
def test_a_language_the_model_did_not_name_is_read_from_the_script(monkeypatch, text, language):
    fake_models(monkeypatch, text, None)
    result = transcribe.transcribe(np.zeros(16_000 * 3, np.float32), [seg(0.5, 2.5)])
    assert result["language"] == transcribe.LANGUAGE_CODES[language]
