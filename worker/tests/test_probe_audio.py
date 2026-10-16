import tracemalloc

import numpy as np
import pytest
from conftest import ffmpeg

from vework import audio
from vework.probe import probe

TONE = "sine=f=440:d=2:sample_rate=48000"


def test_portrait_phone_footage_reports_displayed_size(tmp_path):
    plain, rotated = tmp_path / "plain.mp4", tmp_path / "rotated.mp4"
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=320x180:r=25:d=1", "-c:v", "libx264", str(plain))
    ffmpeg("-display_rotation", "90", "-i", str(plain), "-c", "copy", str(rotated))
    video = probe(rotated).video
    assert (video.width, video.height, video.rotation) == (180, 320, 90)
    assert video.fps == 25


def test_anamorphic_footage_reports_its_pixel_shape_as_displayed(tmp_path):
    square, wide, rotated = tmp_path / "square.mp4", tmp_path / "wide.mp4", tmp_path / "rotated.mp4"
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=320x180:r=25:d=1", "-c:v", "libx264", str(square))
    # 16:9 stored in 240 x 180 with 4:3 pixels, as HDV stores it in 1440 x 1080.
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=240x180:r=25:d=1", "-vf", "setsar=4/3",
           "-c:v", "libx264", str(wide))  # fmt: skip
    ffmpeg("-display_rotation", "90", "-i", str(wide), "-c", "copy", str(rotated))
    assert probe(square).video.sample_aspect == 1
    assert probe(wide).video.sample_aspect == pytest.approx(4 / 3)
    # Turned upright, the pixels turn too.
    video = probe(rotated).video
    assert (video.width, video.height, video.sample_aspect) == (180, 240, pytest.approx(3 / 4))


@pytest.mark.parametrize(("trc", "code"), [("smpte2084", 16), ("arib-std-b67", 18)])
def test_hdr_footage_reports_its_transfer_and_matrix(tmp_path, trc, code):
    out = tmp_path / "hdr.mp4"
    # Tagged on the frames: FFmpeg 7.1 and later, as on Windows and macOS, take the transfer from
    # them rather than from the output options.
    tags = f"setparams=color_primaries=bt2020:color_trc={trc}:colorspace=bt2020nc"
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=320x180:r=25:d=1", "-vf", tags, "-c:v", "libx264",
           "-pix_fmt", "yuv420p10le", str(out))  # fmt: skip
    video = probe(out).video
    assert (video.transfer, video.matrix) == (code, 9)


def test_untagged_footage_has_no_transfer_or_matrix(tmp_path):
    out = tmp_path / "plain.mp4"
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=320x180:r=25:d=1", "-c:v", "libx264", str(out))
    video = probe(out).video
    assert (video.transfer, video.matrix) == (None, None)


def test_lists_every_audio_track_and_no_video(tmp_path):
    out = tmp_path / "two.mka"
    ffmpeg("-f", "lavfi", "-i", TONE, "-f", "lavfi", "-i", "sine=d=2:sample_rate=16000",
           "-map", "0", "-map", "1", "-ac:1", "2", str(out))  # fmt: skip
    info = probe(out)
    assert info.video is None
    assert [(a.index, a.sample_rate) for a in info.audio] == [(0, 48000), (1, 16000)]
    assert info.duration == pytest.approx(2, abs=0.05)


def test_records_the_timestamp_its_time_zero_is(tmp_path):
    out = tmp_path / "late.mkv"
    ffmpeg("-f", "lavfi", "-i", TONE, "-c:a", "pcm_s16le", "-output_ts_offset", "1.5", str(out))
    assert probe(out).start == pytest.approx(1.5)


def test_audio_is_resampled_to_16k_mono(tmp_path):
    out = tmp_path / "tone.wav"
    ffmpeg("-f", "lavfi", "-i", TONE, "-ac", "2", str(out))
    samples = audio.load(out)
    assert samples.dtype == np.float32
    assert len(samples) == pytest.approx(2 * audio.RATE, abs=audio.RATE * 0.01)


def test_stereo_keeps_each_channel_in_its_own_column(tmp_path):
    out = tmp_path / "left.wav"
    ffmpeg("-f", "lavfi", "-i", "aevalsrc=0.5*sin(2*PI*440*t)|0:s=48000:d=2", str(out))
    samples = audio.load(out, rate=48_000, channels=2)
    assert samples.shape == pytest.approx((2 * 48_000, 2), abs=480)
    assert np.abs(samples[:, 0]).max() == pytest.approx(0.5, abs=0.01)
    assert np.abs(samples[:, 1]).max() < 1e-4


def test_audio_is_decoded_into_one_buffer_not_joined_from_pieces(tmp_path):
    out = tmp_path / "minute.wav"
    ffmpeg("-f", "lavfi", "-i", "sine=f=440:d=60:sample_rate=48000", str(out))
    tracemalloc.start()
    try:
        samples = audio.load(out)
        peak = tracemalloc.get_traced_memory()[1]
    finally:
        tracemalloc.stop()
    assert peak < 1.5 * samples.nbytes


def test_late_audio_keeps_its_place_on_the_timeline(tmp_path):
    out = tmp_path / "late.mov"
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=64x64:r=25:d=3", "-itsoffset", "0.5",
           "-f", "lavfi", "-i", TONE, "-map", "0", "-map", "1", "-c:v", "libx264",
           "-preset", "ultrafast", "-c:a", "pcm_s16le", str(out))  # fmt: skip
    samples = audio.load(out)
    onset = np.argmax(np.abs(samples) > 0.05) / audio.RATE
    assert onset == pytest.approx(0.5, abs=0.01)


def test_audio_a_few_ms_late_starts_exactly_where_its_timestamp_says(tmp_path):
    # The renderer places a track's first sample at its timestamp, however small the gap, and the
    # denoised speech must line up with it sample for sample.
    out = tmp_path / "late.mkv"
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=64x64:r=25:d=1", "-itsoffset", "0.012",
           "-f", "lavfi", "-i", "aevalsrc=0.5:s=48000:d=1", "-map", "0", "-map", "1",
           "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "pcm_s16le", str(out))  # fmt: skip
    samples = audio.load(out, rate=48_000)
    assert np.argmax(np.abs(samples) > 0.25) == 576


def test_cover_art_is_not_video(cover_art_audio):
    info = probe(cover_art_audio)
    assert info.video is None
    assert len(info.audio) == 1


def test_gap_in_audio_timestamps_stays_silent_on_the_timeline(tmp_path):
    first, second, out = tmp_path / "a.ts", tmp_path / "b.ts", tmp_path / "gap.ts"
    ffmpeg("-f", "lavfi", "-i", "sine=f=440:d=2:sample_rate=48000", "-c:a", "aac", str(first))
    ffmpeg("-f", "lavfi", "-i", "sine=f=440:d=2:sample_rate=48000", "-c:a", "aac",
           "-output_ts_offset", "3", str(second))  # fmt: skip
    out.write_bytes(first.read_bytes() + second.read_bytes())
    samples = audio.load(out)
    loud = np.abs(samples) > 0.05
    # The second tone starts 3 s in, after a second of silence.
    assert not loud[int(2.2 * audio.RATE) : int(2.8 * audio.RATE)].any()
    second_onset = (int(2.5 * audio.RATE) + np.argmax(loud[int(2.5 * audio.RATE) :])) / audio.RATE
    assert second_onset == pytest.approx(3.0, abs=0.05)


def test_channel_layout_change_mid_stream_is_resampled(tmp_path):
    mono, stereo, out = tmp_path / "m.ts", tmp_path / "s.ts", tmp_path / "ms.ts"
    ffmpeg("-f", "lavfi", "-i", TONE, "-ac", "1", "-c:a", "aac", str(mono))
    ffmpeg("-f", "lavfi", "-i", TONE, "-ac", "2", "-c:a", "aac", "-output_ts_offset", "2",
           str(stereo))  # fmt: skip
    out.write_bytes(mono.read_bytes() + stereo.read_bytes())
    # Each AAC segment adds its encoder padding, so allow a little over 4 s.
    assert len(audio.load(out)) == pytest.approx(4 * audio.RATE, abs=audio.RATE * 0.1)


def test_overlapping_audio_timestamps_do_not_push_later_audio_back(tmp_path):
    first, second, out = tmp_path / "a.ts", tmp_path / "b.ts", tmp_path / "overlap.ts"
    ffmpeg("-f", "lavfi", "-i", "sine=f=440:d=2:sample_rate=48000", "-c:a", "aac", str(first))
    ffmpeg("-f", "lavfi", "-i", "sine=f=440:d=2:sample_rate=48000", "-c:a", "aac",
           "-output_ts_offset", "1", str(second))  # fmt: skip
    out.write_bytes(first.read_bytes() + second.read_bytes())
    # The second part claims 1-3 s; the timeline is 3 s long, not 4.
    assert len(audio.load(out)) == pytest.approx(3 * audio.RATE, abs=audio.RATE * 0.1)


def test_audio_after_a_brief_jump_back_is_kept(tmp_path):
    parts = [("a.ts", 0, 2.0), ("b.ts", 1.0, 0.5), ("c.ts", 2.0, 1.0)]
    for name, offset, duration in parts:
        ffmpeg("-f", "lavfi", "-i", f"sine=f=440:d={duration}:sample_rate=48000", "-c:a", "aac",
               "-output_ts_offset", str(offset), str(tmp_path / name))  # fmt: skip
    out = tmp_path / "jump.ts"
    out.write_bytes(b"".join((tmp_path / name).read_bytes() for name, _, _ in parts))
    samples = audio.load(out)
    # The repeated 1.0-1.5 s part is dropped; the part from 2 s plays in full, never silenced.
    window = samples[int(2.1 * audio.RATE) : int(2.9 * audio.RATE)]
    quietest = min(np.abs(window[i : i + 160]).max() for i in range(0, len(window) - 160, 160))
    assert quietest > 0.05
    assert len(samples) == pytest.approx(3 * audio.RATE, abs=audio.RATE * 0.1)
    # A second track from the same decode drops the same audio, frames wholly covered included.
    pieces = []
    audio.load(out, tracks=[audio.Track(lambda data, names: pieces.append(data), 48_000)])
    assert all(len(p) for p in pieces)
    assert sum(map(len, pieces)) == pytest.approx(3 * 48_000, abs=4_800)


def test_the_speech_audio_of_stereo_reads_as_loud_as_both_channels(tmp_path):
    # The decoder mixes stereo down at 0.707 a channel, so the same sound in both channels
    # measures, in mono, what BS.1770 gives the two channels together: the voice is measured on
    # this mix, and the planner moves the index's loudness by that measurement.
    from vework import loudness

    out = tmp_path / "dual.wav"
    sine = "0.1*sin(2*PI*997*t)"  # -20 dB FS: -23 LUFS a channel, -20 for the two
    ffmpeg("-f", "lavfi", "-i", f"aevalsrc={sine}|{sine}:s=48000:d=4", str(out))
    mono = loudness.measure(audio.load(out))["short_term"]
    stereo = loudness.measure(audio.load(out, rate=48_000, channels=2), 48_000)["short_term"]
    assert mono == pytest.approx(stereo, abs=0.1)
    assert stereo == pytest.approx([-20.0] * 4, abs=0.1)
