import hashlib
import io
import tarfile

import pytest

from vebench.synth import published


def archive(path, files):
    with tarfile.open(path, "w:gz") as tar:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_the_published_corpus_is_checked_then_unpacked_into_the_folder(tmp_path):
    tar = tmp_path / "synthetic.tar.gz"
    sha = archive(
        tar, {"synthetic/talk-a1/truth/shots.json": b"{}", "synthetic/music/b.json": b"[]"}
    )
    out = tmp_path / "corpus"
    published.download(out, url=tar.as_uri(), sha256=sha)
    assert (out / "talk-a1" / "truth" / "shots.json").read_bytes() == b"{}"
    assert (out / "music" / "b.json").read_bytes() == b"[]"


def test_an_archive_that_is_not_the_published_one_is_refused(tmp_path):
    tar = tmp_path / "synthetic.tar.gz"
    archive(tar, {"synthetic/talk-a1/source.mp4": b"other"})
    with pytest.raises(ValueError, match="SHA-256"):
        published.download(tmp_path / "corpus", url=tar.as_uri(), sha256="0" * 64)
    assert not (tmp_path / "corpus").exists()
