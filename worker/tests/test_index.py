import json
import re
import subprocess
from pathlib import Path

import av
import imageio_ffmpeg
import numpy as np
import pytest
from conftest import ffmpeg
from test_correct import FakeClaude

from vework import correct, denoise, events, framing, openrouter, shots, speech, transcribe
from vework.audio import load
from vework.cli import main
from vework.media_index import MediaIndex

EXAMPLE = Path(__file__).parents[2] / "packages/schema/examples/media-index.example.json"


@pytest.fixture
def talking_video(tmp_path):
    out = tmp_path / "talk.mp4"
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=160x90:r=25:d=2", "-f", "lavfi",
           "-i", "sine=f=220:d=2:sample_rate=48000", "-c:v", "libx264", "-preset", "ultrafast",
           "-c:a", "aac", "-shortest", str(out))  # fmt: skip
    return out


@pytest.fixture
def stub_models(monkeypatch):
    """Model results in the shapes the real models return, without loading a model."""
    monkeypatch.setattr(shots, "detect", lambda path: [{"start": 1.0, "end": 1.0}])
    monkeypatch.setattr(speech, "segments", lambda samples: [{"start": 0.25, "end": 1.5}])
    words = [{"text": "好", "start": 0.3, "end": 0.6}, {"text": "。", "start": 0.6, "end": 0.6}]
    monkeypatch.setattr(
        transcribe,
        "transcribe",
        lambda *args: {"language": "zh", "text": "好。", "words": words},
    )
    laugh = {"kind": "laughter", "start": 1.5, "end": 2.0, "confidence": 0.62}
    monkeypatch.setattr(events, "detect", lambda *args: [laugh])
    box = {"t": 0.2, "x": 0.4, "y": 0.2, "w": 0.2, "h": 0.3}
    speaking = {"face": 0, "start": 0.25, "end": 1.5}
    shot = {"start": 0.0, "end": 2.0, "layout": "talking_head",
            "faces": [{"id": 0, "boxes": [box]}], "speakers": [speaking]}  # fmt: skip
    monkeypatch.setattr(framing, "analyze", lambda *args: {"fps": 5.0, "shots": [shot]})
    monkeypatch.setattr(denoise, "enhance", lambda samples, in_place: samples * 0.5)


def test_the_shared_example_matches_the_model():
    MediaIndex.model_validate(json.loads(EXAMPLE.read_text(encoding="utf-8")), strict=True)


def test_a_built_index_matches_the_schema(talking_video, stub_models, tmp_path):
    out = tmp_path / "index.json"
    main(["analyze", str(talking_video), "-o", str(out)])
    written = json.loads(out.read_text(encoding="utf-8"))
    MediaIndex.model_validate(written, strict=True)
    assert written["source"]["video"]["width"] == 160 and written["speech"]
    assert "corrections" not in written
    # One value per second of the 2 s tone, at FFmpeg's default 1/8 amplitude (about -22 LUFS).
    assert written["loudness"]["momentary"] == pytest.approx([-22, -22], abs=1)
    assert written["audio_events"][0]["kind"] == "laughter"
    assert written["framing"]["shots"][0]["layout"] == "talking_head"
    # The recording and its denoised speech lie beside the index, as long as the track at 48 kHz.
    assert written["voice"]["stem"] == "index.voice.wav"
    track = load(talking_video, rate=48_000)
    stem = load(tmp_path / "index.voice.wav", rate=48_000, channels=2)
    np.testing.assert_allclose(stem, np.stack([track, track * 0.5], axis=1), atol=1e-7)
    assert written["voice"]["recorded"]["speech_lufs"] == pytest.approx(-22, abs=1)


@pytest.mark.parametrize("layout", ["mono", "stereo", "5.1(side)", "3c"])
def test_loudness_is_measured_at_the_sources_full_band_and_channels(layout, stub_models, tmp_path):
    # Pink noise, different in every channel: a third of its loudness lies above 8 kHz, and a
    # mix of its channels before weighing would lose a share by the mix and cancel the rest.
    # "3c" names no channels, as Matroska PCM can: FFmpeg takes them for 2.1 and leaves out the LFE.
    channels = int(layout[:-1]) if layout.endswith("c") else len(av.AudioLayout(layout).channels)
    noises = "".join(f"anoisesrc=c=pink:a=0.1:r=48000:d=4:seed={i}[n{i}];" for i in range(channels))
    source = tmp_path / "noise.mkv"
    ffmpeg("-filter_complex", noises + "".join(f"[n{i}]" for i in range(channels))
           + f"amerge=inputs={channels},aformat=channel_layouts={layout}", "-c:a", "pcm_f32le",
           str(source))  # fmt: skip
    out = tmp_path / "index.json"
    main(["analyze", str(source), "-o", str(out)])
    # FFmpeg's ebur128 filter weighs the channels as BS.1770 does, at the file's own rate.
    report = subprocess.run(
        [imageio_ffmpeg.get_ffmpeg_exe(), "-nostats", "-i", str(source), "-af", "ebur128",
         "-f", "null", "-"], capture_output=True, text=True, check=True,
    ).stderr  # fmt: skip
    integrated = float(re.findall(r"I:\s+(-?[\d.]+) LUFS", report)[-1])
    short_term = json.loads(out.read_text(encoding="utf-8"))["loudness"]["short_term"]
    assert short_term == pytest.approx([integrated] * 4, abs=0.5)


def test_bench_outputs_name_each_speaking_face(talking_video, stub_models, tmp_path):
    run = tmp_path / "run"
    main(
        ["analyze", str(talking_video), "-o", str(tmp_path / "index.json"), "--bench-run", str(run)]
    )
    turns = json.loads((run / "speakers.json").read_text(encoding="utf-8"))["turns"]
    assert turns == [{"start": 0.25, "end": 1.5, "speaker": "face-0"}]


def test_a_source_without_a_picture_has_no_framing(cover_art_audio, stub_models, tmp_path):
    out = tmp_path / "index.json"
    main(["analyze", str(cover_art_audio), "-o", str(out)])
    assert "framing" not in json.loads(out.read_text(encoding="utf-8"))


def test_a_corrected_index_records_its_corrections(talking_video, monkeypatch, tmp_path):
    monkeypatch.setattr(shots, "detect", lambda path: [])
    monkeypatch.setattr(speech, "segments", lambda samples: [{"start": 0.25, "end": 1.5}])
    monkeypatch.setattr(events, "detect", lambda samples: [])
    monkeypatch.setattr(framing, "analyze", lambda *args: {"fps": 5.0, "shots": []})
    monkeypatch.setattr(denoise, "enhance", lambda samples, in_place: samples)
    contexts, aligned = [], []

    def recognize(wav, context):
        contexts.append(context)
        return "我們在來看", "Chinese"

    def align(wav, text, language):
        aligned.append(text)
        return [(c, 0.2 * i, 0.2 * (i + 1)) for i, c in enumerate(text)]

    monkeypatch.setattr(transcribe, "_models", lambda model: (recognize, align))
    claude = FakeClaude(lambda text: [("在來", "再來", "在 should be 再.")])
    monkeypatch.setattr(correct, "_client", lambda: claude)
    glossary = tmp_path / "glossary.txt"
    glossary.write_text("林佳穎\n", encoding="utf-8")
    out = tmp_path / "index.json"
    main(["analyze", str(talking_video), "-o", str(out), "--correct", "--glossary",
          str(glossary), "--asr-context"])  # fmt: skip

    written = json.loads(out.read_text(encoding="utf-8"))
    MediaIndex.model_validate(written, strict=True)
    assert contexts == ["林佳穎"] and aligned == ["我們再來看"]
    assert written["transcript"]["text"] == "我們再來看"
    assert written["corrections"][0]["rejected"] is None
    assert "<title>talk</title>" in claude.requests[0]["messages"][0]["content"][0]["text"]


def test_a_cloud_index_records_the_model_and_what_it_cost(talking_video, monkeypatch, tmp_path):
    monkeypatch.setattr(shots, "detect", lambda path: [])
    monkeypatch.setattr(speech, "segments", lambda samples: [{"start": 0.25, "end": 1.5}])
    monkeypatch.setattr(events, "detect", lambda samples: [])
    monkeypatch.setattr(framing, "analyze", lambda *args: {"fps": 5.0, "shots": []})
    monkeypatch.setattr(denoise, "enhance", lambda samples, in_place: samples)
    monkeypatch.setattr(transcribe, "_models", lambda model: pytest.fail("speech model loaded"))
    align = lambda wav, text, language: [(c, 0.2 * i, 0.2 * (i + 1)) for i, c in enumerate(text)]  # noqa: E731
    monkeypatch.setattr(transcribe, "_aligner", lambda half: align)
    monkeypatch.setattr(openrouter.Client, "check", lambda self: None)

    def recognize(self, wavs, progress):
        self.cost += 0.0001
        return [("大家好", None)]

    monkeypatch.setattr(openrouter.Client, "recognize", recognize)
    out = tmp_path / "index.json"
    main(["analyze", str(talking_video), "-o", str(out), "--asr", "cloud"])

    written = json.loads(out.read_text(encoding="utf-8"))
    MediaIndex.model_validate(written, strict=True)
    assert written["transcript"]["text"] == "大家好"
    minutes = written["source"]["duration"] / 60
    cloud = written["transcript"]["cloud"]
    assert cloud["model"] == openrouter.MODEL and cloud["cost"] == 0.0001
    assert cloud["cost_per_minute"] == pytest.approx(0.0001 / minutes, rel=0.02)


def test_an_index_that_breaks_the_schema_fails_and_is_not_written(
    talking_video, stub_models, monkeypatch, tmp_path, capsys
):
    # The ASR model's own language name instead of a BCP 47 code.
    monkeypatch.setattr(
        transcribe, "transcribe", lambda *args: {"language": "Chinese", "text": "", "words": []}
    )
    out = tmp_path / "index.json"
    with pytest.raises(SystemExit) as exit_info:
        main(["analyze", str(talking_video), "-o", str(out)])
    assert exit_info.value.code == 1
    assert "transcript.language" in capsys.readouterr().err
    assert not out.exists()


def test_a_transition_on_the_first_frame_starts_at_time_zero(monkeypatch, tmp_path):
    # MPEG-TS counts in 90 kHz units and FFmpeg rounds the file's start time to whole
    # microseconds, here upwards, which put the first frame a fraction of a microsecond
    # before time zero, below the schema's minimum.
    source = tmp_path / "fade-in.ts"
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=160x90:r=30:d=1", "-c:v", "libx264",
           "-preset", "ultrafast", "-output_ts_offset", "0.0333667", str(source))  # fmt: skip

    def predict(frames):
        # A fade in from black over the first eight frames.
        flags = np.zeros(len(list(frames)))
        flags[:8] = 0.9
        return flags, flags

    monkeypatch.setattr(shots, "predict", predict)
    monkeypatch.setattr(framing, "analyze", lambda *args: {"fps": 5.0, "shots": []})
    out = tmp_path / "index.json"
    main(["analyze", str(source), "-o", str(out)])
    assert json.loads(out.read_text(encoding="utf-8"))["transitions"][0]["start"] == 0.0


@pytest.mark.ml
def test_analyze_writes_the_index_and_bench_outputs(shots_video, tmp_path, capsys):
    source = tmp_path / "with_silence.mp4"
    ffmpeg("-i", str(shots_video), "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono",
           "-shortest", "-c:v", "copy", "-c:a", "aac", str(source))  # fmt: skip
    out, run = tmp_path / "index.json", tmp_path / "run"
    main(["analyze", str(source), "-o", str(out), "--bench-run", str(run)])
    progress = capsys.readouterr().err
    stages = ["detecting shots", "finding speech", "measuring loudness", "finding audio events",
              "finding faces"]  # fmt: skip
    assert all(f"vework: {stage}" in progress for stage in stages)

    index = json.loads(out.read_text(encoding="utf-8"))
    MediaIndex.model_validate(index, strict=True)
    assert index["version"] == 1
    assert index["source"]["video"]["width"] == 320
    assert len(index["transitions"]) == 3
    assert index["speech"] == []  # silence holds no speech
    assert index["transcript"] == {"language": None, "text": "", "words": []}
    assert set(index["loudness"]["momentary"]) == {-70.0} and index["audio_events"] == []
    assert json.loads((run / "transcript.json").read_text(encoding="utf-8")) == {"words": []}
    # Test patterns hold no faces: four shots framed as screens, and no one speaks.
    assert [s["layout"] for s in index["framing"]["shots"]] == ["screen"] * 4
    assert json.loads((run / "speakers.json").read_text(encoding="utf-8")) == {"turns": []}
    cuts = json.loads((run / "shots.json").read_text(encoding="utf-8"))["cuts"]
    assert cuts[:2] == [3.0, 6.0] and cuts[2] == pytest.approx(8.5, abs=0.1)


@pytest.mark.ml
def test_speech_times_keep_sample_resolution(monkeypatch):
    import silero_vad

    from vework import speech

    # Silero rounds seconds to 0.1 s by default, which can start a cut inside a word.
    monkeypatch.setattr(
        silero_vad, "get_speech_timestamps", lambda *a, **k: [{"start": 19744, "end": 40008}]
    )
    found = speech.segments(np.zeros(16_000 * 3, np.float32))
    assert found == [{"start": 1.234, "end": 2.5005}]
