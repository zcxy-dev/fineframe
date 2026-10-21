import hashlib
import io
import tarfile

import numpy as np
import pytest
from conftest import ffmpeg
from scipy.io import wavfile
from scipy.signal import fftconvolve, lfilter

from vework import denoise, voice
from vework.audio import load

RATE = 48_000


def seconds(n: float) -> int:
    return round(n * RATE)


def bursts(starts, length=1.0, total=12.0, level=0.1, noise=0.0, seed=0):
    """Noise bursts standing in for speech: broadband like a voice and ending abruptly, over a
    room at `noise` RMS. Returns the audio and its speech segments."""
    rng = np.random.default_rng(seed)
    out = rng.normal(0, noise, seconds(total))
    for start in starts:
        out[seconds(start) : seconds(start + length)] += rng.normal(0, level, seconds(length))
    speech = [{"start": s, "end": s + length} for s in starts]
    return out.astype(np.float32), speech


def test_the_room_between_words_is_the_noise_floor():
    samples, speech = bursts([1, 4, 7], noise=10 ** (-50 / 20))
    assert voice.measure(samples, speech)["noise_floor_db"] == pytest.approx(-50, abs=0.5)


def test_speech_without_a_second_of_pause_has_no_noise_floor():
    samples, speech = bursts([0.1, 1.2, 2.3], total=3.5, noise=1e-3)
    assert voice.measure(samples, speech)["noise_floor_db"] is None


def test_digital_silence_between_words_reads_the_floor_of_the_scale():
    samples, speech = bursts([1, 4, 7])
    assert voice.measure(samples, speech)["noise_floor_db"] == -120


def test_speech_loudness_counts_only_speech():
    # BS.1770: a 997 Hz sine at 0.1 in one channel reads -23.0 LUFS. The silence around it does not
    # lower the speech's loudness.
    t = np.arange(seconds(10)) / RATE
    samples = (0.1 * np.sin(2 * np.pi * 997 * t) * ((t >= 2) & (t < 8))).astype(np.float32)
    level = voice.measure(samples, [{"start": 2.2, "end": 7.8}])["speech_lufs"]
    assert level == pytest.approx(-23.0, abs=0.1)


def test_loudness_range_is_ebu_tech_3343s_ten_lu_case():
    # Tech 3343's first loudness range case: 20 s at -20 LUFS then 20 s at -30 LUFS reads 10 LU.
    t = np.arange(seconds(20)) / RATE
    sine = np.sin(2 * np.pi * 1000 * t)
    # -20 and -30 LUFS in a single channel.
    samples = np.concatenate([sine * 10 ** (-17 / 20), sine * 10 ** (-27 / 20)]).astype(np.float32)
    lra = voice.measure(samples, [{"start": 0.0, "end": 40.0}])["loudness_range_lu"]
    assert lra == pytest.approx(10, abs=0.2)


@pytest.mark.parametrize("codec", ["pcm_s16le", "pcm_f32le"])
def test_clipping_in_one_channel_is_counted_before_the_mix(tmp_path, monkeypatch, codec):
    # A lavalier clipped in the left channel beside a quiet camera microphone: their mix never
    # comes near full scale. sin(x) >= 1/2 for a third of each cycle.
    source = tmp_path / "lav.wav"
    left = "clip(2*sin(2*PI*100*t)\\,-1\\,1)"
    ffmpeg("-f", "lavfi", "-i", f"aevalsrc={left}|0.01*sin(2*PI*300*t):s=48000:d=2",
           "-c:a", codec, str(source))  # fmt: skip
    monkeypatch.setattr(denoise, "enhance", lambda x, in_place: x)
    speech = [{"start": 0.0, "end": 2.0}]
    found = voice.analyze(source, speech, stem=tmp_path / "lav.voice.wav")
    assert found["recorded"]["clipped_share"] == pytest.approx(2 / 3, abs=0.01)
    # Denoising does not undo clipping.
    assert found["denoised"]["clipped_share"] == found["recorded"]["clipped_share"]


@pytest.mark.parametrize("rt60", [0.3, 0.6, 1.0])
def test_reverberation_time_is_read_from_the_falls_after_speech(rt60):
    samples, speech = bursts(range(1, 25, 3), length=1.0, total=28, noise=1e-5)
    t = np.arange(seconds(1.5 * rt60)) / RATE
    room = np.random.default_rng(1).normal(0, 1, len(t)) * np.exp(-6.91 * t / rt60)
    room *= 1 / np.sqrt(np.sum(room**2))
    room[0] = 1.0
    wet = fftconvolve(samples, room)[: len(samples)].astype(np.float32)
    assert voice.measure(wet, speech)["rt60"] == pytest.approx(rt60, abs=0.15)
    assert voice.measure(samples, speech)["rt60"] < 0.1


def test_reverberation_needs_falls_clear_of_the_noise():
    samples, speech = bursts(range(1, 25, 3), total=28, noise=0.03)
    assert voice.measure(samples, speech)["rt60"] is None


def test_the_balance_compares_bands_of_the_average_spectrum_of_speech():
    # White noise has equal power per hertz, so each band reads its width against the body's.
    samples, speech = bursts([1, 4, 7], length=2.0)
    found = voice.measure(samples, speech)
    assert found["mud_db"] == pytest.approx(10 * np.log10(350 / 1500), abs=0.3)
    assert found["presence_db"] == pytest.approx(10 * np.log10(3000 / 1500), abs=0.3)


def test_the_stem_reads_back_sample_for_sample(tmp_path):
    recorded = np.random.default_rng(0).normal(0, 0.5, seconds(2.5) + 7).astype(np.float32)
    recorded[100] = 1.4  # a centred stereo voice mixes above one channel's full scale
    voice.write_stem(tmp_path / "x.voice.wav", recorded, recorded * 0.25)
    both = load(tmp_path / "x.voice.wav", rate=RATE, channels=2)
    np.testing.assert_array_equal(both, np.stack([recorded, recorded * 0.25], axis=1))


def test_analyze_writes_the_recording_and_its_denoised_copy_and_measures_both(
    tmp_path, monkeypatch
):
    source = tmp_path / "talk.wav"
    samples, speech = bursts([1, 4, 7], noise=1e-3)
    wavfile.write(source, RATE, samples)
    # The denoiser writes over the samples it is given, as the real one does.
    monkeypatch.setattr(denoise, "enhance", lambda x, in_place: np.multiply(x, 0.5, out=x))
    found = voice.analyze(source, speech, stem=tmp_path / "talk.voice.wav")
    assert found["stem"] == "talk.voice.wav" and found["model"] == "DeepFilterNet3"
    # The recording beside its denoised copy, from the one decode the measurements read.
    both = load(tmp_path / "talk.voice.wav", rate=RATE, channels=2)
    recorded = load(source, rate=RATE)
    np.testing.assert_array_equal(both, np.stack([recorded, recorded * 0.5], axis=1))
    recorded, denoised = found["recorded"]["noise_floor_db"], found["denoised"]["noise_floor_db"]
    assert recorded - denoised == pytest.approx(6.0, abs=0.1)


def vowels(total: float, starts, seed=0) -> tuple[np.ndarray, list[dict], np.ndarray]:
    """Vowels in white noise at 10 dB SNR: a glottal pulse train whose pitch rises and falls,
    through three formants, in syllables 0.8 s long. A steady buzz would read to the denoiser
    as noise."""
    rng = np.random.default_rng(seed)
    clean = np.zeros(seconds(total))
    t = np.arange(seconds(0.8)) / RATE
    pitch = 120 + 40 * np.sin(2 * np.pi * 1.5 * t)
    pulses = (np.sin(2 * np.pi * np.cumsum(pitch) / RATE) > 0.995).astype(float)
    envelope = np.sin(np.pi * t / 0.8) ** 2 * (0.6 + 0.4 * np.sin(2 * np.pi * 4 * t) ** 2)
    for start in starts:
        sound = pulses + rng.normal(0, 0.02, len(t))
        for formant, width in ((700, 130), (1220, 70), (2600, 160)):
            r, angle = np.exp(-np.pi * width / RATE), 2 * np.pi * formant / RATE
            sound = lfilter([1 - r], [1, -2 * r * np.cos(angle), r * r], sound)
        clean[seconds(start) : seconds(start) + len(t)] = sound * envelope
    clean *= 0.1 / np.sqrt(np.mean(clean[clean != 0] ** 2))
    noise = rng.normal(0, 0.1 * 10 ** (-10 / 20), len(clean))
    speech = [{"start": s, "end": s + 0.8} for s in starts]
    return (clean + noise).astype(np.float32), speech, clean.astype(np.float32)


@pytest.mark.ml
def test_the_denoiser_lowers_the_room_and_keeps_speech_in_place():
    noisy, speech, clean = vowels(8.0, [1.0, 3.0, 5.0])
    out = denoise.enhance(noisy)
    assert len(out) == len(noisy)
    found = voice.measure(out, speech)
    assert found["noise_floor_db"] < voice.measure(noisy, speech)["noise_floor_db"] - 20
    # Same timing: the output correlates best with the clean voice at zero lag.
    span = slice(seconds(1), seconds(6))
    lags = range(-48, 49)
    match = [np.dot(np.roll(out, lag)[span], clean[span]) for lag in lags]
    assert lags[int(np.argmax(match))] == 0
    assert found["speech_lufs"] == pytest.approx(voice.measure(clean, speech)["speech_lufs"], abs=1)


@pytest.mark.ml
def test_chunks_join_without_a_step(monkeypatch):
    # Chunks of 3 s instead of 60 s, so a short clip crosses four joins, each in a pause.
    monkeypatch.setattr(denoise, "CHUNK", 300)
    noisy, _, _ = vowels(14.0, np.arange(0.5, 13, 1.5))
    out = denoise.enhance(noisy)

    def level(x: np.ndarray) -> float:
        return 10 * np.log10(np.mean(x.astype(np.float64) ** 2))

    for join in range(1, 5):
        at = join * 300 * denoise.HOP
        before, after = out[at - seconds(0.05) : at], out[at : at + seconds(0.05)]
        assert abs(level(after) - level(before)) < 3
        around = slice(at - seconds(0.2), at + seconds(0.2))
        assert level(noisy[around]) - level(out[around]) > 20
    # Written over its own input, chunk by chunk, it comes out the same.
    np.testing.assert_array_equal(denoise.enhance(noisy.copy(), in_place=True), out)


def test_a_new_denoiser_pin_replaces_the_old_ones_folder(tmp_path, monkeypatch):
    parts = io.BytesIO()
    with tarfile.open(fileobj=parts, mode="w:gz") as tar:
        for part in denoise.PARTS:
            info = tarfile.TarInfo(f"export/{part}.onnx")
            info.size = 4
            tar.addfile(info, io.BytesIO(b"onnx"))
    archive = parts.getvalue()
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path))
    monkeypatch.setattr(denoise, "SHA256", hashlib.sha256(archive).hexdigest())
    monkeypatch.setattr(denoise.download, "url", lambda url, name: archive)
    cache = tmp_path / "video-editor"
    for name in (
        "deepfilternet3-000000000000",
        "deepfilternet3-111111111111",
        "ffmpeg-222222222222",
    ):
        (cache / name).mkdir(parents=True)
    folder = denoise._download()
    assert sorted(path.name for path in cache.iterdir()) == sorted(
        [folder.name, "ffmpeg-222222222222"]
    )
    assert all((folder / f"{part}.onnx").read_bytes() == b"onnx" for part in denoise.PARTS)
