from collections.abc import Callable
from dataclasses import asdict
from pathlib import Path

from vework import (
    audio,
    correct,
    events,
    framing,
    loudness,
    openrouter,
    probe,
    shots,
    speech,
    transcribe,
    voice,
)
from vework.media_index import MediaIndex

VERSION = 1
LOUDNESS_RATE = 48_000  # BS.1770's own rate, where its K-weighting is defined


def build(
    path: Path,
    asr_model: str | None = None,
    progress: Callable[[str], None] = lambda message: None,
    context: str = "",
    correction: correct.Settings | None = None,
    stem: Path | None = None,
    cloud: openrouter.Client | None = None,
) -> dict:
    """Analyze one source file into its media index, reporting each stage to `progress`.

    `context` biases the speech model; `correction` has Claude fix what it misheard. With `stem`,
    speech is also measured for voice processing and its denoised copy written there. `cloud`
    hears the speech on OpenRouter in place of the local speech model.
    """
    corrections = []

    def fix(chunks: list[dict]) -> list[str]:
        texts, records = correct.correct(chunks, correction, progress)
        corrections.extend(records)
        return texts

    progress("probing")
    info = probe.probe(path)
    transitions = []
    if info.video:
        progress("detecting shots")
        transitions = shots.detect(path, progress)
    progress("finding speech")
    # Loudness is read from the same decode at the source's full band and in its own channels,
    # which the speech models' 16 kHz mono mix would lose.
    meter = loudness.Meter(LOUDNESS_RATE)
    track = audio.Track(meter.add, LOUDNESS_RATE, layout=None)
    samples = audio.load(path, tracks=[track]) if info.audio else None
    voiced = speech.segments(samples) if samples is not None else []
    level, found = {"momentary": [], "short_term": []}, []
    if samples is not None:
        progress("measuring loudness")
        level = meter.result()
        progress("finding audio events")
        found = events.detect(samples)
    faces = None
    if info.video:
        progress("finding faces")
        faces = framing.analyze(path, info.video, transitions, voiced, progress)
    measured = None
    if voiced and stem is not None:
        progress("removing noise from speech")
        measured = voice.analyze(path, voiced, stem, progress)
    if voiced:
        transcript = transcribe.transcribe(
            samples,
            voiced,
            asr_model,
            progress,
            context,
            fix if correction else None,
            cloud.recognize if cloud else None,
        )
        if cloud:
            minutes = len(samples) / audio.RATE / 60
            per_minute = cloud.cost / minutes if minutes else 0.0
            transcript["cloud"] = {
                "model": cloud.model,
                "cost": round(cloud.cost, 6),
                "cost_per_minute": round(per_minute, 6),
            }
            progress(
                f"transcribed on OpenRouter for US${cloud.cost:.4f} "
                f"(US${per_minute:.5f} per source minute)"
            )
    else:
        transcript = {"language": None, "text": "", "words": []}
    result = {
        "version": VERSION,
        "source": {"name": path.name, **asdict(info)},
        "transitions": transitions,
        "speech": voiced,
        "transcript": transcript,
        "loudness": level,
        "audio_events": found,
    }
    if correction:
        result["corrections"] = corrections
    if faces is not None:
        result["framing"] = faces
    if measured:
        result["voice"] = measured
    # The engine reads this file through the same schema; failing here points at the analysis
    # that broke the contract instead of at a wrong edit later.
    MediaIndex.model_validate(result, strict=True)
    return result
