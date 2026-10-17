import pytest

from vebench import ascend

ROW = {
    "id": "00007",
    "path": "/x/waves/ses1_spk17_L3818_9.3200_2.6400.wav",
    "transcription": "我们 test 一下",
    "duration": 2.64,
    "session_id": 1,
    "audio": [{"src": f"https://example/--/{ascend.REVISION}/--/main/test/7/audio.wav"}],
}


@pytest.fixture
def offline(monkeypatch):
    monkeypatch.setattr(ascend, "_all_rows", lambda: [ROW])
    monkeypatch.setattr(ascend, "_rows", lambda offset, length: [ROW])
    monkeypatch.setattr(ascend, "_get", lambda url: b"not the published audio")


def test_an_utterance_whose_checksum_differs_from_the_manifest_is_refused(offline, tmp_path):
    manifest = {"seed": 0, "utterances": 1, "sha256": {"00007": "0" * 64}}
    with pytest.raises(ValueError, match="SHA-256"):
        ascend.build(tmp_path, 1, 0, lambda _: None, manifest)
    assert not any(tmp_path.iterdir())


def test_a_sample_other_than_the_manifest_s_is_refused(offline, tmp_path):
    manifest = {"seed": 0, "utterances": 200, "sha256": {}}
    with pytest.raises(ValueError, match="seed 0 and 200"):
        ascend.build(tmp_path, 50, 0, lambda _: None, manifest)
