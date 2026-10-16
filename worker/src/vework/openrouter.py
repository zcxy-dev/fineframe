"""Hear speech with a speech model on OpenRouter, paid with the user's own key (`--asr cloud`).

Only speech is sent: each transcription chunk's 16 kHz mono audio, losslessly compressed as
FLAC. Video, silence between chunks and everything the rest of the analysis computes stay on this
machine, and the local aligner still times the words.
"""

import base64
import io
import json
import os
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed

import av
import numpy as np

from vework.audio import RATE
from vework.transcribe import LANGUAGE_CODES

API = "https://openrouter.ai/api/v1"
KEY = "OPENROUTER_API_KEY"
# The local default with a GPU, run by OpenRouter's provider: US$0.027 an hour of speech, and
# the same text for the same audio every time (worker README).
MODEL = "qwen/qwen3-asr-1.7b"
WORKERS = 8  # chunks in flight at once
TIMEOUT = 120.0  # seconds per request; providers give up after 60
TRIES = 5
MAX_WAIT = 60.0  # longest pause between tries, whatever Retry-After asks
# Never routed to a provider that keeps audio non-transiently or trains on it.
PROVIDER = {"data_collection": "deny"}


class Client:
    """Transcribes chunks on OpenRouter and adds up what OpenRouter charged for them."""

    def __init__(self, model: str = MODEL, key: str | None = None, api: str = API) -> None:
        self.model, self.api = model, api
        self.key = key if key is not None else os.environ.get(KEY, "")
        self.cost = 0.0
        self._lock = threading.Lock()

    def check(self) -> None:
        """Fail before an analysis that takes hours when the key or the model cannot be used."""
        if not self.key:
            raise RuntimeError(
                f"--asr cloud needs an OpenRouter API key: set {KEY}, or load the repository's "
                "`.env` with `uv run --env-file ../.env vework ...`"
            )
        if not self.key.isascii() or any(ch.isspace() for ch in self.key):
            raise RuntimeError(
                f"{KEY} is not an OpenRouter key: keys are letters, digits and dashes starting "
                "sk-or-; copy yours from https://openrouter.ai/settings/keys"
            )
        self._request("GET", "/key")
        try:
            found = self._request("GET", f"/models/{self.model}/endpoints")["data"]
        except RuntimeError as exc:
            if "(404)" not in str(exc):
                raise
            found = None
        modalities = (found or {}).get("architecture", {}).get("output_modalities", [])
        if "transcription" not in modalities:
            raise RuntimeError(
                f"{self.model} is not a speech-to-text model on OpenRouter; see "
                "https://openrouter.ai/models?output_modalities=transcription"
            )

    def recognize(
        self, wavs: list[np.ndarray], progress: Callable[[str], None] = lambda message: None
    ) -> list[tuple[str, str | None]]:
        """Each chunk's text and the language the model names for it (None when it names none)."""
        heard: list[tuple[str, str | None]] = [("", None)] * len(wavs)
        pool = ThreadPoolExecutor(WORKERS)
        try:
            futures = {pool.submit(self._one, wav): i for i, wav in enumerate(wavs)}
            for done, future in enumerate(as_completed(futures), 1):
                heard[futures[future]] = future.result()
                progress(f"transcribing {done}/{len(wavs)} (US${self.cost:.4f} so far)")
        finally:
            # A failed chunk fails the analysis; the chunks still queued are not sent.
            pool.shutdown(cancel_futures=True)
        return heard

    def _one(self, wav: np.ndarray) -> tuple[str, str | None]:
        body = {
            "model": self.model,
            "input_audio": {"data": base64.b64encode(flac(wav)).decode(), "format": "flac"},
            "response_format": "verbose_json",
            "provider": PROVIDER,
        }
        reply = self._request("POST", "/audio/transcriptions", body)
        with self._lock:
            self.cost += float((reply.get("usage") or {}).get("cost") or 0.0)
        return reply.get("text") or "", language(reply.get("language"))

    def _request(self, method: str, path: str, body: dict | None = None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        headers = {"Authorization": f"Bearer {self.key}", "Content-Type": "application/json"}
        for attempt in range(TRIES):
            request = urllib.request.Request(self.api + path, data, headers, method=method)
            try:
                with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
                    return json.load(response)
            except urllib.error.HTTPError as exc:
                retry = exc.code in (408, 429) or exc.code >= 500
                if not retry or attempt == TRIES - 1:
                    raise RuntimeError(_explain(exc)) from None
                wait = _retry_after(exc.headers.get("Retry-After"), attempt)
            except (urllib.error.URLError, TimeoutError, ConnectionError) as exc:
                if attempt == TRIES - 1:
                    reason = getattr(exc, "reason", exc)
                    raise RuntimeError(f"cannot reach OpenRouter: {reason}") from None
                wait = _retry_after(None, attempt)
            _sleep(wait)
        raise AssertionError("unreachable")


def flac(wav: np.ndarray) -> bytes:
    """16 kHz mono float samples as a 16-bit FLAC file."""
    # Qwen's own inference code scales audio that peaks past full scale back into it; 16 bits
    # would clip it instead.
    wav = np.ascontiguousarray(wav / max(1.0, float(np.abs(wav).max())), np.float32)
    out = io.BytesIO()
    with av.open(out, "w", format="flac") as container:
        stream = container.add_stream("flac", rate=RATE, layout="mono")
        frame = av.AudioFrame.from_ndarray(wav[None, :], format="flt", layout="mono")
        frame.sample_rate = RATE
        for packet in [*stream.encode(frame), *stream.encode(None)]:
            container.mux(packet)
    return out.getvalue()


def language(said: str | None) -> str | None:
    """The language a cloud model names, by the English name Qwen3-ASR uses; None if unknown.

    Models name languages in their own ways: "Chinese", "chinese", "zh" or "zh-TW".
    """
    if not said:
        return None
    by_code = {code: name for name, code in LANGUAGE_CODES.items()}
    by_name = {name.lower(): name for name in LANGUAGE_CODES}
    said = said.strip()
    return by_name.get(said.lower()) or by_code.get(said.split("-")[0].lower())


def _explain(exc: urllib.error.HTTPError) -> str:
    try:
        message = json.loads(exc.read()).get("error", {}).get("message", "")
    except (ValueError, AttributeError, OSError):
        message = ""
    detail = f" ({exc.code}): {message}" if message else f" ({exc.code})"
    if exc.code == 401:
        return f"OpenRouter rejected {KEY}{detail}; check it at https://openrouter.ai/settings/keys"
    if exc.code == 402:
        return (
            f"OpenRouter has no credit left for this key{detail}; add some at "
            "https://openrouter.ai/settings/credits"
        )
    return f"OpenRouter refused the request{detail}"


def _retry_after(header: str | None, attempt: int) -> float:
    try:
        return min(MAX_WAIT, max(0.0, float(header)))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return min(MAX_WAIT, 2.0**attempt)


_sleep = time.sleep
