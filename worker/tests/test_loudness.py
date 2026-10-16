import numpy as np
import pytest

from vework import loudness

RATE = 16_000


def tone(seconds: float, amplitude: float = 0.1, freq: float = 997.0) -> np.ndarray:
    t = np.arange(round(seconds * RATE)) / RATE
    return (amplitude * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def test_k_weighting_at_48_khz_is_the_one_bs1770_lists():
    sos = loudness.k_weighting(48_000)
    shelf = [1.53512485958697, -2.69169618940638, 1.19839281085285,
             1.0, -1.69065929318241, 0.73248077421585]  # fmt: skip
    highpass = [1.0, -2.0, 1.0, 1.0, -1.99004745483398, 0.99007225036621]
    np.testing.assert_allclose(sos, [shelf, highpass], atol=1e-8)


def test_a_calibrated_sine_reads_its_level_every_second():
    # BS.1770: a 997 Hz sine at 0 dB FS in one channel reads -3.01 LUFS, so 0.1 (-20 dB) is -23.01.
    result = loudness.measure(tone(5))
    assert result["momentary"] == pytest.approx([-23.0] * 5, abs=0.1)
    assert result["short_term"] == pytest.approx([-23.0] * 5, abs=0.1)


def test_channels_are_weighed_apart_and_summed():
    # BS.1770 adds the channels' energies: the same sine in both reads 3 dB above one alone, and
    # unrelated sound in each is not cancelled or halved by a downmix first.
    both = np.stack([tone(3), tone(3)], axis=1)
    assert loudness.measure(both)["short_term"] == pytest.approx([-20.0] * 3, abs=0.1)
    opposite = np.stack([tone(3), -tone(3)], axis=1)
    assert loudness.measure(opposite)["short_term"] == pytest.approx([-20.0] * 3, abs=0.1)


def test_momentary_catches_a_burst_that_short_term_averages_out():
    quiet, burst = tone(6, 0.001), tone(0.4)  # -63 and -23 LUFS
    samples = quiet.copy()
    samples[round(3.3 * RATE) : round(3.7 * RATE)] = burst
    result = loudness.measure(samples)
    assert result["momentary"][3] == pytest.approx(-23.0, abs=0.2)
    assert result["momentary"][2] == result["momentary"][4] == pytest.approx(-63.0, abs=0.2)
    # A 0.4 s burst in a 3 s window: 10 * log10(0.4 / 3) = -8.8 LU.
    assert result["short_term"][3] == pytest.approx(-23.0 - 8.8, abs=0.3)


def test_short_term_is_centred_on_its_second():
    samples = np.concatenate([tone(4), tone(4, 0.01)])  # -23 LUFS, then -43
    short_term = loudness.measure(samples)["short_term"]
    # Second 3 spans 2..5 s: two loud seconds and one quiet.
    assert short_term[3] == pytest.approx(-23.0 + 10 * np.log10((2 + 0.01) / 3), abs=0.2)
    assert short_term[0] == pytest.approx(-23.0, abs=0.1)
    assert short_term[7] == pytest.approx(-43.0, abs=0.1)


def test_a_partial_last_second_and_short_audio_get_values():
    assert len(loudness.measure(tone(2.5))["momentary"]) == 3
    short = loudness.measure(tone(0.25))
    assert short["momentary"] == pytest.approx([-23.0], abs=0.2)
    assert short["short_term"] == pytest.approx([-23.0], abs=0.2)


def test_silence_reads_the_floor_and_nothing_reads_nothing():
    assert loudness.measure(np.zeros(2 * RATE, np.float32)) == {
        "momentary": [-70.0, -70.0],
        "short_term": [-70.0, -70.0],
    }
    assert loudness.measure(np.zeros(0, np.float32)) == {"momentary": [], "short_term": []}


def test_filtering_in_chunks_matches_filtering_at_once(monkeypatch):
    # A 50 Hz hum sits near the 38 Hz high-pass, whose memory then spans chunks: a filter that
    # restarted in each chunk would read different values. White noise would hide that.
    samples = tone(7, 0.3, 50.0)
    whole = loudness.measure(samples)
    monkeypatch.setattr(loudness, "CHUNK", 3)
    assert loudness.measure(samples) == whole
