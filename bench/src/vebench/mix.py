"""Whether speech stays clear over music: the voice and music stems of one render, measured
apart with FFmpeg's EBU R128 meter."""

import json
import re
from collections.abc import Sequence
from pathlib import Path

import numpy as np

from vebench.edit import TICKS
from vebench.render import CLICK, RATE, _ffmpeg, click_ratios, decode_audio

# BS.1770's gates: blocks under the absolute one are silence, and talking is the voice's blocks
# within the relative one of its own gated loudness.
ABSOLUTE = -70.0
RELATIVE = 10.0
# Blocks where the voice is this quiet are gaps between speech, where music may come back up.
GAP = -50.0
_VALUE = re.compile(r"lavfi\.r128\.M=(-?[\d.]+|-?inf)")


def momentary(path: Path) -> np.ndarray:
    """Momentary loudness (400 ms windows) every 100 ms, in LUFS, with every channel weighed."""
    if not path.is_file():
        raise FileNotFoundError(f"{path}: no such file")
    meter = "ebur128=metadata=1,ametadata=mode=print:key=lavfi.r128.M:file=-"
    proc = _ffmpeg("-v", "error", "-i", str(path), "-af", meter, "-f", "null", "-")
    if proc.returncode:
        raise RuntimeError(f"{path.name}: ffmpeg could not measure it")
    values = [float(v) for v in _VALUE.findall(proc.stdout.decode())]
    return np.array(values, float)


def _power_mean(levels: np.ndarray) -> float | None:
    return float(10 * np.log10(np.mean(10 ** (levels / 10)))) if len(levels) else None


def compare(voice: np.ndarray, music: np.ndarray) -> dict:
    """How far the voice stands over the music while talking, and how far the music comes back
    up in the gaps, from both stems' momentary loudness on the same 100 ms steps."""
    n = min(len(voice), len(music))
    voice, music = voice[:n], music[:n]
    heard = voice[voice > ABSOLUTE]
    level = _power_mean(heard)
    if level is None:
        return {"talking_blocks": 0, "voice_lufs": None, "music_lufs": None, "over_music_db": None,
                "p5_over_music_db": None, "music_in_gaps_lufs": None}  # fmt: skip
    level = _power_mean(heard[heard >= level - RELATIVE])
    talking = voice >= level - RELATIVE
    under = np.maximum(music[talking], ABSOLUTE)
    gaps = music[(voice < GAP) & (music > ABSOLUTE)]
    music_level = _power_mean(under)
    return {
        "talking_blocks": int(talking.sum()),
        "voice_lufs": round(level, 2),
        "music_lufs": round(music_level, 2),
        # Integrated over talking, and the 5th percentile of the 400 ms windows: the quiet ends
        # of phrases, where music most easily covers speech.
        "over_music_db": round(level - music_level, 2),
        "p5_over_music_db": round(float(np.percentile(voice[talking] - under, 5)), 2),
        "music_in_gaps_lufs": round(_power_mean(gaps), 2) if len(gaps) else None,
    }


def check(voice: Path, music: Path, joins: Sequence[float] = ()) -> dict:
    """`compare` on the stems, and clicks in the music stem at its `joins`, scored as
    `vebench render` scores cuts."""
    result = compare(momentary(voice), momentary(music))
    ratios = click_ratios(decode_audio(music), RATE, list(joins)) if joins else []
    return {**result, "joins": len(ratios), "join_clicks": sum(r > CLICK for r in ratios)}


def joins(project: Path) -> list[float]:
    """Where the music's ranges join in the output, in seconds: the middle of the cross-fade
    each range after the first starts with."""
    ranges = json.loads(project.read_text(encoding="utf-8")).get("audio", {}).get("music", [])
    starts = sorted((r["start"] + r.get("fadeIn", 0) / 2) / TICKS for r in ranges)
    return starts[1:]


def summarize(results: list[dict]) -> dict:
    """The worst edit decides: the smallest margins of voice over music."""
    scored = [r for r in results if r["over_music_db"] is not None]
    return {
        "edits": len(scored),
        "min_over_music_db": min((r["over_music_db"] for r in scored), default=None),
        "min_p5_over_music_db": min((r["p5_over_music_db"] for r in scored), default=None),
        "joins": sum(r["joins"] for r in results),
        "join_clicks": sum(r["join_clicks"] for r in results),
    }
