import json

import pytest

from vebench.cli import main


def run(capsys, *args):
    with pytest.raises(SystemExit) as exit_info:
        main(list(args))
    out = capsys.readouterr()
    return exit_info.value.code, out.out, out.err


def test_version(capsys):
    code, out, _ = run(capsys, "--version")
    assert code == 0 and out.startswith("vebench ")


def test_a_failure_is_one_line_not_a_traceback(capsys, tmp_path):
    code, _, err = run(capsys, "render", "--media", str(tmp_path / "x.mp4"), "--cuts",
                       str(tmp_path / "cuts.json"))  # fmt: skip
    assert code == 1
    assert err.startswith("vebench: error: ") and "Traceback" not in err


def test_report_on_a_missing_folder_fails(capsys, tmp_path):
    code, _, err = run(capsys, "report", str(tmp_path / "nope"))
    assert code == 1 and "nope" in err


def test_report_with_no_clips_fails(capsys, tmp_path):
    code, _, err = run(capsys, "report", str(tmp_path))
    assert code == 1 and "no clips with truth/" in err


def test_report_exits_nonzero_when_an_output_fails_to_score(capsys, tmp_path):
    truth = tmp_path / "a" / "truth"
    run_dir = tmp_path / "a" / "runs" / "sys"
    truth.mkdir(parents=True)
    run_dir.mkdir(parents=True)
    (truth / "transcript.txt").write_text("一")
    (run_dir / "transcript.json").write_text("{}")
    code, out, _ = run(capsys, "report", str(tmp_path))
    assert code == 1
    assert json.loads(out)["sys"]["errors"]


def test_help_explains_options(capsys):
    code, out, _ = run(capsys, "shots", "--help")
    assert code == 0
    assert "default: 0.1" in out and "truth" in out


@pytest.mark.parametrize(
    "ref, hyp",
    [("[1, 2]", "[1]"), ('{"transitions": 5}', "[1]"), ('{"transitions": []}', '{"cuts": 5}'),
     ('{"transitions": []}', '{"cuts": [null]}'), ('{"transitions": [{"end": 1}]}', "[1]")],
)  # fmt: skip
def test_malformed_shot_files_are_one_line_errors(capsys, tmp_path, ref, hyp):
    (tmp_path / "ref.json").write_text(ref)
    (tmp_path / "hyp.json").write_text(hyp)
    code, _, err = run(capsys, "shots", "--ref", str(tmp_path / "ref.json"), "--hyp",
                       str(tmp_path / "hyp.json"))  # fmt: skip
    assert code == 1 and err.startswith("vebench: error: ") and "json" in err


@pytest.mark.parametrize(
    "body", ['{"words": [1, 2]}', '{"text": "hi"}', '{"words": [{"text": 5}]}']
)
def test_malformed_transcripts_are_one_line_errors(capsys, tmp_path, body):
    (tmp_path / "t.json").write_text(body)
    code, _, err = run(capsys, "transcript", "--ref", str(tmp_path / "t.json"), "--hyp",
                       str(tmp_path / "t.json"))  # fmt: skip
    assert code == 1 and err.startswith("vebench: error: t.json")
