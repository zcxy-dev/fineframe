"""The seed-0 synthetic corpus as downloads.fineframe.app publishes it, so a measurement starts
from the same files on every machine without the synth extra or the hours of generating them."""

import hashlib
import shutil
import tarfile
import tempfile
import urllib.request
from pathlib import Path

URL = "https://downloads.fineframe.app/corpus/synthetic-seed0-v1/synthetic-seed0.tar.gz"
SHA256 = "09783e95e719a6f4805b786de976f3780976a04ed3e1bb36474a4e2f5b9fe9d9"


def download(out: Path, url: str = URL, sha256: str = SHA256) -> None:
    """Downloads the archive, checks its SHA-256 and unpacks its `synthetic/` folder as `out`."""
    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / "synthetic.tar.gz"
        # Cloudflare, in front of downloads.fineframe.app, answers 403 to the default Python-urllib.
        request = urllib.request.Request(url, headers={"User-Agent": "vebench"})
        with urllib.request.urlopen(request, timeout=60) as reply, archive.open("wb") as file:
            shutil.copyfileobj(reply, file)
        digest = hashlib.sha256(archive.read_bytes()).hexdigest()
        if digest != sha256:
            raise ValueError(f"{url}: SHA-256 {digest}, expected {sha256}")
        with tarfile.open(archive) as tar:
            tar.extractall(tmp, filter="data")
        out.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(Path(tmp) / "synthetic", out, dirs_exist_ok=True)
