import json

import pytest

from vebench import tables

TABLE = {"doc": "docs/m.md", "columns": ["Model", "MER"], "rows": [["a", "3.1 %"], ["b", "2.0 %"]]}


def corpus(tmp_path, doc_text):
    (tmp_path / "bench" / "results").mkdir(parents=True)
    (tmp_path / "bench" / "results" / "asr.json").write_text(json.dumps(TABLE))
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "m.md").write_text(doc_text)
    return tmp_path / "docs" / "m.md"


def test_a_results_table_is_written_between_its_markers_and_nowhere_else(tmp_path):
    doc = corpus(tmp_path, "Before.\n<!-- results:asr -->\nold\n<!-- /results -->\nAfter.\n")
    assert tables.write(tmp_path, check=True) == ["docs/m.md"]
    assert tables.write(tmp_path) == ["docs/m.md"]
    assert doc.read_text() == (
        "Before.\n<!-- results:asr -->\n| Model | MER |\n|---|---|\n| a | 3.1 % |\n| b | 2.0 % |\n"
        "<!-- /results -->\nAfter.\n"
    )
    assert tables.write(tmp_path, check=True) == []


def test_a_table_its_document_does_not_mark_is_an_error(tmp_path):
    corpus(tmp_path, "No markers.\n")
    with pytest.raises(ValueError, match="results:asr"):
        tables.write(tmp_path)


def test_a_new_table_is_written_into_empty_markers(tmp_path):
    doc = corpus(tmp_path, "<!-- results:asr -->\n<!-- /results -->\n")
    tables.write(tmp_path)
    assert doc.read_text().startswith("<!-- results:asr -->\n| Model | MER |\n")
    assert doc.read_text().endswith("| b | 2.0 % |\n<!-- /results -->\n")


def test_an_empty_block_ends_at_its_own_closing_marker(tmp_path):
    empty = "<!-- results:{} -->\n<!-- /results -->\n"
    doc = corpus(tmp_path, empty.format("asr") + "Middle.\n" + empty.format("wer"))
    wer = {**TABLE, "columns": ["Model", "WER"]}
    (tmp_path / "bench" / "results" / "wer.json").write_text(json.dumps(wer))
    tables.write(tmp_path)
    block = "<!-- results:{} -->\n{}\n<!-- /results -->\n"
    assert doc.read_text() == (
        block.format("asr", tables.render(TABLE))
        + "Middle.\n"
        + block.format("wer", tables.render(wer))
    )
