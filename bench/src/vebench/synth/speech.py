"""Speech from Kokoro-82M-v1.1-zh, with each word's time read from the model's own alignment.

Kokoro predicts how many 25 ms frames each phoneme lasts and decodes the audio from exactly
that alignment, so summing a word's phoneme durations gives where the word sits in the audio,
on that 25 ms grid, without a separate aligner. Where a word meets silence the alignment is not
where the sound is (see `fit_to_sound`), so those edges are read off the clean signal instead.
"""

import logging
import re
import warnings
from functools import cache

import numpy as np

REPO = "hexgrad/Kokoro-82M-v1.1-zh"
REVISION = (
    "01e7505bd6a7a2ac4975463114c3a7650a9f7218"  # pinned so a seed always gives the same audio
)
RATE = 24_000
FRAME = 600  # samples per predicted duration frame
SILENCE_DB = 40  # this far below the line's loudest 5 ms, the synthesized signal is silence
VOICES = {"A": "zf_001", "B": "zm_010"}

_HAN = "一-鿿"
WORD = re.compile(rf"[{_HAN}]|[A-Za-z]+(?:'[A-Za-z]+)*")
# English runs are phonemized by the English G2P, everything between them by the Chinese one.
_SEGMENT = re.compile(r"([A-Za-z][A-Za-z' ]*[A-Za-z]|[A-Za-z])|([^A-Za-z]+)")
_SYLLABLE = re.compile(r"[^1-5]*[1-5]")  # the Chinese G2P ends every syllable with its tone


def require() -> None:
    """Fail with install instructions when the optional `synth` extra is missing."""
    try:
        import kokoro  # noqa: F401
        import PIL  # noqa: F401
    except ImportError as exc:
        raise RuntimeError(
            "vebench synth needs the synth extra: run `uv sync --extra synth` in bench/"
        ) from exc


def phonemize(text: str) -> tuple[str, list[tuple[int, int]]]:
    """Kokoro phonemes for a line of Traditional Chinese and English, and each word's span in them.

    Words are what `WORD` finds in `text`: one per Han character, one per English word.
    """
    frontend, map_punctuation = _chinese()
    phonemes, spans = "", []
    for english, chinese in _SEGMENT.findall(text):
        if phonemes and not phonemes.endswith(" "):
            phonemes += " "
        if english:
            _, tokens = _english()(english)
            if [t.text for t in tokens] != WORD.findall(english):
                raise ValueError(f"{english!r}: English G2P split it into other words")
            for t in tokens:
                if not t.phonemes or "❓" in t.phonemes:
                    raise ValueError(f"{t.text!r}: not in the English lexicon")
                spans.append((len(phonemes), len(phonemes) + len(t.phonemes)))
                phonemes += t.phonemes + (" " if t.whitespace else "")
            continue
        if re.search(r"\d", chinese):
            raise ValueError(f"{chinese!r}: write numbers as words; digits change the length")
        # The G2P's word segmenter and pinyin tables are built on Simplified Chinese.
        simplified = _to_simplified().convert(chinese)
        if len(simplified) != len(chinese):
            raise ValueError(f"{chinese!r}: Simplified conversion changed its length")
        mapped = map_punctuation(simplified)
        if not mapped:
            continue
        _, tokens = frontend(mapped)
        for t in tokens:
            if not re.search(f"[{_HAN}]", t.text):
                phonemes += (t.phonemes or "") + t.whitespace
                continue
            syllables = _SYLLABLE.findall(t.phonemes)
            if "".join(syllables) != t.phonemes or len(syllables) != len(t.text):
                raise ValueError(f"{t.text!r}: phonemes {t.phonemes!r} are not one per character")
            for syllable in syllables:
                spans.append((len(phonemes), len(phonemes) + len(syllable)))
                phonemes += syllable
            phonemes += t.whitespace
    return phonemes.rstrip(), spans


def say(
    text: str, speaker: str, seed: int
) -> tuple[np.ndarray, list[tuple[str, float, float, int]]]:
    """Speak `text` in the speaker's voice: samples at RATE and (word, start, end, offset) for
    each word as written, punctuation attached to the word before it."""
    import torch

    phonemes, spans = phonemize(text)
    model = _model()
    unknown = set(phonemes) - set(model.vocab)
    if unknown:
        # Kokoro would silently drop them and shift every later word.
        raise ValueError(f"{text!r}: phonemes {sorted(unknown)} unknown to the model")
    torch.manual_seed(seed)  # the vocoder adds noise
    voice = _voice(VOICES[speaker])
    with torch.inference_mode():
        out = model(phonemes, voice[len(phonemes) - 1], _speed(len(phonemes)), return_output=True)
    edges = np.concatenate([[0], np.cumsum(out.pred_dur.numpy())]) * FRAME / RATE
    audio = out.audio.numpy().astype(np.float32)
    found = list(WORD.finditer(text))
    if len(found) != len(spans):
        raise ValueError(f"{text!r}: {len(spans)} timed words for {len(found)} written ones")
    words = []
    for i, (m, (a, b)) in enumerate(zip(found, spans, strict=True)):
        written = text[m.start() : found[i + 1].start() if i + 1 < len(found) else len(text)]
        # Index 0 of the durations is the start token the model adds before the phonemes.
        words.append((written.strip(), float(edges[a + 1]), float(edges[b + 1]), m.start()))
    return audio, fit_to_sound(audio, words)


def fit_to_sound(
    audio: np.ndarray, words: list[tuple[str, float, float, int]]
) -> list[tuple[str, float, float, int]]:
    """Move word edges that meet silence to where the sound starts or stops.

    Kokoro gives a phrase's last syllable the silence after it (a final "道。" lasts 0.6 s and
    sounds for 0.1 s), and its sound starts a frame or two before the first syllable's frame.
    Between two words the model's boundary stands: nothing in the signal marks it better.
    """
    hop = RATE // 200
    frames = len(audio) // hop
    level = np.sqrt((audio[: frames * hop].reshape(frames, hop) ** 2).mean(axis=1))
    loud = level > level.max() * 10 ** (-SILENCE_DB / 20)
    fitted = []
    for i, (text, start, end, at) in enumerate(words):
        first, last = round(start * RATE / hop), round(end * RATE / hop)
        sounding = np.nonzero(loud[first:last])[0]
        after = words[i + 1][1] if i + 1 < len(words) else None
        if len(sounding) and after != end:
            end = min(end, (first + sounding[-1] + 1) * hop / RATE)
        before = fitted[-1][2] if fitted else 0.0
        if before != start:
            while first > 0 and loud[first - 1] and (first - 1) * hop / RATE >= before:
                first -= 1
            start = min(start, first * hop / RATE)
        fitted.append((text, start, end, at))
    return fitted


def _speed(length: int) -> float:
    # From the model card's make_zh.py: Kokoro rushes long inputs, so slow those down.
    if length <= 83:
        return 1.1
    if length < 183:
        return (1 - (length - 83) / 500) * 1.1
    return 0.88


@cache
def _model():
    from huggingface_hub import hf_hub_download

    with warnings.catch_warnings():
        # torch deprecation notices from inside kokoro mean nothing to someone making a corpus.
        warnings.simplefilter("ignore")
        from kokoro import KModel

        return KModel(
            repo_id=REPO,
            config=hf_hub_download(REPO, "config.json", revision=REVISION),
            model=hf_hub_download(REPO, "kokoro-v1_1-zh.pth", revision=REVISION),
        ).eval()


@cache
def _voice(name: str):
    import torch
    from huggingface_hub import hf_hub_download

    path = hf_hub_download(REPO, f"voices/{name}.pt", revision=REVISION)
    return torch.load(path, weights_only=True)


@cache
def _english():
    from misaki import en

    # No espeak fallback: a word missing from the lexicon fails instead of being guessed.
    return en.G2P(trf=False, british=False, fallback=None, unk="❓")


@cache
def _chinese():
    with warnings.catch_warnings():
        # jieba has invalid escape sequences that warn when it is first compiled.
        warnings.simplefilter("ignore", SyntaxWarning)
        import jieba
        from misaki.zh import ZHG2P
        from misaki.zh_frontend import ZHFrontend

    jieba.setLogLevel(logging.WARNING)
    return ZHFrontend(), ZHG2P.map_punctuation


@cache
def _to_simplified():
    import opencc

    return opencc.OpenCC("tw2s")
