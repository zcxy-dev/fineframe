import json

import numpy as np
import pytest
from conftest import ffmpeg

from vework import beats, cli, music
from vework.music_index import MusicIndex

FPS = 50


def fake_spectrogram(bars: list[str], bar: float = 2.0, seed: int = 0) -> np.ndarray:
    """A log-mel-like spectrogram, one bar after another: each letter switches on its own band
    of the 128, as an instrument would, over a little frame-to-frame noise."""
    rng = np.random.default_rng(seed)
    bands = {"k": slice(0, 12), "b": slice(12, 30), "s": slice(40, 70), "h": slice(90, 128)}
    frames = []
    for parts in bars:
        frame = np.full(128, 0.5)
        for part in parts:
            frame[bands[part]] += 4.0
        frames.append(frame + rng.normal(0, 0.2, (round(bar * FPS), 128)))
    return np.concatenate(frames)


def downbeats_of(count: int, bar: float = 2.0) -> np.ndarray:
    return np.arange(count) * bar


def test_tempo_from_beats_and_downbeats():
    beats = np.arange(32) * 0.5 + 0.25
    result = music.tempo(beats, beats[::4])
    assert result == {"bpm": 120.0, "beats_per_bar": 4}
    assert music.tempo(beats[:1], beats[:0]) == {"bpm": None, "beats_per_bar": None}


def test_tempo_is_read_finer_than_the_trackers_frames():
    # At 128 BPM a beat lasts 468.75 ms, which the tracker's 20 ms frames round to 460 or 480.
    beats = np.round((np.arange(64) * 60 / 128 + 0.25) / 0.02) * 0.02
    assert music.tempo(beats, beats[::4])["bpm"] == pytest.approx(128, rel=0.005)


def test_sections_start_where_the_instruments_change():
    layout = ["kh"] * 8 + ["kshb"] * 12 + ["hb"] * 8
    spect = fake_spectrogram(layout)
    end = len(layout) * 2.0
    found = music.sections(spect, FPS, downbeats_of(len(layout)), [-20.0] * int(end), end)
    assert [(s["start"], s["end"]) for s in found] == [(0.0, 16.0), (16.0, 40.0), (40.0, 56.0)]


def test_a_steady_loop_is_one_section():
    spect = fake_spectrogram(["kshb"] * 24)
    found = music.sections(spect, FPS, downbeats_of(24), [-20.0] * 48, 48.0)
    assert [(s["start"], s["end"]) for s in found] == [(0.0, 48.0)]


def test_a_change_shorter_than_a_phrase_does_not_split_the_track():
    layout = ["kshb"] * 10 + ["kh"] * 2 + ["kshb"] * 10
    spect = fake_spectrogram(layout)
    found = music.sections(spect, FPS, downbeats_of(22), [-20.0] * 44, 44.0)
    # The two bars differ, but one side of every candidate boundary mixes both.
    assert [(s["start"], s["end"]) for s in found] == [(0.0, 44.0)]


def test_section_loudness_is_gated():
    # Silence is below the absolute gate; a passage 20 LU under the rest falls to the relative one.
    assert music.integrated([-20.0] * 8 + [-70.0] * 4) == -20.0
    assert music.integrated([-20.0] * 8 + [-40.0] * 2) == -20.0
    assert music.integrated([-70.0] * 3) == -70.0


def test_the_sound_ends_where_its_tail_falls_50_db_under_the_peak():
    rate = 8000
    t = np.arange(4 * rate) / rate
    tail = np.where(t < 1, 1.0, np.exp(-(t - 1) / 0.2))  # -8.7 dB every 0.2 s after 1 s
    samples = (0.5 * np.sin(2 * np.pi * 440 * t) * tail)[:, None]
    # 50 dB below the peak is reached 50 / 8.69 * 0.2 = 1.15 s into the decay.
    assert music.sound_end(samples, rate) == pytest.approx(2.15, abs=0.06)


def test_beats_in_the_silence_around_the_sound_are_dropped():
    rate = 8000
    samples = np.zeros(4 * rate)
    samples[rate // 2 : 3 * rate] = 0.5  # sound from 0.5 to 3 s
    times = np.array([0.02, 0.48, 1.0, 2.96, 3.2])
    # A beat a frame before the first hit is that hit, read early.
    assert music.heard(times, samples, rate).tolist() == [0.48, 1.0, 2.96]


def test_no_licence_no_analysis(tmp_path):
    with pytest.raises(ValueError, match="licence"):
        music.analyze(tmp_path / "song.wav", {"name": ""}, print)


def test_a_silent_track_is_refused(tmp_path):
    # Nothing in it would be heard, so the planner could only fit the music to no time at all.
    song = tmp_path / "silence.wav"
    ffmpeg("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "3", str(song))
    with pytest.raises(ValueError, match="no sound"):
        music.analyze(song, {"name": "CC0 1.0"}, print)


def test_the_command_refuses_a_track_without_a_licence(tmp_path, capsys):
    song = tmp_path / "song.wav"
    ffmpeg("-f", "lavfi", "-i", "sine=d=1", str(song))
    with pytest.raises(SystemExit) as exit_info:
        cli.main(["analyze-music", str(song), "-o", str(tmp_path / "song.music.json")])
    assert exit_info.value.code == 2
    assert "--license" in capsys.readouterr().err


@pytest.mark.ml
@pytest.mark.beats
def test_a_synthetic_track_is_indexed_with_its_beats_and_sections(tmp_path):
    from vebench.beats import fmeasure
    from vebench.synth import corpus
    from vebench.synth import music as synth

    sections = ((8, "hb"), (16, "kshb"), (8, "kh"))
    samples, truth = synth.track(112, 32, 2, 0, sections)
    track, out = tmp_path / "beat.wav", tmp_path / "beat.music.json"
    corpus._write_wav(track, samples, synth.RATE)
    cli.main(["analyze-music", str(track), "-o", str(out), "--license", "CC0 1.0"])
    index = json.loads(out.read_text(encoding="utf-8"))
    MusicIndex.model_validate(index, strict=True)
    assert index["license"] == {"name": "CC0 1.0"}
    assert index["tempo"] == {"bpm": pytest.approx(112, abs=1), "beats_per_bar": 4}
    assert fmeasure(truth["beats"], index["beats"])["f"] > 0.95
    assert fmeasure(truth["downbeats"], index["downbeats"])["f"] > 0.95
    # The tracker also marks the beat the music would reach next, in the last bar's ring; no beat
    # is heard there.
    assert index["beats"][-1] < index["end"]
    assert index["downbeats"][-1] < index["end"]
    starts = [s["start"] for s in index["sections"]]
    assert starts == pytest.approx([s["start"] for s in truth["sections"]], abs=0.07)
    # The last bar's hits ring for under a second.
    assert truth["beats"][-1] < index["end"] < truth["duration"]


@pytest.mark.ml
def test_a_track_is_indexed_without_beats_when_the_beat_model_cannot_be_downloaded(
    tmp_path, monkeypatch, capsys
):
    def unavailable(mono):
        raise beats.Unavailable("cloud.cp.jku.at: HTTP Error 503: Service Unavailable")

    monkeypatch.setattr(beats, "track", unavailable)
    song, out = tmp_path / "song.wav", tmp_path / "song.music.json"
    ffmpeg("-f", "lavfi", "-i", "sine=f=330:d=12", "-ac", "2", str(song))
    cli.main(["analyze-music", str(song), "-o", str(out), "--license", "CC0 1.0"])
    index = json.loads(out.read_text(encoding="utf-8"))
    MusicIndex.model_validate(index, strict=True)
    # The planner fits a track without a bar grid from its start; the engine analyses it again
    # on the next edit.
    assert index["tracker"] == "none"
    assert (index["beats"], index["downbeats"]) == ([], [])
    assert index["tempo"] == {"bpm": None, "beats_per_bar": None}
    assert [(s["start"], s["end"]) for s in index["sections"]] == [(0.0, index["end"])]
    assert "no beats: the beat model could not be downloaded" in capsys.readouterr().err
