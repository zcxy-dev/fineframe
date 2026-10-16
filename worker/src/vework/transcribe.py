import unicodedata
import warnings
from collections import Counter
from collections.abc import Callable, Iterator
from functools import cache

import numpy as np

from vework import ml, timing
from vework.audio import RATE

# The larger model is more accurate but too slow for a CPU (timings in the README).
GPU_ASR_MODEL = "Qwen/Qwen3-ASR-1.7B-hf"
CPU_ASR_MODEL = "Qwen/Qwen3-ASR-0.6B-hf"
ALIGNER_MODEL = "Qwen/Qwen3-ForcedAligner-0.6B-hf"
# Commits of the model repositories, so their weights and processors change only here.
REVISIONS = {
    GPU_ASR_MODEL: "bcd2b5b7f32b480ab5790554cfa8347f246a14f3",
    CPU_ASR_MODEL: "7f1569a48a89f3e3f4dc3a5c9d28bddd903bc76c",
    ALIGNER_MODEL: "c07281df297b9905d24a508279258cccf987a064",
}
# Each chunk is transcribed in one language mode: a whole chunk read as English turns a
# Chinese sentence in it into English-sounding nonsense. Short chunks split at sentence
# pauses let each sentence pick its own mode (and stay well under the aligner's 180 s).
MAX_CHUNK = 30.0
SPLIT_PAUSE = 0.6
MIN_INPUT = 0.5  # shorter input is rejected by the ASR model
# Qwen3-ASR names languages in English; the index uses BCP 47 codes.
LANGUAGE_CODES = {
    "Chinese": "zh", "English": "en", "Cantonese": "yue", "Japanese": "ja", "Korean": "ko",
    "Arabic": "ar", "German": "de", "French": "fr", "Spanish": "es", "Portuguese": "pt",
    "Indonesian": "id", "Italian": "it", "Russian": "ru", "Thai": "th", "Vietnamese": "vi",
    "Turkish": "tr", "Hindi": "hi", "Malay": "ms", "Dutch": "nl", "Swedish": "sv", "Danish": "da",
    "Finnish": "fi", "Polish": "pl", "Czech": "cs", "Filipino": "fil", "Persian": "fa",
    "Greek": "el", "Hungarian": "hu", "Macedonian": "mk", "Romanian": "ro",
}  # fmt: skip


def plan_chunks(
    speech: list[dict], max_len: float = MAX_CHUNK, split_pause: float = SPLIT_PAUSE
) -> list[tuple[float, float]]:
    """Group speech into windows no longer than `max_len`, split at sentence pauses.

    Windows hold only speech, so silence is never transcribed (where ASR models invent words),
    and a split never falls inside a word.
    """
    chunks: list[tuple[float, float]] = []
    for seg in speech:
        start, end = seg["start"], seg["end"]
        if chunks and start - chunks[-1][1] < split_pause and end - chunks[-1][0] <= max_len:
            chunks[-1] = (chunks[-1][0], end)
            continue
        # A single segment longer than the limit is split at fixed points: VAD found no
        # pause inside it to use.
        while end - start > max_len:
            chunks.append((start, start + max_len))
            start += max_len
        chunks.append((start, end))
    return chunks


# Opening marks belong to the word after them; every other mark to the word before.
_OPENING = set("「『《〈【〔（([{“‘")


def _han(ch: str) -> bool:
    # The aligner's own test for a character it times on its own.
    code = ord(ch)
    return (
        0x3400 <= code <= 0x4DBF
        or 0x4E00 <= code <= 0x9FFF
        or 0xF900 <= code <= 0xFAFF
        or 0x20000 <= code <= 0x2CEAF
        or 0x2F800 <= code <= 0x2FA1F
    )


def _kept(ch: str) -> bool:
    return ch == "'" or unicodedata.category(ch)[0] in "LN"


def _pieces(text: str) -> list[tuple[str, bool, bool]]:
    """Split `text` as the aligner does for Chinese and English, keeping what was written.

    The aligner drops every character that is not a letter, digit or apostrophe, so its tokens
    ("35", "stateoftheart") are often not in the text; walking the text with its rules pairs
    each token with the written form ("3.5", "state-of-the-art"). Returns (written, is_token,
    starts_a_space_separated_segment).
    """
    pieces = []
    for segment in text.split():
        first, buf = True, ""
        for ch in segment + "\0":
            if ch != "\0" and not _han(ch):
                buf += ch
                continue
            if buf:
                pieces.append((buf, any(map(_kept, buf)), first))
                first, buf = False, ""
            if ch != "\0":
                pieces.append((ch, True, first))
                first = False
    return pieces


def attach_punctuation(
    text: str, items: list[tuple[str, float, float]], language: str = "Chinese"
) -> list[dict]:
    """Pair the aligner's timed tokens with the words as written in `text`, punctuation included.

    Subtitles need the punctuation and the original spelling the aligner strips. Japanese and
    Korean are split by word segmenters this cannot mirror, so their tokens are kept as is.
    """
    plain = [{"text": t, "start": s, "end": e} for t, s, e in items]
    pieces = _pieces(text) if language not in ("Japanese", "Korean") else []
    if sum(is_token for _, is_token, _ in pieces) != len(items):
        return plain
    words, pending, timed = [], "", iter(plain)
    for written, is_token, starts_segment in pieces:
        if is_token:
            word = next(timed)
            word["text"] = pending + written
            words.append(word)
            pending = ""
            continue
        for ch in written:
            if ch in _OPENING or not words:
                pending += ch
            else:
                # A mark standing on its own ("—", "😀") keeps the space before it.
                words[-1]["text"] += (" " if starts_segment else "") + ch
                starts_segment = False
    return words


def _syllable(word: dict) -> bool:
    """Whether `word` is one Han character, marks aside."""
    letters = [ch for ch in word["text"] if _kept(ch)]
    return len(letters) == 1 and _han(letters[0])


def repair_durations(words: list[dict]) -> list[dict]:
    """Give zero-length words the free time around them, or else a share of their neighbors'.

    The aligner sometimes gives characters no duration (start == end, often several in a row),
    either leaving a gap beside them or handing their time to a neighbor; a caption cannot
    highlight a word that lasts no time. Call it per chunk, so a word never stretches across the
    silence between chunks.
    """
    i = 0
    while i < len(words):
        if words[i]["end"] > words[i]["start"]:
            i += 1
            continue
        j = i
        while j + 1 < len(words) and words[j + 1]["end"] <= words[j + 1]["start"]:
            j += 1
        first, last = i, j
        lo = min(words[i - 1]["end"] if i else words[i]["start"], words[i]["start"])
        hi = max(words[j + 1]["start"] if j + 1 < len(words) else words[j]["end"], words[j]["end"])
        if hi <= lo:
            # No free time: the run shares its neighbors' span evenly, as each Chinese character
            # is one syllable. A neighbor of several syllables (an English word) keeps its time.
            first = i - 1 if i and _syllable(words[i - 1]) else i
            last = j + 1 if j + 1 < len(words) and _syllable(words[j + 1]) else j
            lo, hi = words[first]["start"], words[last]["end"]
        step = (hi - lo) / (last - first + 1)
        if step > 0:
            for k in range(first, last + 1):
                words[k]["start"] = round(lo + (k - first) * step, 3)
                words[k]["end"] = round(lo + (k - first + 1) * step, 3)
        i = j + 1
    return words


def to_traditional(text: str) -> str:
    # s2twp also swaps mainland vocabulary for Taiwan usage (视频 -> 影片, 软件 -> 軟體).
    return _converter().convert(text)


@cache
def _converter():
    import opencc

    return opencc.OpenCC("s2twp")


def default_asr_model() -> str:
    """The larger model with a CUDA GPU, the smaller one otherwise."""
    ml.require()
    import torch

    return GPU_ASR_MODEL if torch.cuda.is_available() else CPU_ASR_MODEL


def transcribe(
    samples: np.ndarray,
    speech: list[dict],
    asr_model: str | None = None,
    progress: Callable[[str], None] = lambda message: None,
    context: str = "",
    correct: Callable[[list[dict]], list[str]] | None = None,
) -> dict:
    """Transcribe 16 kHz audio in Taiwan Traditional Chinese and English, with word timings.

    `context` and `correct` are passed to `transcribe_chunks`.
    """
    words, texts, languages = [], [], Counter()
    for chunk in transcribe_chunks(samples, speech, asr_model, progress, context, correct):
        words += chunk["words"]
        texts.append(chunk["text"])
        # Weigh by speaking time: English packs more characters into a second than Chinese.
        languages[chunk["language"]] += chunk["end"] - chunk["start"]
    return {
        "language": LANGUAGE_CODES.get(languages.most_common(1)[0][0], "und")
        if languages
        else None,
        "text": "\n".join(texts),
        "words": words,
    }


def transcribe_chunks(
    samples: np.ndarray,
    speech: list[dict],
    asr_model: str | None = None,
    progress: Callable[[str], None] = lambda message: None,
    context: str = "",
    correct: Callable[[list[dict]], list[str]] | None = None,
) -> Iterator[dict]:
    """Yield each chunk the model heard text in: its `start`, `end`, `language`, `text`, `words`.

    `context` is Qwen3-ASR's context prompt, which biases it towards the words in it. `correct`
    takes every chunk's "start", "end", "text" and "language" and returns their corrected texts;
    it sees the whole transcript before any chunk is aligned, so the words are timed as corrected.
    """
    planned = plan_chunks(speech)
    if not planned:
        return  # loading the models takes a minute and gigabytes of memory
    recognize, align = _models(asr_model)
    chunks = []
    for n, (start, end) in enumerate(planned, 1):
        progress(f"transcribing {n}/{len(planned)}")
        lo, hi = int(start * RATE), int(end * RATE)
        wav = samples[lo:hi]
        if len(wav) < MIN_INPUT * RATE:
            wav = np.pad(wav, (0, int(MIN_INPUT * RATE) - len(wav)))
        text, language = recognize(wav, context)
        text = text.strip()
        if not text:
            continue
        language = language or "English"
        if language not in ("Japanese", "Korean") and any(map(_han, text)):
            text = to_traditional(text)
            # The aligner splits Han characters and still reads space-separated English words.
            language = "Chinese"
        chunks.append({"start": start, "end": end, "text": text, "language": language, "wav": wav})

    if correct and chunks:
        for chunk, text in zip(chunks, correct(chunks), strict=True):
            chunk["text"] = text

    for n, chunk in enumerate(chunks, 1):
        progress(f"aligning {n}/{len(chunks)}")
        start, end, text, language = chunk["start"], chunk["end"], chunk["text"], chunk["language"]
        # Padding added to a short chunk is not audio; keep words inside the real speech.
        items = [
            (token, round(min(start + s, end), 3), round(min(start + e, end), 3))
            for token, s, e in align(chunk["wav"], text, language)
        ]
        words = repair_durations(attach_punctuation(text, items, language))
        # After the repair: a word the aligner gave no time would read as a pause around it.
        words = timing.refine(words, samples, speech, end)
        yield {"start": start, "end": end, "language": language, "text": text, "words": words}


@cache
def _models(asr_model: str | None):
    """The speech model and the aligner, as two functions.

    `recognize(wav, context)` returns the text heard and its language (None when it heard none);
    `align(wav, text, language)` returns each aligner token with its start and end in `wav`.
    """
    ml.require()
    import torch
    from transformers import (
        AutoModelForMultimodalLM,
        AutoModelForTokenClassification,
        AutoProcessor,
    )
    from transformers.utils import logging as transformers_logging

    # Generation notices ("Setting pad_token_id …") and weight-loading progress bars mean nothing
    # to someone editing a video.
    transformers_logging.set_verbosity_error()
    transformers_logging.disable_progress_bar()

    asr_model = asr_model or default_asr_model()
    gpu = torch.cuda.is_available()
    device, dtype = ("cuda:0", torch.bfloat16) if gpu else ("cpu", torch.float32)

    def load(auto, name):
        # Another model named with --asr-model runs at whatever its repository holds now.
        revision = REVISIONS.get(name)
        model = auto.from_pretrained(name, revision=revision, dtype=dtype).to(device).eval()
        return model, AutoProcessor.from_pretrained(name, revision=revision)

    asr, asr_processor = load(AutoModelForMultimodalLM, asr_model)
    aligner, aligner_processor = load(AutoModelForTokenClassification, ALIGNER_MODEL)

    def audio(wav: np.ndarray) -> np.ndarray:
        # Qwen's own inference code scales audio that peaks past full scale back into it.
        return wav / max(1.0, float(np.abs(wav).max()))

    @torch.inference_mode()
    def recognize(wav: np.ndarray, context: str) -> tuple[str, str | None]:
        inputs = asr_processor.apply_transcription_request(audio=audio(wav), prompt=context)
        inputs = inputs.to(device, dtype)
        ids = asr.generate(**inputs, max_new_tokens=4096)[:, inputs["input_ids"].shape[1] :]
        heard = asr_processor.decode(ids, return_format="parsed")[0]
        return heard["transcription"], heard["language"]

    @torch.inference_mode()
    def align(wav: np.ndarray, text: str, language: str) -> list[tuple[str, float, float]]:
        # The language only picks how the text is split into tokens: Japanese by nagisa, Korean
        # by soynlp, every other language alike (and the aligner refuses some by name).
        with warnings.catch_warnings():
            # nagisa and soynlp, imported on the first Japanese or Korean chunk, have invalid
            # escape sequences that warn as they compile.
            warnings.simplefilter("ignore", SyntaxWarning)
            inputs, tokens = aligner_processor.prepare_forced_aligner_inputs(
                audio=audio(wav),
                transcript=text,
                language=language if language in ("Japanese", "Korean") else None,
            )
        inputs = inputs.to(device, dtype)
        timed = aligner_processor.decode_forced_alignment(
            logits=aligner(**inputs).logits,
            input_ids=inputs["input_ids"],
            word_lists=tokens,
            timestamp_token_id=aligner.config.timestamp_token_id,
        )[0]
        return [(t["text"], t["start_time"], t["end_time"]) for t in timed]

    return recognize, align
