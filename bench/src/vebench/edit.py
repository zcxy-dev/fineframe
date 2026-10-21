"""Score a planned edit, a project.json, against the edit truth of every corpus clip it uses.

The project names each source by its path; a source at `<clip>/source.<ext>` is scored against
`<clip>/truth/edit.json` and the timed words of `<clip>/truth/transcript.*`. Times in a project
are ticks, 120 000 per second, on its sources' own clocks. A clip plays from where its sound
starts (`soundIn`, else `in`) to where it ends (`soundOut`, else `out`); `edges="picture"`
judges it at `in` and `out` instead, as vebench did before sound edges.
"""

import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from vebench import render, transcript

TICKS = 120_000
TRANSCRIPT_NAMES = ("transcript.json", "transcript.srt", "transcript.txt")
# Clips of one source closer than this in source time play one stretch of it: what was cut
# between them was cut from inside material the edit uses, not left out with a whole passage.
REGION_GAP = 3.0
# A filler this close to a clip of its source is one the edit had to decide on: it starts or
# ends a stretch the edit plays, or sits inside one.
NEAR = 1.0
# A silence on the output timeline this long is dead air, as edit truth counts pauses.
DEAD_AIR = 1.0
# How much of a filler or take must play for it to count as kept.
KEPT = 0.5
# An edge inside a truth word is heard there unless the recording over the span its sound fades
# in or out on, beside the edge, is this far under the quieter of that word and the one beside it
# (the engine's joinAt).
FADE = 0.02
UNDER_DB = 20.0
LEVEL_RATE = 16_000
# An edge this close to a beat of the music under it is one the planner should have put on it.
NEAR_BEAT = 0.15
# A callout starts this long before the thing it points at is named (the effect catalog), and is
# on target when its box and the true region overlap by this much (intersection over union).
CALLOUT_LEAD = 0.3
ON_TARGET = 0.5


@dataclass(frozen=True)
class Clip:
    source: str
    start: float
    end: float


def score(project_path: Path, edges: str = "sound") -> dict:
    """Length against the target, cuts inside words, filler removal, retake choice and dead air
    of one project, judging each clip by its sound's edges or, with `edges="picture"`, by its
    picture's. Sources without truth are left out of the counts that need it."""
    project = json.loads(project_path.read_text(encoding="utf-8"))
    base = project_path.parent
    clips = [Clip(c["source"], c["in"] / TICKS, c["out"] / TICKS) for c in project["main"]]
    heard = clips
    if edges == "sound":
        heard = [
            Clip(
                c["source"], c.get("soundIn", c["in"]) / TICKS, c.get("soundOut", c["out"]) / TICKS
            )
            for c in project["main"]
        ]
    length = sum(c.end - c.start for c in clips)
    for clip in project["main"][1:]:
        if clip.get("transition", {}).get("type") == "dissolve":
            length -= clip["transition"]["duration"] / TICKS
    target = project["output"]["target"]
    result = {
        "length": {
            "seconds": round(length, 3),
            "target": target["duration"] / TICKS,
            "error": length / (target["duration"] / TICKS) - 1,
            "within": abs(length / (target["duration"] / TICKS) - 1) <= target["tolerance"],
        },
        "cuts": {"checked": 0, "in_words": 0, "in_words_heard": 0, "deepest_ms": 0.0},
        "fillers": {"total": 0, "removed": 0, "removed_words": 0, "filler_words": 0},
        "retakes": {"scored": 0, "correct": 0, "unused": 0},
        "dead_air": {"count": 0, "seconds": 0.0},
        "beats": _beats(project, base),
        "callouts": _callouts(project, base),
        "sources": [],
    }
    silences_by_source = {}
    for source in project["sources"]:
        truth = (base / source["path"]).resolve().parent / "truth"
        edit_path = truth / "edit.json"
        if not edit_path.exists():
            continue
        result["sources"].append(truth.parent.name)
        edit = json.loads(edit_path.read_text(encoding="utf-8"))
        units = _units(truth)
        words = [u for u in units if u.start is not None and u.end is not None]
        mine = sorted((c for c in heard if c.source == source["id"]), key=lambda c: c.start)
        _cuts(result["cuts"], mine, words, _duration(base, source), _Sound(base / source["path"]))
        _fillers(result["fillers"], mine, edit, words)
        _retakes(result["retakes"], mine, edit)
        silences_by_source[source["id"]] = _silences(edit, units)
    _dead_air(result["dead_air"], clips, silences_by_source)
    return result


def summarize(results: list[dict]) -> dict:
    """Pool the scores of several projects."""
    errors = [abs(r["length"]["error"]) for r in results]
    pooled = {
        "projects": len(results),
        "length": {
            "mean_abs_error": sum(errors) / len(errors),
            "max_abs_error": max(errors),
            "within": sum(r["length"]["within"] for r in results),
        },
    }
    for key in ("cuts", "fillers", "retakes", "dead_air"):
        pooled[key] = {
            name: (max if name == "deepest_ms" else sum)(r[key][name] for r in results)
            for name in results[0][key]
        }
    offsets = [r["beats"]["max_abs_ms"] for r in results if r["beats"]["max_abs_ms"] is not None]
    pooled["beats"] = {
        "edges": sum(r["beats"]["edges"] for r in results),
        "near": sum(r["beats"]["near"] for r in results),
        "max_abs_ms": max(offsets, default=None),
    }
    ious = [iou for r in results for iou in r["callouts"]["ious"]]
    pooled["callouts"] = {
        "count": sum(r["callouts"]["count"] for r in results),
        "scored": len(ious),
        "on_target": sum(iou >= ON_TARGET for iou in ious),
        "mean_iou": round(sum(ious) / len(ious), 3) if ious else None,
    }
    fillers = pooled["fillers"]
    fillers["recall"] = _rate(fillers["removed"], fillers["total"])
    fillers["precision"] = _rate(fillers["filler_words"], fillers["removed_words"])
    pooled["retakes"]["accuracy"] = _rate(pooled["retakes"]["correct"], pooled["retakes"]["scored"])
    return pooled


def _beats(project: dict, base: Path) -> dict:
    """How far each B-roll and overlay edge lands from the nearest true beat of the music
    playing under it, on the output frame grid as the renderer places it. Only music with beat
    truth beside it (the synthetic corpus's `<track>.json`) counts; edges with no beat within
    NEAR_BEAT were not meant to be on one."""
    out = {"edges": 0, "near": 0, "max_abs_ms": None, "mean_abs_ms": None}
    paths = {s["id"]: (base / s["path"]).resolve() for s in project["sources"]}
    beats = []
    for music in project.get("audio", {}).get("music", []):
        truth = paths[music["source"]].with_suffix(".json")
        known = json.loads(truth.read_text(encoding="utf-8")) if truth.exists() else {}
        start, a, b = music["start"] / TICKS, music["in"] / TICKS, music["out"] / TICKS
        beats += [start + t - a for t in known.get("beats", []) if a <= t < b]
    if not beats:
        return out
    fps = project["output"]["fps"]
    frame = TICKS * fps["den"] / fps["num"]
    frames = sum(c["out"] - c["in"] for c in project["main"]) / frame
    edges = []
    for clip in project.get("broll", []):
        first = round(clip["start"] / frame)
        last = min(round((clip["start"] + clip["out"] - clip["in"]) / frame), frames)
        edges += [first * frame / TICKS, last * frame / TICKS]
    for overlay in project.get("overlays", []):
        first = -(-overlay["start"] // frame)
        edges += [first * frame / TICKS]
    out["edges"] = len(edges)
    offsets = [min((edge - t for t in beats), key=abs) for edge in edges]
    near = [abs(o) * 1000 for o in offsets if abs(o) <= NEAR_BEAT]
    out["near"] = len(near)
    if near:
        out["max_abs_ms"] = round(max(near), 1)
        out["mean_abs_ms"] = round(sum(near) / len(near), 1)
    return out


def _callouts(project: dict, base: Path) -> dict:
    """Each callout's box, taken back through its clip's framing to the source's picture at the
    moment the thing it points at is named, against the regions on screen then
    (`truth/regions.json`, bench/README.md#synthetic-corpus). `ious` holds each scored callout's
    best overlap; a callout over a source without region truth counts but is not scored."""
    out = {"count": 0, "on_target": 0, "mean_iou": None, "ious": []}
    sources = {s["id"]: s for s in project["sources"]}
    starts, at = [], 0
    for k, clip in enumerate(project["main"]):
        if k > 0 and clip.get("transition", {}).get("type") == "dissolve":
            at -= clip["transition"]["duration"]
        starts.append(at)
        at += clip["out"] - clip["in"]
    for overlay in project.get("overlays", []):
        if overlay["template"] != "callout":
            continue
        out["count"] += 1
        t = overlay["start"] + CALLOUT_LEAD * TICKS
        k = max((i for i, s in enumerate(starts) if s <= t), default=0)
        clip = project["main"][k]
        source = sources[clip["source"]]
        truth = (base / source["path"]).resolve().parent / "truth" / "regions.json"
        index = source.get("index")
        if not truth.exists() or not index or not (base / index).exists():
            continue
        video = json.loads((base / index).read_text(encoding="utf-8"))["source"]["video"]
        aspect = video["width"] * video.get("sample_aspect", 1) / video["height"]
        tick = clip["in"] + t - starts[k]
        shape = project["output"]["width"] / project["output"]["height"]
        vx, vy, vw, vh = _visible(clip.get("framing"), tick, aspect, shape)
        r = overlay["params"]["rect"]
        box = (vx + r["x"] * vw, vy + r["y"] * vh, r["w"] * vw, r["h"] * vh)
        seconds = tick / TICKS
        regions = json.loads(truth.read_text(encoding="utf-8"))["regions"]
        shown = [g["rect"] for g in regions if g["start"] <= seconds < g["end"]]
        out["ious"].append(round(max((_iou(box, g) for g in shown), default=0.0), 3))
    if out["ious"]:
        out["on_target"] = sum(iou >= ON_TARGET for iou in out["ious"])
        out["mean_iou"] = round(sum(out["ious"]) / len(out["ious"]), 3)
    return out


def _visible(framing: dict | None, t: float, aspect: float, shape: float) -> tuple:
    """The part of the source on screen at source tick t, as (x, y, w, h) fractions of its
    picture, reaching past it where the crop does, and of a split screen the top half's: the
    engine's visible() in packages/engine/src/framing.ts."""
    framing = framing or {}
    crop = framing.get("crop")
    rect = {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0}
    split = False
    if crop and crop["type"] == "static":
        rect, split = crop["rect"], "below" in crop
    elif crop:
        keys = crop["keyframes"]
        after = next((i for i, key in enumerate(keys) if key["t"] > t), len(keys))
        if after == 0 or after == len(keys):
            key = keys[min(after, len(keys) - 1)]
            rect, split = key["rect"], "below" in key
        else:
            a, b = keys[after - 1], keys[after]
            f = (t - a["t"]) / (b["t"] - a["t"])
            rect = {k: a["rect"][k] + (b["rect"][k] - a["rect"][k]) * f for k in "xywh"}
            split = "below" in a and "below" in b
    # A split screen's top half is twice as wide, for its height, as the frame, and not zoomed.
    if split:
        shape *= 2
    scale = 1.0 if split else _scale(framing.get("scale"), t)
    anchor = framing.get("anchor", {"x": 0.5, "y": 0.5})
    w = min(rect["w"] * aspect, rect["h"] * shape) / scale
    h = min(rect["h"], rect["w"] * aspect / shape) / scale
    x = (rect["x"] + rect["w"] / 2) * aspect - w / 2 + (anchor["x"] - 0.5) * w * (scale - 1)
    y = rect["y"] + rect["h"] / 2 - h / 2 + (anchor["y"] - 0.5) * h * (scale - 1)
    if scale > 1:
        x, y = min(max(x, 0.0), max(0.0, aspect - w)), min(max(y, 0.0), max(0.0, 1 - h))
    return x / aspect, y, w / aspect, h


def _scale(scale, t: float) -> float:
    """A framing's scale at tick t, eased along half a cosine between keyframes."""
    if scale is None or isinstance(scale, int | float):
        return scale or 1.0
    keys = scale["keyframes"]
    if t <= keys[0]["t"]:
        return keys[0]["scale"]
    for a, b in zip(keys, keys[1:], strict=False):
        if t < b["t"]:
            f = (1 - math.cos(math.pi * (t - a["t"]) / (b["t"] - a["t"]))) / 2
            return a["scale"] + (b["scale"] - a["scale"]) * f
    return keys[-1]["scale"]


def _iou(a: tuple, b: dict) -> float:
    x0, y0 = max(a[0], b["x"]), max(a[1], b["y"])
    x1, y1 = min(a[0] + a[2], b["x"] + b["w"]), min(a[1] + a[3], b["y"] + b["h"])
    inter = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    union = a[2] * a[3] + b["w"] * b["h"] - inter
    return inter / union if union > 0 else 0.0


def _units(truth: Path) -> list[transcript.Unit]:
    path = next((truth / n for n in TRANSCRIPT_NAMES if (truth / n).exists()), None)
    return [] if path is None else transcript.load(path)


def _silences(edit: dict, units: list[transcript.Unit]) -> list[tuple[float, float]]:
    """Stretches of a source without speech: its truth pauses, and the gaps between consecutive
    timed truth words, which also catch silences too short to be pauses that a cut joins."""
    spans = [(p["start"], p["end"]) for p in edit.get("pauses", [])]
    for a, b in zip(units, units[1:], strict=False):
        if a.end is not None and b.start is not None and b.start > a.end:
            spans.append((a.end, b.start))
    return sorted(spans)


def _duration(base: Path, source: dict) -> float | None:
    index = source.get("index")
    if not index or not (base / index).exists():
        return None
    return json.loads((base / index).read_text(encoding="utf-8"))["source"]["duration"] or None


def _covered(clips: list[Clip], start: float, end: float) -> float:
    """The share of [start, end] the clips play."""
    if end <= start:
        return 0.0
    seconds = sum(max(0.0, min(end, c.end) - max(start, c.start)) for c in clips)
    return min(1.0, seconds / (end - start))


def _cuts(out: dict, clips: list[Clip], words: list, duration: float | None, sound) -> None:
    """Every clip edge inside a timed truth word (_inside), and of those, the ones where the
    sound beside the edge is heard (_heard). The start and end of the file are not cuts."""
    for clip in clips:
        for edge, plays_after in ((clip.start, True), (clip.end, False)):
            if edge <= 0 or (duration is not None and edge >= duration - 1e-3):
                continue
            out["checked"] += 1
            depth = _inside(edge, words)
            if depth is not None:
                out["in_words"] += 1
                out["in_words_heard"] += _heard(edge, plays_after, words, sound)
                out["deepest_ms"] = max(out["deepest_ms"], round(depth * 1000, 1))


class _Sound:
    """A source's recording, decoded when first asked for; None where it cannot be."""

    def __init__(self, path: Path) -> None:
        self.path, self._samples = path, False

    def samples(self) -> np.ndarray | None:
        if self._samples is False:
            try:
                self._samples = render.decode_audio(self.path, LEVEL_RATE).astype(np.float64)
            except (OSError, ValueError, RuntimeError):
                self._samples = None
        return self._samples

    def db(self, start: float, end: float) -> float | None:
        samples = self.samples()
        if samples is None:
            return None
        part = samples[max(0, int(start * LEVEL_RATE)) : max(0, int(end * LEVEL_RATE))]
        return 10 * float(np.log10(np.mean(part**2) + 1e-12)) if len(part) else None


def _heard(edge: float, plays_after: bool, words: list, sound: _Sound) -> bool:
    """Whether an edge inside a truth word is heard there: its recording over FADE on the side
    that plays is less than UNDER_DB under the quieter of the word and the truth word beside it
    on the edge's nearer side. Heard when the recording cannot be read."""
    word = next(w for w in words if w.start < edge < w.end)
    k = words.index(word)
    nearer = k - 1 if edge - word.start < word.end - edge else k + 1
    beside = words[nearer] if 0 <= nearer < len(words) else word
    span = (edge, edge + FADE) if plays_after else (edge - FADE, edge)
    levels = [sound.db(w.start, w.end) for w in (word, beside)] + [sound.db(*span)]
    if any(level is None for level in levels):
        return True
    return levels[2] > min(levels[:2]) - UNDER_DB


def _inside(edge: float, words: list) -> float | None:
    """How far an edge lies inside the timed truth words it is strictly inside, in seconds, the
    deepest of them; None when it is inside none."""
    inside = [w for w in words if w.start < edge < w.end]
    return max(min(edge - w.start, w.end - edge) for w in inside) if inside else None


def _regions(clips: list[Clip]) -> list[tuple[float, float, list[tuple[float, float]]]]:
    """Stretches of the source the edit plays from, with the gaps cut out inside each."""
    regions = []
    for clip in clips:
        if regions and clip.start - regions[-1][1] < REGION_GAP:
            start, end, gaps = regions[-1]
            if clip.start > end:
                gaps.append((end, clip.start))
            regions[-1] = (start, max(end, clip.end), gaps)
        else:
            regions.append((clip.start, clip.end, []))
    return regions


def _fillers(out: dict, clips: list[Clip], edit: dict, words: list) -> None:
    """Recall: truth fillers within NEAR of a played clip that do not play. Precision: of the
    timed words cut out inside played stretches, the share that are fillers. Fillers and words of
    a take the truth does not keep are a retake decision and count toward neither."""
    regions = _regions(clips)
    fillers = [(f["start"], f["end"]) for f in edit.get("fillers", [])]
    dropped_takes = [
        (take["start"], take["end"])
        for group in edit.get("retakes", [])
        for k, take in enumerate(group["takes"])
        if k != group["keep"]
    ]

    def in_dropped_take(start: float, end: float) -> bool:
        return any(a <= start and end <= b for a, b in dropped_takes)

    for start, end in fillers:
        if in_dropped_take(start, end):
            continue
        if any(c.start - NEAR <= end and start <= c.end + NEAR for c in clips):
            out["total"] += 1
            out["removed"] += _covered(clips, start, end) < KEPT
    for _, _, gaps in regions:
        for gap_start, gap_end in gaps:
            for word in words:
                inside = max(0.0, min(gap_end, word.end) - max(gap_start, word.start))
                if inside < KEPT * (word.end - word.start):
                    continue
                if in_dropped_take(word.start, word.end):
                    continue
                out["removed_words"] += 1
                out["filler_words"] += any(
                    min(b, word.end) - max(a, word.start) > 0 for a, b in fillers
                )


def _retakes(out: dict, clips: list[Clip], edit: dict) -> None:
    """A group is right when its kept take plays and no other does; a group none of whose takes
    play was left out for other reasons and is not scored."""
    for group in edit.get("retakes", []):
        played = [_covered(clips, t["start"], t["end"]) >= KEPT for t in group["takes"]]
        if not any(played):
            out["unused"] += 1
            continue
        out["scored"] += 1
        out["correct"] += played[group["keep"]] and sum(played) == 1


def _dead_air(out: dict, clips: list[Clip], quiet: dict[str, list]) -> None:
    """Silences of DEAD_AIR or more on the output timeline, from the silences each clip plays
    (see _silences); a silence ending one clip and one starting the next add up across the cut."""
    position = 0.0
    silences: list[list[float]] = []
    for clip in clips:
        for start, end in quiet.get(clip.source, []):
            a, b = max(start, clip.start), min(end, clip.end)
            if b <= a:
                continue
            span = [position + a - clip.start, position + b - clip.start]
            if silences and span[0] - silences[-1][1] < 1e-3:
                silences[-1][1] = max(silences[-1][1], span[1])
            else:
                silences.append(span)
        position += clip.end - clip.start
    for start, end in silences:
        if end - start >= DEAD_AIR:
            out["count"] += 1
            out["seconds"] = round(out["seconds"] + end - start, 3)


def _rate(part: int, whole: int) -> float | None:
    return part / whole if whole else None
