import numpy as np
import pytest

from vebench.synth import speech

pytestmark = pytest.mark.synth

LINE = "嗯，我們用 Claude 剪 video。"


def test_each_written_word_gets_its_own_phonemes():
    phonemes, spans = speech.phonemize(LINE)
    assert len(spans) == len(speech.WORD.findall(LINE)) == 7
    ends = [b for _, b in spans]
    starts = [a for a, _ in spans[1:]] + [len(phonemes)]
    assert all(a < b <= c for (a, _), b, c in zip(spans, ends, starts, strict=True))


@pytest.mark.parametrize(
    ("line", "problem"), [("我們用 Zxqvbn 剪", "lexicon"), ("我有 3 支影片", "digits")]
)
def test_text_the_model_would_misread_is_refused(line, problem):
    with pytest.raises(ValueError, match=problem):
        speech.phonemize(line)


def test_words_are_timed_from_the_models_own_durations():
    audio, words = speech.say(LINE, "A", seed=1)
    assert [w[0] for w in words] == ["嗯，", "我", "們", "用", "Claude", "剪", "video。"]
    times = [t for _, start, end, _ in words for t in (start, end)]
    assert times == sorted(times) and times[-1] <= len(audio) / speech.RATE
    assert all(end > start for _, start, end, _ in words)
    again, _ = speech.say(LINE, "A", seed=1)
    assert np.array_equal(audio, again)
