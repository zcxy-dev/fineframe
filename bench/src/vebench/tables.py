"""Measurement tables written from data: each `bench/results/<name>.json` holds one table's
numbers, and the document it names shows them between `<!-- results:<name> -->` and
`<!-- /results -->`. A pull request then changes one small data file per measurement, and the
tables in the docs are written again, never by hand."""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def render(table: dict) -> str:
    """The table as Markdown: `columns` as the header, then each of `rows`, numbers as given."""
    cells = [table["columns"], *table["rows"]]
    lines = ["| " + " | ".join(str(cell) for cell in row) + " |" for row in cells]
    lines.insert(1, "|" + "---|" * len(table["columns"]))
    return "\n".join(lines)


def write(root: Path = ROOT, check: bool = False) -> list[str]:
    """Writes every results table into its document; returns the documents that changed, or with
    `check`, that would change, without writing them."""
    changed: dict[Path, str] = {}
    for path in sorted((root / "bench" / "results").glob("*.json")):
        table = json.loads(path.read_text(encoding="utf-8"))
        doc = root / table["doc"]
        text = changed.get(doc) or doc.read_text(encoding="utf-8")
        marker = re.compile(
            rf"(<!-- results:{re.escape(path.stem)} -->\n)(?:.*?\n)?(<!-- /results -->)", re.S
        )
        if not marker.search(text):
            raise ValueError(f"{table['doc']} has no <!-- results:{path.stem} --> block")
        markdown = render(table)
        changed[doc] = marker.sub(lambda m, md=markdown: m.group(1) + md + "\n" + m.group(2), text)
    stale = []
    for doc, text in changed.items():
        if text != doc.read_text(encoding="utf-8"):
            stale.append(str(doc.relative_to(root)))
            if not check:
                doc.write_text(text, encoding="utf-8")
    return stale
