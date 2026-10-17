"""A transcription corpus from ASCEND, a public corpus of Mandarin and English speech that switches
between them, with human transcripts (https://huggingface.co/datasets/CAiRE/ASCEND, CC BY-SA 4.0).

A seeded sample of its test split's utterances is downloaded one by one through the Hugging Face
dataset viewer's API, each checked against the SHA-256 in ascend.json, and joined per recording
session into a clip of vebench's corpus layout: source.mp4 (the utterances in the order they were
said, 1 s apart, over a black picture) and truth/transcript.txt (their transcripts, in Taiwan
Traditional Chinese as the editor writes its captions). The transcripts stay under ASCEND's
licence and are written only into the corpus folder, which git ignores.
"""

import hashlib
import json
import random
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from functools import cache
from pathlib import Path

import imageio_ffmpeg

DATASET = "CAiRE/ASCEND"
REVISION = "737e9800ae31be9932ba8464c80366559bd28424"
ROWS = "https://datasets-server.huggingface.co/rows"
PAGE = 100
MANIFEST = Path(__file__).with_name("ascend.json")
GAP = 1.0  # seconds of silence between utterances
MIN_SECONDS = 1.5  # shorter utterances are mostly one-word backchannels (好的, 嗯)


def _get(url: str) -> bytes:
    """The response's body, waiting out the API's rate limit (429) up to 8 times."""
    for attempt in range(8):
        try:
            with urllib.request.urlopen(url, timeout=60) as reply:
                return reply.read()
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt == 7:
                raise
            time.sleep(float(exc.headers.get("Retry-After") or 2 ** (attempt + 1)))
    raise AssertionError("unreachable")


def _rows(offset: int, length: int) -> list[dict]:
    query = urllib.parse.urlencode(
        {"dataset": DATASET, "config": "main", "split": "test", "offset": offset, "length": length}
    )
    return [r["row"] for r in json.loads(_get(f"{ROWS}?{query}"))["rows"]]


def _start(row: dict) -> float:
    """Where in its session the utterance starts, from its file name (..._L<line>_<start>_<len>)."""
    match = re.search(r"_L\d+_([\d.]+)_[\d.]+\.wav$", row["path"])
    return float(match.group(1)) if match else 0.0


def _to_taiwan():
    import opencc

    return opencc.OpenCC("s2twp")


def build(
    out: Path,
    utterances: int,
    seed: int,
    log: Callable[[str], None],
    manifest: dict | None = None,
) -> dict:
    """Writes the clips to `out` and returns what it wrote. `manifest` is ascend.json's contents;
    when it is None, the sample is taken afresh and the returned manifest records it."""
    manifest = manifest if manifest is not None else _load_manifest()
    rows = _all_rows()
    if manifest:
        if manifest["seed"] != seed or manifest["utterances"] != utterances:
            raise ValueError(
                f"ascend.json records seed {manifest['seed']} and {manifest['utterances']} "
                "utterances; the checksums cover only that sample"
            )
        wanted = set(manifest["sha256"])
    else:
        long_enough = [r["id"] for r in rows if r["duration"] >= MIN_SECONDS]
        wanted = set(random.Random(seed).sample(sorted(long_enough), utterances))
    chosen = sorted(
        (r for r in rows if r["id"] in wanted), key=lambda r: (r["session_id"], _start(r))
    )
    if len(chosen) != len(wanted):
        raise ValueError(f"{DATASET} no longer has every utterance ascend.json names")
    log(f"{len(chosen)} of {len(rows)} test utterances")

    sums: dict[str, str] = {}
    audio: dict[str, bytes] = {}
    # The audio's addresses are signed for a while only, so each page is asked for again just
    # before its utterances are downloaded.
    for offset in sorted({int(r["id"]) // PAGE * PAGE for r in chosen}):
        for row in _rows(offset, PAGE):
            if row["id"] not in wanted:
                continue
            log(f"downloading {len(audio) + 1}/{len(chosen)}")
            src = row["audio"][0]["src"]
            if f"/--/{REVISION}/" not in src:
                raise ValueError(f"{DATASET} is no longer at revision {REVISION}: {src}")
            data = _get(src)
            digest = hashlib.sha256(data).hexdigest()
            if manifest and manifest["sha256"][row["id"]] != digest:
                raise ValueError(
                    f"{DATASET} utterance {row['id']}: SHA-256 {digest} is not ascend.json's"
                )
            sums[row["id"]], audio[row["id"]] = digest, data
    to_taiwan = _to_taiwan()
    clips: dict[str, list[tuple[Path, str]]] = {}
    with tempfile.TemporaryDirectory() as tmp:
        for row in chosen:
            wav = Path(tmp) / f"{row['id']}.wav"
            wav.write_bytes(audio[row["id"]])
            text = to_taiwan.convert(row["transcription"].strip())
            clips.setdefault(f"ascend-s{row['session_id']:02d}", []).append((wav, text))
        for name, parts in clips.items():
            folder = out / name
            (folder / "truth").mkdir(parents=True, exist_ok=True)
            _join([wav for wav, _ in parts], folder / "source.mp4")
            (folder / "truth" / "transcript.txt").write_text(
                "\n".join(text for _, text in parts) + "\n", encoding="utf-8"
            )
            log(f"{name}: {len(parts)} utterances")
    return {
        "clips": {name: len(parts) for name, parts in clips.items()},
        "manifest": {"seed": seed, "utterances": utterances, "sha256": dict(sorted(sums.items()))},
    }


@cache
def _all_rows() -> list[dict]:
    rows: list[dict] = []
    while page := _rows(len(rows), PAGE):
        rows += page
        if len(page) < PAGE:
            break
    return rows


def _load_manifest() -> dict:
    return json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {}


def _join(wavs: list[Path], out: Path) -> None:
    """The utterances GAP apart, mono 16 kHz AAC, over a black 320x180 picture as long."""
    inputs, chain = [], ""
    for i, wav in enumerate(wavs):
        inputs += ["-i", str(wav)]
        chain += f"[{i}:a]aresample=16000,aformat=channel_layouts=mono,apad=pad_dur={GAP}[a{i}];"
    chain += "".join(f"[a{i}]" for i in range(len(wavs))) + f"concat=n={len(wavs)}:v=0:a=1[a]"
    subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-y", *inputs,
         "-f", "lavfi", "-i", "color=black:s=320x180:r=25",
         "-filter_complex", chain, "-map", f"{len(wavs)}:v", "-map", "[a]",
         "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-b:a", "96k", "-shortest",
         str(out)],
        check=True,
    )  # fmt: skip
