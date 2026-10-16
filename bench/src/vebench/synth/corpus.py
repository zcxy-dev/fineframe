"""Writes the synthetic corpus: clips in the corpus layout with exact truth, and music."""

import json
import time
import wave
import zlib
from collections.abc import Callable
from pathlib import Path

import numpy as np

from vebench.synth import music
from vebench.synth.layout import lay_out, speaker_turns, transitions
from vebench.synth.script import CLIPS

# (beats per minute, beats before the first downbeat, sections as (bars, parts playing)): an
# intro, a main part with everything and an outro or breakdown, each of whole phrases.
TRACKS = (
    (96, 0, ((4, "kh"), (16, "kshb"), (8, "hb"))),
    (112, 2, ((8, "hb"), (16, "kshb"), (8, "kh"))),
    (128, 1, ((8, "kh"), (24, "kshb"), (8, "hb"))),
)


def generate(out: Path, seed: int, progress: Callable[[str], None]) -> dict:
    """Write every clip and track under `out`; returns each one's length and build time."""
    from vebench.synth import speech

    speech.require()
    from vebench.synth import video

    summary: dict = {"seed": seed, "clips": {}, "music": {}}
    for clip in CLIPS:
        started = time.monotonic()
        progress(f"{clip.name}: speaking")
        rng = np.random.default_rng([seed, zlib.crc32(clip.name.encode())])
        plan = lay_out(clip, speech.say, rng)
        truth = out / clip.name / "truth"
        truth.mkdir(parents=True, exist_ok=True)
        _write(truth / "transcript.json", {"words": plan.words})
        _write(truth / "shots.json", {"transitions": transitions(plan.shots, clip.fps)})
        _write(truth / "edit.json", plan.edit)
        _write(truth / "speakers.json", {"turns": speaker_turns(clip, plan.words, plan.shots)})
        if found := video.regions(clip, plan):
            _write(truth / "regions.json", {"regions": found})
        progress(f"{clip.name}: drawing {plan.duration:.0f} s at {clip.fps} fps")
        video.render(clip, plan, out / clip.name / "source.mp4", seed)
        summary["clips"][clip.name] = {
            "duration": plan.duration,
            "build_seconds": round(time.monotonic() - started, 1),
        }
    (out / "music").mkdir(parents=True, exist_ok=True)
    for i, (bpm, pickup, sections) in enumerate(TRACKS):
        name = f"beat-{bpm:03d}"
        bars = sum(n for n, _ in sections)
        samples, beats = music.track(bpm, bars, pickup, seed * 7919 + i, sections)
        _write_wav(out / "music" / f"{name}.wav", samples, music.RATE)
        _write(out / "music" / f"{name}.json", beats)
        summary["music"][name] = {"duration": beats["duration"]}
    return summary


def _write(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _write_wav(path: Path, samples: np.ndarray, rate: int) -> None:
    pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(rate)
        f.writeframes(np.repeat(pcm, 2).tobytes())
