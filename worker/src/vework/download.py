"""Model weights downloaded on their first use, reported as they arrive.

Each report is a `vework: downloading <name>: <bytes> of <total> bytes` line on stderr, which the
engine passes on to the web page.
"""

import sys
import threading
import time
import urllib.request
from pathlib import Path

# Seconds between reports.
INTERVAL = 0.5


class _Reporter:
    """Reports at most every INTERVAL, never fewer bytes than before."""

    def __init__(self, name: str, total: int):
        self.name, self.total, self.done, self.last = name, total, 0, 0.0
        self._say(0)

    def update(self, done: int) -> None:
        self.done = max(self.done, min(done, self.total))
        if time.monotonic() - self.last >= INTERVAL:
            self._say(self.done)

    def finish(self) -> None:
        self._say(self.total)

    def _say(self, done: int) -> None:
        self.last = time.monotonic()
        print(f"vework: downloading {self.name}: {done} of {self.total} bytes", file=sys.stderr)


def url(address: str, name: str, timeout: float = 60) -> bytes:
    """The file at `address`, reporting its bytes when the server says how many there are."""
    with urllib.request.urlopen(address, timeout=timeout) as response:
        total = int(response.headers.get("Content-Length") or 0)
        reporter = _Reporter(name, total) if total else None
        chunks, done = [], 0
        while chunk := response.read(1 << 20):
            chunks.append(chunk)
            done += len(chunk)
            if reporter:
                reporter.update(done)
    if reporter:
        reporter.finish()
    return b"".join(chunks)


def hub(repo: str, revision: str | None, files: list[str] | None = None) -> None:
    """Downloads what the Hugging Face cache lacks of `repo` at `revision` (every file, or only
    `files`), reporting the bytes as they land in the cache. Says nothing when it is all there.
    Offline, or with the hub unreachable, it leaves the files to the code that loads them, which
    reads the cache or fails saying why."""
    import huggingface_hub
    from huggingface_hub import constants
    from huggingface_hub.utils import disable_progress_bars

    if constants.HF_HUB_OFFLINE:
        return
    # Its bars would reach the person as lines of log; the reports stand in for them.
    disable_progress_bars()
    try:
        planned = huggingface_hub.snapshot_download(
            repo, revision=revision, allow_patterns=files, dry_run=True
        )
    except Exception:
        return
    missing = [file for file in planned if file.will_download]
    total = sum(file.file_size for file in missing)
    if not total:
        return
    # A file is written to <name>.<run>.incomplete in the repository's folder, then moved into the
    # cache once whole. A part a stopped run left is never resumed, so it does not count.
    parts = Path(constants.HF_HUB_CACHE) / f"models--{repo.replace('/', '--')}" / "blobs"
    stale = set(parts.glob("*.incomplete"))

    def done() -> int:
        whole = sum(
            file.file_size
            for file in missing
            if isinstance(
                huggingface_hub.try_to_load_from_cache(repo, file.filename, revision=revision), str
            )
        )
        return whole + sum(_size(part) for part in parts.glob("*.incomplete") if part not in stale)

    reporter = _Reporter(repo, total)
    stop = threading.Event()

    def watch() -> None:
        while not stop.wait(INTERVAL):
            reporter.update(done())

    watcher = threading.Thread(target=watch, daemon=True)
    watcher.start()
    try:
        huggingface_hub.snapshot_download(repo, revision=revision, allow_patterns=files)
    finally:
        stop.set()
        watcher.join()
    reporter.finish()


def _size(path: Path) -> int:
    try:
        return path.stat().st_size
    except FileNotFoundError:  # moved into the cache once whole, between listing and reading
        return 0
