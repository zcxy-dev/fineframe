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
