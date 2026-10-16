"""Lays a clip's script out in time; every truth file is read off this layout."""

from collections.abc import Callable
from dataclasses import dataclass

import numpy as np

from vebench.synth.script import Clip, Line, Pause, Retake, Section, Show, parse, phrases

RATE = 24_000
# A silence at least this long is a pause for the edit to shorten.
PAUSE_MIN = 1.0
MIN_SHOT = 2.0  # seconds between automatic multicam cuts, so the picture does not flicker

# say(text, speaker, seed) -> (samples at RATE, [(written word, start, end, offset in text)])
Say = Callable[[str, str, int], tuple[np.ndarray, list[tuple[str, float, float, int]]]]


@dataclass
class Layout:
    duration: float
    tracks: dict[str, np.ndarray]  # each speaker's audio at RATE, on the clip's timeline
    words: list[dict]  # {"text", "start", "end", "speaker"}
    edit: dict
    shots: list[dict]  # {"view", "frame", "dissolve" (frames), "text"}


def lay_out(clip: Clip, say: Say, rng: np.random.Generator) -> Layout:
    """Speak every line with natural gaps, the scripted pauses and retakes, and plan the shots."""
    words: list[dict] = []
    takes_by_retake: list[list[tuple[float, float]]] = []
    fillers, sections, cues = [], [], []
    placed: list[tuple[str, int, np.ndarray]] = []
    pending: list[Show] = []
    silence = rng.uniform(1.0, 2.5)  # the camera rolls before anyone speaks
    previous_end = 0.0

    def speak(speaker: str, text: str, gap: float) -> tuple[float, float]:
        nonlocal previous_end, pending
        plain, filler_spans = parse(text)
        audio, timed = say(plain, speaker, int(rng.integers(2**31)))
        first = previous_end + gap
        offset = round((first - timed[0][1]) * RATE)
        if offset < 0:  # a long lead-in on the very first line
            offset = 0
        shift = offset / RATE
        placed.append((speaker, offset, audio))
        new = [
            {"text": w, "start": shift + s, "end": shift + e, "speaker": speaker, "at": at}
            for w, s, e, at in timed
        ]
        for a, b in filler_spans:
            inside = [w for w in new if a <= w["at"] < b]
            fillers.append(
                {"start": inside[0]["start"], "end": inside[-1]["end"], "text": plain[a:b]}
            )
        if pending:
            # Cut inside the silence before the line, where an editor would.
            cut = previous_end + rng.uniform(0.3, 0.8) * (new[0]["start"] - previous_end)
            for show in pending:
                cues.append((cut if words else 0.0, show))
            pending = []
        for w in new:
            del w["at"]
            w["section"] = len(sections) - 1
        words.extend(new)
        previous_end = new[-1]["end"]
        return new[0]["start"], new[-1]["end"]

    last_speaker = None
    for item in clip.items:
        if isinstance(item, Pause):
            silence = rng.uniform(item.low, item.high)
        elif isinstance(item, Section):
            sections.append({"order": item.order, "topic": item.topic})
        elif isinstance(item, Show):
            pending.append(item)
        elif isinstance(item, Line):
            if silence is None:
                silence = _gap(rng, item.speaker != last_speaker)
            speak(item.speaker, item.text, silence)
            silence, last_speaker = None, item.speaker
        elif isinstance(item, Retake):
            spans = []
            for take in item.takes:
                said = []
                for phrase in phrases(take):
                    if silence is None:
                        silence = rng.uniform(0.6, 1.5)  # a breath before the aside or a new try
                    said.append(speak(item.speaker, phrase, silence))
                    silence = None
                spans.append((said[0][0], said[-1][1]))
            takes_by_retake.append(spans)
            last_speaker = item.speaker
    tail = rng.uniform(1.0, 3.0) if silence is None else silence
    duration = max(previous_end + tail, max(o + len(a) for _, o, a in placed) / RATE)

    tracks = {s: np.zeros(round(duration * RATE) + 1, np.float32) for s in clip.speakers}
    for speaker, offset, audio in placed:
        tracks[speaker][offset : offset + len(audio)] += audio

    _round(words)
    edit = {
        "group": clip.group,
        "fillers": _round(fillers),
        "pauses": _round(_pauses(words, duration)),
        "retakes": [
            {"takes": _round([{"start": s, "end": e} for s, e in spans]), "keep": len(spans) - 1}
            for spans in takes_by_retake
        ],
        "story": _round(_story(words, sections)),
    }
    for w in words:
        del w["section"]
    if clip.style == "multicam":
        cues = _multicam_cues(words, duration, rng)
    shots = _frames(cues, clip, duration, rng)
    return Layout(round(duration, 6), tracks, words, edit, shots)


def _gap(rng: np.random.Generator, turn: bool) -> float:
    # Answers come a little later than a speaker's own next sentence.
    return rng.uniform(0.35, 0.9) if turn else rng.uniform(0.25, 0.65)


def _pauses(words: list[dict], duration: float) -> list[dict]:
    edges = [0.0] + [x for w in words for x in (w["start"], w["end"])] + [duration]
    gaps = [(edges[i], edges[i + 1]) for i in range(0, len(edges), 2)]
    return [{"start": s, "end": e} for s, e in gaps if e - s >= PAUSE_MIN]


def _story(words: list[dict], sections: list[dict]) -> list[dict]:
    story = []
    for i, section in enumerate(sections):
        inside = [w for w in words if w["section"] == i]
        story.append({"start": inside[0]["start"], "end": inside[-1]["end"], **section})
    return story


def _multicam_cues(
    words: list[dict], duration: float, rng: np.random.Generator
) -> list[tuple[float, Show]]:
    """Cut to whoever starts speaking, as a live switcher would; one cut halfway dissolves."""
    cues, view, last_cut = [(0.0, Show("wide"))], "wide", 0.0
    turns = [w for i, w in enumerate(words) if i == 0 or w["speaker"] != words[i - 1]["speaker"]]
    for w in turns[1:]:
        cut = w["start"] - rng.uniform(0.1, 0.5)
        target = w["speaker"].lower() if rng.random() < 0.8 else "wide"
        if target == view or cut - last_cut < MIN_SHOT:
            continue
        cues.append((cut, Show(target)))
        view, last_cut = target, cut
    if len(cues) > 1:
        middle = min(range(1, len(cues)), key=lambda i: abs(cues[i][0] - duration / 2))
        cues[middle] = (cues[middle][0], Show(cues[middle][1].view, dissolve=True))
    return cues


def _frames(
    cues: list[tuple[float, Show]], clip: Clip, duration: float, rng: np.random.Generator
) -> list[dict]:
    """Snap each cut to the frame where the new shot first appears."""
    if not cues or cues[0][0] > 0:
        default = {"phone": "street", "screen": "terminal"}.get(clip.style, "wide")
        cues = [(0.0, Show(default))] + cues
    shots = []
    for t, show in cues:
        frame = round(t * clip.fps)
        dissolve = round(rng.uniform(0.5, 1.0) * clip.fps) if show.dissolve and shots else 0
        shot = {"view": show.view, "frame": frame, "dissolve": dissolve, "text": list(show.text)}
        if shots and shots[-1]["frame"] == frame:
            shots[-1] = shot  # two cues at once: the later one wins
        else:
            shots.append(shot)
    last = round(duration * clip.fps)
    return [s for s in shots if s["frame"] + s["dissolve"] < last]


def transitions(shots: list[dict], fps: int) -> list[dict]:
    """Truth for shots.json: a cut on the new shot's first frame, a dissolve over its frames."""
    return [
        {"start": round(s["frame"] / fps, 6), "end": round((s["frame"] + s["dissolve"]) / fps, 6)}
        for s in shots[1:]
    ]


def speaker_turns(clip: Clip, words: list[dict], shots: list[dict]) -> list[dict]:
    """Truth for speakers.json: who talks when, and whether their face is on screen.

    A turn is a run of one speaker's words with no pause (PAUSE_MIN) in it, split where the
    speaker's face comes into or goes out of the picture. During a dissolve both shots are on
    screen.
    """
    # Each shot is on screen from its first frame until the next one has fully dissolved in.
    spans = [
        (s["frame"] / clip.fps, (n["frame"] + n["dissolve"]) / clip.fps if n else float("inf"))
        for s, n in zip(shots, [*shots[1:], None], strict=True)
    ]
    edges = sorted({t for span in spans for t in span})

    def visible(speaker: str, t: float) -> bool:
        on_screen = (s for s, (a, b) in zip(shots, spans, strict=True) if a <= t < b)
        return any(_shows(clip, s["view"], speaker) for s in on_screen)

    turns: list[dict] = []
    for w in words:
        last = turns[-1] if turns else None
        if last and last["speaker"] == w["speaker"] and w["start"] - last["end"] < PAUSE_MIN:
            last["end"] = w["end"]
        else:
            turns.append({"start": w["start"], "end": w["end"], "speaker": w["speaker"]})
    out = []
    for turn in turns:
        cuts = [turn["start"], *(t for t in edges if turn["start"] < t < turn["end"]), turn["end"]]
        for a, b in zip(cuts, cuts[1:], strict=False):
            seen = visible(turn["speaker"], (a + b) / 2)
            if a > turn["start"] and out[-1]["visible"] == seen:
                out[-1]["end"] = b
            else:
                out.append({"start": a, "end": b, "speaker": turn["speaker"], "visible": seen})
    return _round(out)


def _shows(clip: Clip, view: str, speaker: str) -> bool:
    """Whether a camera view has the speaker's face in it; screens show no one."""
    if view in ("wide", "street"):
        return speaker in clip.speakers
    return {"a": "A", "close": "A", "b": "B"}.get(view) == speaker


def _round(items: list[dict]) -> list[dict]:
    for item in items:
        for key in ("start", "end"):
            if key in item:
                item[key] = round(item[key], 3)
    return items
