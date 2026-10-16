from collections.abc import Callable
from pathlib import Path

from vework import audio, probe, speech, transcribe

SENTENCE_ENDS = "。！？!?."
# vebench reads the first of these it finds in a clip's truth/ folder.
TRANSCRIPT_NAMES = ("transcript.json", "transcript.srt", "transcript.txt")
NOTE = (
    "Machine draft by vework draft-truth with {model}. Correct each line's text by ear, then "
    "delete this key: vebench refuses a transcript that still has it. draft_time only helps find "
    "a line in the audio and is not timing truth (bench/README.md#ground-truth)."
)


def find_source(clip: Path) -> Path:
    """The clip's one `source.<ext>`."""
    sources = sorted(clip.glob("source.*"))
    if not sources:
        raise FileNotFoundError(f"{clip}: no source.<ext> to transcribe")
    if len(sources) > 1:
        names = ", ".join(s.name for s in sources)
        raise ValueError(f"{clip}: more than one source ({names}); keep one")
    return sources[0]


def existing_transcript(clip: Path) -> Path | None:
    truth = clip / "truth"
    return next((truth / n for n in TRANSCRIPT_NAMES if (truth / n).exists()), None)


def draft_transcript(
    source: Path, asr_model: str, progress: Callable[[str], None] = lambda message: None
) -> dict:
    """One line per transcribed sentence, for a person to correct into truth.

    Lines carry no start or end: aligner times scored as truth would only measure agreement
    with that aligner, so timing truth is measured by ear instead.
    """
    if not probe.probe(source).audio:
        raise ValueError(f"{source}: no audio track to transcribe")
    progress("finding speech")
    samples = audio.load(source)
    lines = [
        line
        for chunk in transcribe.transcribe_chunks(
            samples, speech.segments(samples), asr_model, progress
        )
        for line in _sentences(chunk)
    ]
    return {"draft": NOTE.format(model=asr_model), "words": lines}


def _sentences(chunk: dict) -> list[dict]:
    """Split a chunk, up to 30 s of speech, into sentences: shorter lines are easier to correct.

    Lines are cut from the chunk's own text, which keeps the spaces around English words that
    the aligner's words do not carry; the aligner's tokens give each line its time.
    """
    words, pieces = chunk["words"], transcribe._pieces(chunk["text"])
    lines: list[dict] = []
    if sum(is_token for _, is_token, _ in pieces) == len(words):
        text, first, count = "", 0, 0
        for written, is_token, spaced in pieces:
            text += (" " if spaced else "") + written
            count += is_token
            if written[-1] in SENTENCE_ENDS and count > first:
                lines.append(_line(text.lstrip(), words[first:count]))
                text, first = "", count
        if count > first:
            lines.append(_line(text.lstrip(), words[first:]))
        elif text and lines:
            lines[-1]["text"] += text  # marks after the last sentence's end
    if len(lines) > 1:
        return lines
    # One sentence, or aligner tokens that do not match the text: the chunk's text as written,
    # timed by the whole chunk if the aligner returned nothing.
    return [_line(chunk["text"], words or [chunk])]


def _line(text: str, words: list[dict]) -> dict:
    return {"text": text, "draft_time": [round(words[0]["start"], 2), round(words[-1]["end"], 2)]}
