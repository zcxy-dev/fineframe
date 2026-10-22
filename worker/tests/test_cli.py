import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

from vework import denoise, events, framing, shots, speech, transcribe
from vework.cli import _stem, main


def run(capsys, *args):
    with pytest.raises(SystemExit) as exit_info:
        main(list(args))
    out = capsys.readouterr()
    return exit_info.value.code, out.out, out.err


def test_version(capsys):
    code, out, _ = run(capsys, "--version")
    assert code == 0 and out.startswith("vework ")


def test_messages_are_utf8_whatever_the_system_encoding(tmp_path):
    # Windows writes to a pipe in its ANSI code page, which has no CJK; the engine reads UTF-8.
    source = tmp_path / "訪談.mp4"
    env = {**os.environ, "PYTHONIOENCODING": "cp1252"}
    env.pop("PYTHONUTF8", None)
    done = subprocess.run(
        [sys.executable, "-c", "from vework.cli import main; main()", "analyze", str(source),
         "-o", str(tmp_path / "i.json")],
        capture_output=True, env=env,
    )  # fmt: skip
    assert done.returncode == 1
    assert "訪談.mp4" in done.stderr.decode("utf-8")


def test_missing_source_is_one_line_not_a_traceback(capsys, tmp_path):
    code, _, err = run(capsys, "analyze", str(tmp_path / "x.mp4"), "-o", str(tmp_path / "i.json"))
    assert code == 1
    last = err.strip().splitlines()[-1]
    assert last.startswith("vework: error: ") and "x.mp4" in last and "Traceback" not in err


@pytest.mark.parametrize(
    "call",
    [
        lambda: shots.predict(np.zeros((1, 27, 48, 3), np.uint8)),
        lambda: speech.segments(np.zeros(16_000, np.float32)),
        lambda: transcribe._recognizer("Qwen/Qwen3-ASR-0.6B-hf"),
        transcribe._aligner,
        events._classifier,
        lambda: framing._detector((64, 36)),
        denoise._model,
    ],
)
@pytest.mark.parametrize("missing", ["torch", "onnxruntime", "huggingface_hub", "cv2"])
def test_missing_ml_extra_says_how_to_install_it(monkeypatch, call, missing):
    monkeypatch.setitem(sys.modules, missing, None)
    for cached in (transcribe._device, transcribe._recognizer, transcribe._aligner):
        cached.cache_clear()
    denoise._model.cache_clear()
    with pytest.raises(RuntimeError, match="needs the ml group"):
        call()


def test_unwritable_output_fails_before_the_analysis(capsys, tmp_path, monkeypatch):
    source = tmp_path / "tone.wav"
    source.write_bytes(b"")  # never read: the output check comes first
    monkeypatch.setattr("vework.index.build", lambda *a, **k: pytest.fail("analysis ran"))
    code, _, err = run(capsys, "analyze", str(source), "-o", str(tmp_path / "nodir" / "i.json"))
    assert code == 1 and "nodir" in err


def test_bench_run_pointing_at_a_file_fails_before_the_analysis(capsys, tmp_path, monkeypatch):
    taken = tmp_path / "taken"
    taken.write_text("")
    monkeypatch.setattr("vework.index.build", lambda *a, **k: pytest.fail("analysis ran"))
    code, _, err = run(capsys, "analyze", str(taken), "-o", str(tmp_path / "i.json"),
                       "--bench-run", str(taken))  # fmt: skip
    assert code == 1 and "taken" in err


@pytest.mark.parametrize(
    "flags", [["--batch"], ["--title", "Talk"], ["--asr-context"], ["--glossary", "terms.txt"]]
)
def test_options_that_need_another_option_fail_at_once(capsys, tmp_path, flags):
    code, _, err = run(capsys, "analyze", "talk.mp4", "-o", str(tmp_path / "i.json"), *flags)
    assert code == 2 and "need" in err


def test_correct_without_a_key_fails_before_the_analysis(
    capsys, tmp_path, monkeypatch, no_credentials
):
    source = tmp_path / "talk.mp4"
    source.write_bytes(b"")  # never read: the key check comes first
    monkeypatch.setattr("vework.index.build", lambda *a, **k: pytest.fail("analysis ran"))
    code, _, err = run(capsys, "analyze", str(source), "-o", str(tmp_path / "i.json"), "--correct")
    assert code == 1 and "ANTHROPIC_API_KEY" in err and "Traceback" not in err


def test_cloud_speech_without_a_key_fails_before_the_analysis(capsys, tmp_path, monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    source = tmp_path / "talk.mp4"
    source.write_bytes(b"")
    monkeypatch.setattr("vework.index.build", lambda *a, **k: pytest.fail("analysis ran"))
    code, _, err = run(capsys, "analyze", str(source), "-o", str(tmp_path / "i.json"),
                       "--asr", "cloud")  # fmt: skip
    assert code == 1 and "OPENROUTER_API_KEY" in err and "Traceback" not in err


def test_the_context_prompt_needs_the_local_speech_model(capsys, tmp_path):
    code, _, err = run(capsys, "analyze", "talk.mp4", "-o", str(tmp_path / "i.json"),
                       "--asr", "cloud", "--glossary", "terms.txt", "--asr-context")  # fmt: skip
    assert code == 2 and "--asr local" in err


def test_a_broken_credentials_profile_fails_with_a_message(
    capsys, tmp_path, monkeypatch, no_credentials
):
    monkeypatch.setenv("ANTHROPIC_PROFILE", "missing")
    source = tmp_path / "talk.mp4"
    source.write_bytes(b"")
    monkeypatch.setattr("vework.index.build", lambda *a, **k: pytest.fail("analysis ran"))
    code, _, err = run(capsys, "analyze", str(source), "-o", str(tmp_path / "i.json"), "--correct")
    assert code == 1 and "vework: error: " in err and "missing" in err and "Traceback" not in err


def test_the_denoised_speech_is_named_after_the_index():
    assert _stem(Path("out/talk.index.json")) == Path("out/talk.voice.wav")
    assert _stem(Path("talk.json")) == Path("talk.voice.wav")


def test_a_source_where_its_denoised_speech_would_go_fails_before_the_analysis(
    capsys, tmp_path, monkeypatch
):
    source = tmp_path / "talk.voice.wav"
    source.write_bytes(b"")  # never read: the output check comes first
    monkeypatch.setattr("vework.index.build", lambda *a, **k: pytest.fail("analysis ran"))
    code, _, err = run(capsys, "analyze", str(source), "-o", str(tmp_path / "talk.json"))
    assert code == 1 and "talk.voice.wav" in err and source.exists()
