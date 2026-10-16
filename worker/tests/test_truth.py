import json
import re

import pytest
from conftest import ffmpeg

from vework import speech, transcribe
from vework.cli import main


def run(capsys, *args):
    with pytest.raises(SystemExit) as exit_info:
        main(list(args))
    return exit_info.value.code, capsys.readouterr().err


@pytest.fixture
def clip(tmp_path):
    folder = tmp_path / "talk"
    folder.mkdir()
    ffmpeg("-f", "lavfi", "-i", "sine=f=220:d=5:sample_rate=16000", str(folder / "source.wav"))
    return folder


@pytest.fixture
def heard():
    """What the fake model hears in each chunk of speech."""
    return ["处理视频。"]


@pytest.fixture
def fake_asr(monkeypatch, heard):
    """Two chunks of speech, each heard as `heard`; records the model asked for."""
    models = []

    def align(wav, text, language):
        # The aligner's tokens: each Han character, each English word without punctuation.
        tokens = re.findall(r"[\u4e00-\u9fff]|[A-Za-z]+", text)
        return [(c, 0.05 + i * 0.1, 0.15 + i * 0.1) for i, c in enumerate(tokens)]

    def load(model):
        models.append(model)
        return (lambda wav, context: (heard[0], "Chinese")), align

    monkeypatch.setattr(transcribe, "_models", load)
    monkeypatch.setattr(
        speech, "segments", lambda samples: [{"start": 0.5, "end": 1.5}, {"start": 3.0, "end": 4.2}]
    )
    return models


def test_draft_is_one_untimed_line_per_sentence_from_the_large_model(clip, fake_asr):
    main(["draft-truth", str(clip)])
    draft = json.loads((clip / "truth" / "transcript.json").read_text())
    assert fake_asr == ["Qwen/Qwen3-ASR-1.7B-hf"]
    assert "Qwen/Qwen3-ASR-1.7B-hf" in draft["draft"]
    # No start/end: aligner times scored as truth would only measure agreement with the aligner.
    assert draft["words"] == [
        {"text": "處理影片。", "draft_time": [0.55, 0.95]},
        {"text": "處理影片。", "draft_time": [3.05, 3.45]},
    ]


def test_a_chunk_of_several_sentences_drafts_a_line_for_each(clip, fake_asr, heard):
    heard[0] = "我们用 Claude API 剪片。处理视频！"
    main(["draft-truth", str(clip)])
    lines = json.loads((clip / "truth" / "transcript.json").read_text())["words"]
    # The spaces around English words stay as the model wrote them.
    assert lines[:2] == [
        {"text": "我們用 Claude API 剪片。", "draft_time": [0.55, 1.25]},
        {"text": "處理影片！", "draft_time": [1.25, 1.5]},
    ]


def test_a_clip_without_speech_drafts_nothing_without_loading_the_model(
    clip, fake_asr, monkeypatch
):
    monkeypatch.setattr(speech, "segments", lambda samples: [])
    main(["draft-truth", str(clip)])
    assert json.loads((clip / "truth" / "transcript.json").read_text())["words"] == []
    assert fake_asr == []


def test_asr_model_can_be_overridden(clip, fake_asr):
    main(["draft-truth", str(clip), "--asr-model", "Qwen/Qwen3-ASR-0.6B-hf"])
    assert fake_asr == ["Qwen/Qwen3-ASR-0.6B-hf"]


def test_corrected_truth_is_kept_unless_forced(clip, fake_asr, capsys):
    truth = clip / "truth"
    truth.mkdir()
    (truth / "transcript.json").write_text("corrected by hand")
    code, err = run(capsys, "draft-truth", str(clip))
    assert code == 1 and "transcript.json" in err and "--force" in err
    assert fake_asr == []  # refused before the model loaded
    assert (truth / "transcript.json").read_text() == "corrected by hand"

    main(["draft-truth", str(clip), "--force"])
    assert "draft" in json.loads((truth / "transcript.json").read_text())


@pytest.mark.parametrize("name", ["transcript.srt", "transcript.txt"])
def test_force_never_shadows_a_corrected_srt_or_txt(clip, fake_asr, capsys, name):
    # vebench reads transcript.json first, so a draft beside this file would replace it as truth.
    truth = clip / "truth"
    truth.mkdir()
    (truth / name).write_text("corrected by hand")
    for args in ([], ["--force"]):
        code, err = run(capsys, "draft-truth", str(clip), *args)
        assert code == 1 and name in err and "move it" in err
    assert fake_asr == []
    assert sorted(p.name for p in truth.iterdir()) == [name]


def test_clip_needs_exactly_one_source(tmp_path, capsys):
    code, err = run(capsys, "draft-truth", str(tmp_path))
    assert code == 1 and "source" in err
    (tmp_path / "source.mp4").write_bytes(b"")
    (tmp_path / "source.mov").write_bytes(b"")
    code, err = run(capsys, "draft-truth", str(tmp_path))
    assert code == 1 and "source.mov" in err and "source.mp4" in err
