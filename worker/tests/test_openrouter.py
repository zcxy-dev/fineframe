import base64
import concurrent.futures
import io
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import av
import numpy as np
import pytest

from vework import openrouter

SPEECH = {"data": {"architecture": {"output_modalities": ["transcription"]}}}


class FakeOpenRouter:
    """A local stand-in for OpenRouter's API that answers from `replies`, a list per path of
    (status, body, headers) taken in turn (the last one repeats), and records each request."""

    def __init__(self, replies: dict[str, list[tuple[int, dict, dict]]]) -> None:
        self.replies, self.requests = replies, []
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def answer(self):
                length = int(self.headers.get("Content-Length") or 0)
                body = json.loads(self.rfile.read(length)) if length else None
                path = self.path.removeprefix("/api/v1")
                fake.requests.append((self.command, path, dict(self.headers), body))
                queue = fake.replies.get(path, [(404, {"error": {"message": "no"}}, {})])
                status, reply, headers = queue.pop(0) if len(queue) > 1 else queue[0]
                if callable(reply):
                    reply = reply(body)
                data = json.dumps(reply).encode()
                self.send_response(status)
                for name, value in headers.items():
                    self.send_header(name, value)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            do_GET = do_POST = answer

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.api = f"http://127.0.0.1:{self.server.server_port}/api/v1"

    def client(self, model: str = openrouter.MODEL, key: str = "test-key") -> openrouter.Client:
        return openrouter.Client(model, key=key, api=self.api)

    def posts(self) -> list[dict]:
        return [body for method, _, _, body in self.requests if method == "POST"]


@pytest.fixture
def fake(monkeypatch):
    servers = []
    monkeypatch.setattr(openrouter, "_sleep", lambda seconds: None)

    def make(replies):
        servers.append(FakeOpenRouter(replies))
        return servers[-1]

    yield make
    for server in servers:
        server.server.shutdown()


def heard(text, language="Chinese", cost=0.0002):
    return (200, {"text": text, "language": language, "usage": {"cost": cost}}, {})


def test_each_chunk_is_sent_as_flac_speech_only_and_in_order(fake):
    def answer(body):
        # The reply names the chunk's length, so a mix-up in order would show.
        audio = base64.b64decode(body["input_audio"]["data"])
        with av.open(io.BytesIO(audio)) as container:
            samples = sum(frame.samples for frame in container.decode(audio=0))
        return {"text": f"{samples}", "usage": {"cost": 0.001}}

    server = fake({"/audio/transcriptions": [(200, answer, {})]})
    client = server.client()
    wavs = [np.zeros(16_000 * n, np.float32) for n in (3, 1, 2)]
    assert client.recognize(wavs) == [("48000", None), ("16000", None), ("32000", None)]
    body = server.posts()[0]
    assert body["model"] == openrouter.MODEL and body["input_audio"]["format"] == "flac"
    assert body["provider"] == {"data_collection": "deny"}
    assert server.requests[0][2]["Authorization"] == "Bearer test-key"
    assert client.cost == pytest.approx(0.003)


def test_progress_counts_chunks_and_dollars(fake):
    server = fake({"/audio/transcriptions": [heard("你好")]})
    said = []
    server.client().recognize([np.zeros(8_000, np.float32)] * 2, said.append)
    assert said == ["transcribing 1/2 (US$0.0002 so far)", "transcribing 2/2 (US$0.0004 so far)"]


def test_progress_counts_only_the_chunks_it_reports(fake, monkeypatch):
    # Both chunks finish before the first is reported, as two parallel requests can.
    def all_then_each(futures):
        concurrent.futures.wait(futures)
        return iter(list(futures))

    monkeypatch.setattr(openrouter, "as_completed", all_then_each)
    server = fake({"/audio/transcriptions": [heard("你好")]})
    said = []
    server.client().recognize([np.zeros(8_000, np.float32)] * 2, said.append)
    assert said == ["transcribing 1/2 (US$0.0002 so far)", "transcribing 2/2 (US$0.0004 so far)"]


def test_audio_that_peaks_past_full_scale_is_scaled_not_clipped():
    wav = np.sin(np.linspace(0, 200, 16_000)).astype(np.float32) * 2
    with av.open(io.BytesIO(openrouter.flac(wav))) as container:
        decoded = np.concatenate([f.to_ndarray()[0] for f in container.decode(audio=0)])
    peak = np.abs(decoded).max()
    assert decoded.dtype == np.int16 and 32_000 < peak < 32_768
    assert np.corrcoef(decoded, wav)[0, 1] > 0.999


@pytest.mark.parametrize(
    ("said", "name"),
    [("Chinese", "Chinese"), ("chinese", "Chinese"), ("zh", "Chinese"), ("zh-TW", "Chinese"),
     ("en", "English"), ("ja", "Japanese"), ("xx", None), (None, None), ("", None)],
)  # fmt: skip
def test_languages_are_named_as_qwen_names_them(said, name):
    assert openrouter.language(said) == name


def test_busy_and_failing_servers_are_retried(fake):
    busy = (429, {"error": {"message": "rate limited"}}, {"Retry-After": "1"})
    down = (502, {"error": {"message": "provider down"}}, {})
    server = fake({"/audio/transcriptions": [busy, down, heard("好")]})
    assert server.client().recognize([np.zeros(8_000, np.float32)]) == [("好", "Chinese")]
    assert len(server.posts()) == 3


def test_a_server_that_keeps_failing_fails_with_its_reason(fake):
    server = fake({"/audio/transcriptions": [(503, {"error": {"message": "overloaded"}}, {})]})
    with pytest.raises(RuntimeError, match=r"\(503\): overloaded"):
        server.client().recognize([np.zeros(8_000, np.float32)])
    assert len(server.posts()) == openrouter.TRIES


def test_a_refused_request_is_not_retried(fake):
    server = fake({"/audio/transcriptions": [(400, {"error": {"message": "bad audio"}}, {})]})
    with pytest.raises(RuntimeError, match="bad audio"):
        server.client().recognize([np.zeros(8_000, np.float32)])
    assert len(server.posts()) == 1


def test_an_unreachable_server_fails_with_a_message(monkeypatch):
    monkeypatch.setattr(openrouter, "_sleep", lambda seconds: None)
    client = openrouter.Client(key="test-key", api="http://127.0.0.1:9/api/v1")
    with pytest.raises(RuntimeError, match="cannot reach OpenRouter"):
        client.recognize([np.zeros(8_000, np.float32)])


def test_check_needs_a_key(monkeypatch):
    monkeypatch.delenv(openrouter.KEY, raising=False)
    with pytest.raises(RuntimeError, match="OPENROUTER_API_KEY"):
        openrouter.Client().check()


CHECKED = {"/key": [(200, {"data": {}}, {})], f"/models/{openrouter.MODEL}/endpoints": [
    (200, SPEECH, {})]}  # fmt: skip


def test_check_reads_the_key_from_the_environment(fake, monkeypatch):
    server = fake(dict(CHECKED))
    monkeypatch.setenv(openrouter.KEY, "from-env")
    openrouter.Client(api=server.api).check()
    assert server.requests[0][2]["Authorization"] == "Bearer from-env"


def test_check_names_an_invalid_key(fake):
    server = fake({"/key": [(401, {"error": {"message": "User not found."}}, {})]})
    with pytest.raises(RuntimeError, match=r"rejected OPENROUTER_API_KEY \(401\): User not found"):
        server.client().check()


def test_check_says_where_to_add_credit(fake):
    broke = (402, {"error": {"message": "Insufficient credits"}}, {})
    server = fake({**CHECKED, "/audio/transcriptions": [broke]})
    client = server.client()
    client.check()
    with pytest.raises(RuntimeError, match="no credit left.*settings/credits"):
        client.recognize([np.zeros(8_000, np.float32)])


@pytest.mark.parametrize(
    "reply",
    [(404, {"error": {"message": "Model not found"}}, {}),
     (200, {"data": {"architecture": {"output_modalities": ["text"]}}}, {})],
)  # fmt: skip
def test_check_refuses_a_model_that_is_not_speech_to_text(fake, reply):
    server = fake({"/key": [(200, {"data": {}}, {})], "/models/openai/gpt-x/endpoints": [reply]})
    with pytest.raises(RuntimeError, match="gpt-x is not a speech-to-text model"):
        server.client("openai/gpt-x").check()


def test_check_names_a_key_that_cannot_be_one(fake):
    # A placeholder pasted in place of the key once crashed inside the HTTP library.
    server = fake(dict(CHECKED))
    with pytest.raises(RuntimeError, match="OPENROUTER_API_KEY is not an OpenRouter key"):
        server.client(key="填入key").check()
    assert server.requests == []
