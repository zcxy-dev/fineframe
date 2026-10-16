import http.server
import re
import threading
import types

import pytest

from vework import download

LINE = re.compile(r"^vework: downloading (.+): (\d+) of (\d+) bytes$")


def reported(capsys) -> list[tuple[str, int, int]]:
    lines = capsys.readouterr().err.splitlines()
    return [(m[1], int(m[2]), int(m[3])) for line in lines if (m := LINE.match(line))]


@pytest.fixture
def served():
    """A local web server whose every path answers with 3 MB."""
    body = bytes(range(256)) * (3 * 4096)

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}/model.bin", body
    server.shutdown()


def test_a_file_reports_its_bytes_from_none_to_all(served, capsys, monkeypatch):
    monkeypatch.setattr(download, "INTERVAL", 0)
    address, body = served
    assert download.url(address, "Test model") == body
    lines = reported(capsys)
    assert lines[0] == ("Test model", 0, len(body))
    assert lines[-1] == ("Test model", len(body), len(body))
    assert [done for _, done, _ in lines] == sorted(done for _, done, _ in lines)


def fake_hub(monkeypatch, tmp_path, planned, write):
    """huggingface_hub with its cache in tmp_path: a dry run plans `planned` (name, size, will
    download), and a download calls `write(parts, cached)` to write parts and mark files whole."""
    pytest.importorskip("huggingface_hub")
    from huggingface_hub import constants

    monkeypatch.setattr(constants, "HF_HUB_CACHE", str(tmp_path))
    monkeypatch.setattr(constants, "HF_HUB_OFFLINE", False)
    parts = tmp_path / "models--org--model" / "blobs"
    parts.mkdir(parents=True)
    calls, cached = [], set()

    def snapshot_download(repo, revision=None, allow_patterns=None, dry_run=False):
        calls.append((repo, revision, allow_patterns, dry_run))
        if dry_run:
            if planned is None:
                raise OSError("offline")
            return [
                types.SimpleNamespace(filename=n, file_size=s, will_download=w)
                for n, s, w in planned
            ]
        write(parts, cached)
        return str(tmp_path)

    def try_to_load_from_cache(repo, name, revision=None):
        return str(tmp_path / name) if name in cached else None

    monkeypatch.setattr("huggingface_hub.snapshot_download", snapshot_download)
    monkeypatch.setattr("huggingface_hub.try_to_load_from_cache", try_to_load_from_cache)
    monkeypatch.setattr(download, "INTERVAL", 0.01)
    return calls


def test_a_model_reports_the_bytes_it_still_needs(monkeypatch, tmp_path, capsys):
    def write(parts, cached):
        # Part of a download an earlier run left counts as downloaded.
        (parts / "aaa.incomplete").write_bytes(b"x" * 500)
        threading.Event().wait(0.05)
        (parts / "aaa.incomplete").unlink()
        cached.add("a.safetensors")
        threading.Event().wait(0.05)
        (parts / "bbb.incomplete").write_bytes(b"x" * 1000)

    planned = [("config.json", 10, False), ("a.safetensors", 1000, True), ("b.bin", 2000, True)]
    files = ["config.json", "a.safetensors", "b.bin"]
    calls = fake_hub(monkeypatch, tmp_path, planned, write)
    download.hub("org/model", "abc", files)
    assert calls == [("org/model", "abc", files, True), ("org/model", "abc", files, False)]
    lines = reported(capsys)
    assert lines[0] == ("org/model", 0, 3000)
    for done in [500, 1000]:
        assert ("org/model", done, 3000) in lines
    assert [done for _, done, _ in lines] == sorted(done for _, done, _ in lines)
    assert lines[-1] == ("org/model", 3000, 3000)


def test_a_model_already_downloaded_says_nothing(monkeypatch, tmp_path, capsys):
    calls = fake_hub(monkeypatch, tmp_path, [("model.safetensors", 1000, False)], None)
    download.hub("org/model", "abc")
    assert [dry for *_, dry in calls] == [True]
    assert reported(capsys) == []


def test_offline_leaves_the_model_to_the_cache(monkeypatch, tmp_path, capsys):
    calls = fake_hub(monkeypatch, tmp_path, None, None)
    download.hub("org/model", "abc")
    assert [dry for *_, dry in calls] == [True]
    assert reported(capsys) == []
