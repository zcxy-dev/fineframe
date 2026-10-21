import json
import tempfile
import unicodedata
from collections import Counter
from collections.abc import Callable, Iterator
from functools import cache
from pathlib import Path

import numpy as np

from vework import download, gpu, ml, timing
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


def _language_of_script(text: str) -> str:
    """The language a model that named none spoke, as far as the script tells: Japanese with
    kana, Korean with Hangul, English otherwise (Han characters then make it Chinese)."""
    if any("\u3040" <= ch <= "\u30ff" for ch in text):
        return "Japanese"
    if any("\uac00" <= ch <= "\ud7af" or "\u1100" <= ch <= "\u11ff" for ch in text):
        return "Korean"
    return "English"


def _kept(ch: str) -> bool:
    return ch == "'" or unicodedata.category(ch)[0] in "LN"


def _pieces(text: str) -> list[tuple[str, bool, bool]]:
    """Split `text` as the aligner does, keeping what was written.

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


def attach_punctuation(text: str, items: list[tuple[str, float, float]]) -> list[dict]:
    """Pair the aligner's timed tokens with the words as written in `text`, punctuation included.

    Subtitles need the punctuation and the original spelling the aligner strips.
    """
    plain = [{"text": t, "start": s, "end": e} for t, s, e in items]
    pieces = _pieces(text)
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


def separate_latin(text: str) -> str:
    """`text` with a space after each full-width mark that runs into a Latin letter or digit, as
    in "？OK，Let's": the aligner splits words only at spaces and Han characters, and would time
    "OKLet's" as one word. Opening marks stay with the word after them."""
    out = []
    for ch, after in zip(text, text[1:] + " ", strict=True):
        out.append(ch)
        if (
            ch not in _OPENING
            and unicodedata.category(ch).startswith("P")
            and unicodedata.east_asian_width(ch) in "FW"
            and after.isascii()
            and after.isalnum()
        ):
            out.append(" ")
    return "".join(out)


_NUMERALS = {"零": 0, "〇": 0, "一": 1, "二": 2, "兩": 2, "三": 3, "四": 4, "五": 5, "六": 6,
             "七": 7, "八": 8, "九": 9}  # fmt: skip
_POWERS = {"十": 10, "百": 100, "千": 1000, "萬": 10000}
# Units and suffixes written straight after a number: 60mm, 4K, 4P, 120fps.
_UNITS = {"mm", "cm", "km", "kg", "mg", "ml", "fps", "hz", "khz", "mhz", "ghz", "kb", "mb", "gb",
          "tb", "mah", "px"}  # fmt: skip


def _value(numerals: str) -> int:
    """二零二四 -> 2024 read digit by digit; 一百二十 -> 120 and 十五 -> 15 by place."""
    if not any(ch in _POWERS for ch in numerals):
        return int("".join(str(_NUMERALS[ch]) for ch in numerals))
    total = section = digit = 0
    for ch in numerals:
        if ch in _NUMERALS:
            digit = _NUMERALS[ch]
        elif ch == "萬":
            total += (section + digit) * 10000
            section = digit = 0
        else:
            section += (digit or 1) * _POWERS[ch]
            digit = 0
    return total + section + digit


def _latin(ch: str) -> bool:
    return ch.isascii() and ch.isalpha()


def digits_by_latin(words: list[dict]) -> list[dict]:
    """Chinese numerals said next to a Latin word, as in a product name or a measure, written in
    digits as the name is ("Pocket 三" -> "Pocket 3"), joined to a unit or a one-letter suffix
    after them ("四 P" -> "4P", "六十 mm" -> "60mm"). Numerals elsewhere stay as said."""
    out: list[dict] = []
    i = 0
    while i < len(words):
        j = i
        while (
            j < len(words)
            and words[j]["text"]
            and all(ch in _NUMERALS or ch in _POWERS for ch in words[j]["text"])
        ):
            j += 1
        if j == i:
            out.append(words[i])
            i += 1
            continue
        before = out[-1]["text"] if out else ""
        after = words[j]["text"] if j < len(words) else ""
        letters = after
        while letters and unicodedata.category(letters[-1]).startswith("P"):
            letters = letters[:-1]
        joins = (
            letters.isascii()
            and letters.isalpha()
            and (len(letters) == 1 or letters.lower() in _UNITS)
        )
        if not _latin(before[-1:]) and not _latin(after[:1]):
            out.extend(words[i:j])
            i = j
            continue
        number = str(_value("".join(w["text"] for w in words[i:j])))
        last = words[j] if joins else words[j - 1]
        out.append({**words[i], "text": number + (after if joins else ""), "end": last["end"]})
        i = j + 1 if joins else j
    return out


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


# OpenCC's s2twp with two of our dictionaries, each a match of its own step: the longest match
# wins and on a tie ours does. everyday_s2t.txt fixes characters s2t picks wrong in everyday
# speech (很赞 -> 很讚, 系安全带 -> 繫安全帶, 嘴巴里面 -> 嘴巴裡面, noodles' 麵); everyday_tw.txt
# keeps everyday words that s2twp's Taiwan phrases turn into computing terms (类型 -> 型別,
# 项目 -> 專案, 对象 -> 物件), while longer computing terms (数据库 -> 資料庫) still convert.
EVERYDAY = Path(__file__).with_name("everyday_s2t.txt"), Path(__file__).with_name("everyday_tw.txt")


@cache
def _converter():
    import opencc

    stock = Path(opencc.OpenCC("s2twp").config)
    config = json.loads(stock.read_text(encoding="utf-8"))

    def resolve(node):
        if isinstance(node, dict):
            if node.get("type") == "ocd2":
                return {**node, "file": str(stock.parent / node["file"])}
            return {key: resolve(value) for key, value in node.items()}
        if isinstance(node, list):
            return [resolve(value) for value in node]
        return node

    config = resolve(config)
    s2t, tw = ({"type": "text", "file": str(path)} for path in EVERYDAY)
    phrases = config["segmentation"]["dict"]["dicts"]
    phrases.insert(0, s2t)
    config["conversion_chain"][0]["dict"]["dicts"][0]["dicts"].insert(0, s2t)
    taiwan = config["conversion_chain"][1]["dict"]["dicts"]
    taiwan[0] = {"type": "group", "match_policy": "union", "dicts": [tw, taiwan[0]]}
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "s2twp-everyday.json"
        path.write_text(json.dumps(config), encoding="utf-8")
        return opencc.OpenCC(str(path))


def default_asr_model() -> str:
    """The larger model with a CUDA GPU, the smaller one otherwise."""
    ml.require()
    import torch

    return GPU_ASR_MODEL if torch.cuda.is_available() else CPU_ASR_MODEL


# Hears each chunk's audio: its text and the language the model names (None when it names none).
Recognizer = Callable[[list[np.ndarray], Callable[[str], None]], list[tuple[str, str | None]]]


def transcribe(
    samples: np.ndarray,
    speech: list[dict],
    asr_model: str | None = None,
    progress: Callable[[str], None] = lambda message: None,
    context: str = "",
    correct: Callable[[list[dict]], list[str]] | None = None,
    recognizer: Recognizer | None = None,
) -> dict:
    """Transcribe 16 kHz audio in Taiwan Traditional Chinese and English, with word timings.

    `context`, `correct` and `recognizer` are passed to `transcribe_chunks`.
    """
    words, texts, languages = [], [], Counter()
    chunks = transcribe_chunks(samples, speech, asr_model, progress, context, correct, recognizer)
    for chunk in chunks:
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
    recognizer: Recognizer | None = None,
) -> Iterator[dict]:
    """Yield each chunk the model heard text in: its `start`, `end`, `language`, `text`, `words`.

    `context` is Qwen3-ASR's context prompt, which biases it towards the words in it. `correct`
    takes every chunk's "start", "end", "text" and "language" and returns their corrected texts;
    it sees the whole transcript before any chunk is aligned, so the words are timed as corrected.
    `recognizer` hears the chunks in place of the local speech model (`asr_model` and `context`
    are then unused), as `openrouter.Client.recognize` does.
    """
    planned = plan_chunks(speech)
    if not planned:
        return  # loading the models takes a minute and gigabytes of memory
    wavs = []
    for start, end in planned:
        wav = samples[int(start * RATE) : int(end * RATE)]
        if len(wav) < MIN_INPUT * RATE:
            wav = np.pad(wav, (0, int(MIN_INPUT * RATE) - len(wav)))
        wavs.append(wav)
    if recognizer is None:
        recognize, align = _models(asr_model, progress)

        def hear(wavs, progress):
            heard = []
            for n, wav in enumerate(wavs, 1):
                progress(f"transcribing {n}/{len(wavs)}")
                heard.append(recognize(wav, context))
            return heard

        def recognizer(wavs, progress):
            heard = hear(wavs, progress)
            # Nothing heard in any chunk of speech is taken for the GPU failing: hear it again.
            on_gpu = isinstance(recognize, gpu.Fallback) and recognize.on_gpu
            if on_gpu and not any(text.strip() for text, _ in heard):
                recognize.fail("it heard nothing in any chunk")
                heard = hear(wavs, progress)
            return heard
    else:
        align = None  # loaded only once there is text to align, and in half precision
    chunks = []
    for (start, end), wav, (text, language) in zip(
        planned, wavs, recognizer(wavs, progress), strict=True
    ):
        text = text.strip()
        if not text:
            continue
        language = language or _language_of_script(text)
        if language not in ("Japanese", "Korean") and any(map(_han, text)):
            text = to_traditional(text)
            # The aligner splits Han characters and still reads space-separated English words.
            language = "Chinese"
        chunks.append({"start": start, "end": end, "text": text, "language": language, "wav": wav})

    if correct and chunks:
        for chunk, text in zip(chunks, correct(chunks), strict=True):
            chunk["text"] = text

    if chunks and align is None:
        align = _aligner_function(progress, half=True)
    floor = timing.noise_floor(samples, speech)
    for n, chunk in enumerate(chunks, 1):
        progress(f"aligning {n}/{len(chunks)}")
        start, end, language = chunk["start"], chunk["end"], chunk["language"]
        text = separate_latin(chunk["text"])
        # Padding added to a short chunk is not audio; keep words inside the real speech.
        items = [
            (token, round(min(start + s, end), 3), round(min(start + e, end), 3))
            for token, s, e in align(chunk["wav"], text)
        ]
        words = digits_by_latin(repair_durations(attach_punctuation(text, items)))
        # After the repair: a word the aligner gave no time would read as a pause around it.
        words = timing.refine(words, samples, speech, end, floor=floor)
        yield {"start": start, "end": end, "language": language, "text": text, "words": words}


def _models(asr_model: str | None, progress: Callable[[str], None]):
    """The speech model and the aligner, as two functions, each on the Mac's GPU until it fails
    there (`gpu.Fallback`, which reports to `progress`).

    `recognize(wav, context)` returns the text heard and its language (None when it heard none);
    `align(wav, text)` returns each aligner token with its start and end in `wav`.
    """
    recognize = gpu.Fallback("speech model", progress, lambda on: _recognizer(asr_model, on))
    return recognize, _aligner_function(progress)


def _aligner_function(progress: Callable[[str], None], half: bool = False) -> gpu.Fallback:
    """The aligner on the Mac's GPU until it fails there or times no token, then on the CPU."""

    def timed(items: list[tuple[str, float, float]]) -> bool:
        return gpu.finite([t for _, start, end in items for t in (start, end)])

    return gpu.Fallback("aligner", progress, lambda on: _aligner(half, on), timed)


@cache
def _device(apple_gpu: bool = False):
    """Where the models run, in which precision, after quieting transformers' notices: with
    `apple_gpu`, the Mac's GPU in 32-bit floats, as on a CPU."""
    ml.require()
    import torch
    from transformers.utils import logging as transformers_logging

    # Generation notices ("Setting pad_token_id …") and weight-loading progress bars mean nothing
    # to someone editing a video.
    transformers_logging.set_verbosity_error()
    transformers_logging.disable_progress_bar()
    if apple_gpu:
        return "mps", torch.float32
    cuda = torch.cuda.is_available()
    return ("cuda:0", torch.bfloat16) if cuda else ("cpu", torch.float32)


def _load(auto, name: str, half: bool = False, apple_gpu: bool = False):
    import torch
    from transformers import AutoProcessor

    device, dtype = _device(apple_gpu)
    dtype = torch.bfloat16 if half else dtype
    # Another model named with --asr-model runs at whatever its repository holds now.
    revision = REVISIONS.get(name)
    download.hub(name, revision)
    model = auto.from_pretrained(name, revision=revision, dtype=dtype).to(device).eval()
    return model, AutoProcessor.from_pretrained(name, revision=revision)


def _audio(wav: np.ndarray) -> np.ndarray:
    # Qwen's own inference code scales audio that peaks past full scale back into it.
    return wav / max(1.0, float(np.abs(wav).max()))


@cache
def _recognizer(asr_model: str | None, apple_gpu: bool = False):
    device, dtype = _device(apple_gpu)
    import torch
    from transformers import AutoModelForMultimodalLM

    name = asr_model or default_asr_model()
    asr, asr_processor = _load(AutoModelForMultimodalLM, name, apple_gpu=apple_gpu)

    @torch.inference_mode()
    def recognize(wav: np.ndarray, context: str) -> tuple[str, str | None]:
        inputs = asr_processor.apply_transcription_request(audio=_audio(wav), prompt=context)
        inputs = inputs.to(device, dtype)
        ids = asr.generate(**inputs, max_new_tokens=4096)[:, inputs["input_ids"].shape[1] :]
        heard = asr_processor.decode(ids, return_format="parsed")[0]
        return heard["transcription"], heard["language"]

    return recognize


@cache
def _aligner(half: bool = False, apple_gpu: bool = False):
    """The aligner as a function, on the Mac's GPU with `apple_gpu`. `half` runs it in bfloat16
    on a CPU too, which more than halves its memory and times words as well on the synthetic
    corpus ("Cloud speech" in the worker README); runs with the local speech model keep it in
    float32, as they were measured."""
    device, dtype = _device(apple_gpu)
    import torch
    from transformers import AutoModelForTokenClassification

    aligner, aligner_processor = _load(
        AutoModelForTokenClassification, ALIGNER_MODEL, half, apple_gpu
    )
    dtype = torch.bfloat16 if half else dtype

    @torch.inference_mode()
    def align(wav: np.ndarray, text: str) -> list[tuple[str, float, float]]:
        # No language: Japanese and Korean would need word splitters the project does not
        # install, and every other language is split alike.
        inputs, tokens = aligner_processor.prepare_forced_aligner_inputs(
            audio=_audio(wav), transcript=text, language=None
        )
        inputs = inputs.to(device, dtype)
        timed = aligner_processor.decode_forced_alignment(
            logits=aligner(**inputs).logits,
            input_ids=inputs["input_ids"],
            word_lists=tokens,
            timestamp_token_id=aligner.config.timestamp_token_id,
        )[0]
        return [(t["text"], t["start_time"], t["end_time"]) for t in timed]

    return align
