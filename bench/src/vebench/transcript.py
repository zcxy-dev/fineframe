import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from rapidfuzz.distance import Levenshtein

# Han, kana, bopomofo and Hangul are scored per character: Chinese has no spaces, so a "word"
# error rate would depend on whichever segmenter was used. The katakana middle dot (U+30FB)
# is punctuation and stays out.
_CJK = (
    "\u3007\u3040-\u30fa\u30fc-\u30ff\u3100-\u312f\u31a0-\u31bf"
    "\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af\U00020000-\U0003134f"
)
_TOKEN = re.compile(rf"([{_CJK}])|([^\W_{_CJK}]+(?:'[^\W_{_CJK}]+)*)")


@dataclass(frozen=True)
class Unit:
    text: str
    start: float | None = None
    end: float | None = None


@dataclass(frozen=True)
class Token:
    text: str
    cjk: bool
    start: float | None
    end: float | None


def tokenize(text: str) -> list[tuple[str, bool]]:
    """Split text into (token, is_cjk) pairs after NFKC folding, lowercasing and unifying
    apostrophes; punctuation is dropped."""
    text = unicodedata.normalize("NFKC", text).lower().replace("’", "'")
    return [(m.group(0), m.group(1) is not None) for m in _TOKEN.finditer(text)]


def to_tokens(units: list[Unit]) -> list[Token]:
    tokens = []
    for unit in units:
        parts = tokenize(unit.text)
        timed = unit.start is not None and unit.end is not None
        step = (unit.end - unit.start) / len(parts) if timed and parts else 0.0
        for i, (text, cjk) in enumerate(parts):
            if timed:
                # Providers time multi-character units as a whole; split the span evenly.
                tokens.append(Token(text, cjk, unit.start + i * step, unit.start + (i + 1) * step))
            else:
                tokens.append(Token(text, cjk, None, None))
    return tokens


def load(path: Path) -> list[Unit]:
    """Read a transcript: JSON words in seconds, SRT or text."""
    suffix = path.suffix.lower()
    if suffix == ".srt":
        return _load_srt(path.read_text(encoding="utf-8-sig"))
    if suffix == ".txt":
        return [Unit(path.read_text(encoding="utf-8"))]
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and "draft" in data:
        raise ValueError(
            f'{path.name}: a machine draft; correct it, then delete its "draft" key '
            "(bench/README.md#ground-truth)"
        )
    try:
        # Some providers interleave "spacing" and "audio_event" entries with words.
        return [
            Unit(_text(w["text"]), w.get("start"), w.get("end"))
            for w in data["words"]
            if w.get("type", "word") == "word"
        ]
    except (KeyError, TypeError, AttributeError):
        raise ValueError(
            f'{path.name}: not a recognized transcript; expected {{"words": [{{"text", "start", '
            '"end"}]} in seconds'
        ) from None


def _text(value) -> str:
    if not isinstance(value, str):
        raise TypeError(value)
    return value


def _load_srt(text: str) -> list[Unit]:
    # Cue timing is too coarse to time tokens, so SRT is scored on text only.
    units = []
    for block in re.split(r"\n\s*\n", text.strip()):
        lines = block.splitlines()
        arrow = next((i for i, line in enumerate(lines) if "-->" in line), None)
        if arrow is not None:
            text = " ".join(lines[arrow + 1 :])
            # Formatting such as <i>, <font color=...> and {\\an8} is not speech.
            units.append(Unit(re.sub(r"<[^>]*>|\{\\[^}]*\}", "", text)))
    return units


@dataclass
class Comparison:
    ref_tokens: int
    ref_cjk: int
    substitutions: int = 0
    deletions: int = 0
    insertions: int = 0
    cjk_errors: int = 0
    latin_errors: int = 0
    start_deltas: list[float] = field(default_factory=list)
    end_deltas: list[float] = field(default_factory=list)


def compare(ref_units: list[Unit], hyp_units: list[Unit]) -> Comparison:
    """Count edits between the token sequences and time the tokens that match.

    Substitutions and deletions count against the script of the reference token, insertions
    against the script of the inserted one.
    """
    ref, hyp = to_tokens(ref_units), to_tokens(hyp_units)
    ref_text, hyp_text = [t.text for t in ref], [t.text for t in hyp]
    c = Comparison(ref_tokens=len(ref), ref_cjk=sum(t.cjk for t in ref))

    for op in Levenshtein.editops(ref_text, hyp_text):
        if op.tag == "replace":
            c.substitutions += 1
            cjk = ref[op.src_pos].cjk
        elif op.tag == "delete":
            c.deletions += 1
            cjk = ref[op.src_pos].cjk
        else:
            c.insertions += 1
            cjk = hyp[op.dest_pos].cjk
        if cjk:
            c.cjk_errors += 1
        else:
            c.latin_errors += 1

    for op in Levenshtein.opcodes(ref_text, hyp_text):
        if op.tag != "equal":
            continue
        pairs = zip(ref[op.src_start : op.src_end], hyp[op.dest_start : op.dest_end], strict=True)
        for r, h in pairs:
            if r.start is not None and h.start is not None:
                c.start_deltas.append(h.start - r.start)
                c.end_deltas.append(h.end - r.end)
    return c


def summarize(comparisons: list[Comparison]) -> dict:
    """Pool counts across clips, so long clips weigh more than short ones."""
    total = sum(c.ref_tokens for c in comparisons)
    cjk = sum(c.ref_cjk for c in comparisons)
    errors = {
        k: sum(getattr(c, k) for c in comparisons)
        for k in ("substitutions", "deletions", "insertions")
    }
    return {
        "ref_tokens": total,
        **errors,
        "mer": _rate(sum(errors.values()), total),
        "cjk_error_rate": _rate(sum(c.cjk_errors for c in comparisons), cjk),
        "latin_error_rate": _rate(sum(c.latin_errors for c in comparisons), total - cjk),
        "timing": _timing(
            [d for c in comparisons for d in c.start_deltas],
            [d for c in comparisons for d in c.end_deltas],
        ),
    }


def score(ref_units: list[Unit], hyp_units: list[Unit]) -> dict:
    return summarize([compare(ref_units, hyp_units)])


def _rate(errors: int, total: int) -> float | None:
    return errors / total if total else None


def _timing(starts: list[float], ends: list[float]) -> dict | None:
    if not starts:
        return None
    start_ms, end_ms = np.abs(starts) * 1000, np.abs(ends) * 1000
    both = np.maximum(start_ms, end_ms)
    return {
        "matched_tokens": len(starts),
        "start_abs_ms": _stats(start_ms),
        "end_abs_ms": _stats(end_ms),
        "within_50ms": float((both <= 50).mean()),
        "within_100ms": float((both <= 100).mean()),
    }


def _stats(values: np.ndarray) -> dict:
    return {
        "mean": float(values.mean()),
        "p50": float(np.median(values)),
        "p95": float(np.percentile(values, 95)),
    }
