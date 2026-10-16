import subprocess
from itertools import count

import imageio_ffmpeg
import numpy as np
import pytest
from conftest import ffmpeg

from vework import framing, probe
from vework.framing import Box, Face, Sample


def face(cx: float, cy: float = 0.4, h: float = 0.2, score: float = 0.9, **motion) -> Face:
    return Face(Box(cx - h / 4, cy - h / 2, h / 2, h), score, **motion)


def test_shots_end_at_a_hard_cut_and_in_the_middle_of_a_dissolve():
    transitions = [{"start": 3.0, "end": 3.0}, {"start": 8.0, "end": 9.0}]
    assert framing.cut_times(transitions) == [3.0, 8.5]


def test_tracks_follow_each_face_through_jitter_and_short_gaps():
    rng = np.random.default_rng(0)
    samples = []
    for k in range(20):
        faces = [face(0.25 + rng.normal(0, 0.005)), face(0.75 + rng.normal(0, 0.005))]
        if k in (5, 6):  # the detector misses the right face twice
            faces = faces[:1]
        samples.append(Sample(k / 5, faces))
    tracks = framing.track_faces(samples)
    assert [len(t.samples) for t in tracks] == [20, 18]
    assert [round(t.median_box().cx, 1) for t in tracks] == [0.2, 0.8]


def test_a_sole_face_that_jumps_stays_one_track_but_two_people_do_not_merge():
    jump = [Sample(0.0, [face(0.2)]), Sample(0.2, [face(0.6)]), Sample(0.4, [face(0.62)])]
    assert len(framing.track_faces(jump)) == 1
    pair = [Sample(0.0, [face(0.2), face(0.6)]), Sample(0.2, [face(0.6)])]
    assert len(framing.track_faces(pair)) == 2


def test_a_weak_detection_next_to_a_confident_face_is_not_confident():
    faces = [face(0.3, score=0.95), face(0.7, score=0.8)]
    assert framing.framing_faces(faces) == faces[:1]
    weak = [face(0.3, score=0.8), face(0.7, score=0.78)]
    assert framing.framing_faces(weak) == weak


def test_a_weak_face_beside_a_sole_confident_one_does_not_stop_it_jumping():
    jump = [Sample(t, [face(cx, score=0.95), face(0.9, score=0.8)])
            for t, cx in ((0.0, 0.2), (0.2, 0.6), (0.4, 0.62))]  # fmt: skip
    assert [len(t.samples) for t in framing.track_faces(jump)] == [3, 3]


def unsure_shot(faces, moving_until: float = 0.0, length: float = 4.0) -> dict:
    """A shot of `faces` (score, centre) with speech from 1 s to 3 s; the last face's mouth
    moves from 1 s until `moving_until`, the others' never."""
    samples = []
    for k in range(int(length * 5)):
        t = k / 5
        found = []
        for i, (score, cx) in enumerate(faces):
            moving = i == len(faces) - 1 and 1.0 <= t < moving_until
            found.append(face(cx, score=score, mouth=6.0 if moving else 1.0, still=1.0))
        samples.append(Sample(t, found))
    return framing.frame_shot(samples, 0.0, length, [{"start": 1.0, "end": 3.0}], count())


def test_a_weak_face_beside_a_confident_one_counts_only_when_it_speaks():
    silent = unsure_shot([(0.95, 0.3), (0.8, 0.7)])
    assert (silent["layout"], len(silent["faces"]), silent["speakers"]) == ("talking_head", 1, [])
    talking = unsure_shot([(0.95, 0.3), (0.8, 0.7)], moving_until=3.0)
    assert (talking["layout"], [f["id"] for f in talking["faces"]]) == ("two_shot", [0, 1])
    assert talking["speakers"] == [{"face": 1, "start": 1.0, "end": 3.0}]


def test_a_faint_face_counts_only_when_it_speaks_for_long_enough():
    assert unsure_shot([(0.6, 0.5)])["faces"] == []
    # A second of moving mouth is a nod or a laugh, not a speaker.
    brief = unsure_shot([(0.95, 0.3), (0.6, 0.7)], moving_until=2.0)
    assert (brief["layout"], len(brief["faces"]), brief["speakers"]) == ("talking_head", 1, [])
    alone = unsure_shot([(0.6, 0.5)], moving_until=3.0)
    assert alone["layout"] == "talking_head"
    assert alone["speakers"] == [{"face": 0, "start": 1.0, "end": 3.0}]


def test_a_sole_confident_face_jumps_past_faint_ones():
    jump = [Sample(t, [face(cx, score=0.8), face(0.9, score=0.6)])
            for t, cx in ((0.0, 0.2), (0.2, 0.6), (0.4, 0.62))]  # fmt: skip
    assert [len(t.samples) for t in framing.track_faces(jump)] == [3, 3]


@pytest.mark.parametrize(
    ("people", "layout", "count"),
    [
        ([face(0.5)], "talking_head", 1),
        ([face(0.3), face(0.7)], "two_shot", 2),
        # Two people standing close together are still two people.
        ([face(0.4), face(0.55)], "two_shot", 2),
        # A second face much smaller than the first: still one person to frame.
        ([face(0.3, h=0.3), face(0.7, h=0.1)], "talking_head", 2),
        ([face(0.9, cy=0.85, h=0.1)], "screen_cam", 1),
        ([face(0.2), face(0.5), face(0.8)], "group", 3),
        # A webcam in a corner does not make a third person.
        ([face(0.3), face(0.7), face(0.9, cy=0.85, h=0.1)], "two_shot", 3),
        ([], "screen", 0),
    ],
)
def test_shot_layouts(people, layout, count):
    samples = [Sample(k / 5, people) for k in range(10)]
    present = framing.seen_tracks(framing.track_faces(samples), len(samples))
    assert (framing.classify_shot(present), len(present)) == (layout, count)


def test_a_face_seen_in_too_little_of_the_shot_does_not_count():
    samples = [Sample(k / 5, [face(0.3)] + ([face(0.7)] if k < 2 else [])) for k in range(10)]
    present = framing.seen_tracks(framing.track_faces(samples), len(samples))
    assert (framing.classify_shot(present), len(present)) == ("talking_head", 1)


def conversation(moving: dict[int, list[tuple[float, float]]], length: float = 8.0):
    """Two faces sampled five times a second; face i's mouth moves in each of moving[i]'s spans,
    while both faces' eyes and noses change a little, as video noise does."""
    rng = np.random.default_rng(1)
    samples = []
    for k in range(int(length * 5)):
        t = k / 5
        faces = []
        for i, cx in enumerate((0.25, 0.75)):
            talking = any(a <= t < b for a, b in moving.get(i, []))
            mouth = rng.uniform(4, 9) if talking else rng.uniform(0.5, 1.5)
            faces.append(face(cx, mouth=mouth, still=rng.uniform(1, 2)))
        samples.append(Sample(t, faces))
    tracks = framing.track_faces(samples)
    return [(10 + i, track) for i, track in enumerate(tracks)]


def test_the_speaker_is_the_face_whose_mouth_moves_during_speech():
    tracks = conversation({0: [(0.5, 3.0), (6.0, 7.5)], 1: [(3.5, 5.5)]})
    speech = [{"start": 0.5, "end": 3.0}, {"start": 3.5, "end": 5.5}, {"start": 6.0, "end": 7.5}]
    assert framing.speakers(tracks, 0.0, 8.0, speech) == [
        {"face": 10, "start": 0.5, "end": 3.0},
        {"face": 11, "start": 3.5, "end": 5.5},
        {"face": 10, "start": 6.0, "end": 7.5},
    ]


def test_speech_turns_inside_one_stretch_of_speech_are_split_by_mouth():
    tracks = conversation({0: [(1.0, 4.0)], 1: [(4.0, 7.0)]})
    found = framing.speakers(tracks, 0.0, 8.0, [{"start": 1.0, "end": 7.0}])
    assert [(s["face"], s["start"], s["end"]) for s in found] == [(10, 1.0, 4.0), (11, 4.0, 7.0)]


def test_a_voice_over_names_no_one_and_speech_is_cut_at_the_shot():
    tracks = conversation({})
    assert framing.speakers(tracks, 0.0, 8.0, [{"start": 1.0, "end": 5.0}]) == []
    tracks = conversation({1: [(0.0, 8.0)]})
    found = framing.speakers(tracks, 2.0, 4.0, [{"start": 1.0, "end": 5.0}])
    assert found == [{"face": 11, "start": 2.0, "end": 4.0}]


def test_a_single_second_naming_someone_else_inside_a_turn_is_noise():
    tracks = conversation({0: [(0.0, 3.0), (4.0, 6.0)], 1: [(3.0, 4.0)]})
    found = framing.speakers(tracks, 0.0, 8.0, [{"start": 0.0, "end": 6.0}])
    assert found == [{"face": 10, "start": 0.0, "end": 6.0}]


@pytest.fixture
def numbered_video(tmp_path):
    """10 fps, 2 s: frame k is grey level 10 k, from the top, over a white bottom row."""
    out = tmp_path / "numbered.mp4"
    ffmpeg("-f", "lavfi", "-i", "nullsrc=s=64x48:r=10:d=2,format=gray",
           "-vf", "geq=lum='if(gt(Y,40),255,10*N)'", "-c:v", "libx264", "-qp", "0",
           "-pix_fmt", "yuv444p", str(out))  # fmt: skip
    return out


def test_each_sample_is_the_frame_on_screen_compared_with_those_after_it(numbered_video):
    video = probe.probe(numbered_video).video
    ends = []
    found = list(framing.sampled_frames(numbered_video, video, ends))
    assert [t for t, *_ in found] == pytest.approx([k / 5 for k in range(10)])
    for k, (_, image, later) in enumerate(found):
        assert int(image[0, 0, 0]) == pytest.approx(20 * k, abs=2)
        # At 10 fps, the one frame 0.1 s on.
        assert [int(frame[0, 0, 0]) for frame in later] == [pytest.approx(20 * k + 10, abs=2)]
    # The last frame starts at 1.9 s and shows for one frame.
    assert ends == pytest.approx([2.0])


def test_a_fast_source_is_compared_with_three_of_the_frames_after_each_sample(tmp_path):
    out = tmp_path / "fast.mp4"
    ffmpeg("-f", "lavfi", "-i", "nullsrc=s=64x48:r=60:d=1,format=gray",
           "-vf", "geq=lum='2*N'", "-c:v", "libx264", "-qp", "0", "-pix_fmt", "yuv444p",
           str(out))  # fmt: skip
    _, image, later = next(framing.sampled_frames(out, probe.probe(out).video, []))
    # Frames 1 to 6 follow within 0.1 s: the first, middle and last are kept.
    assert [round(int(f[0, 0, 0]) / 2) for f in [image, *later]] == [0, 1, 3, 6]


def test_frames_are_sampled_upright(numbered_video, tmp_path):
    turned = tmp_path / "turned.mp4"
    ffmpeg("-display_rotation", "90", "-i", str(numbered_video), "-c", "copy", str(turned))
    video = probe.probe(turned).video
    assert (video.width, video.height, video.rotation) == (48, 64, 90)
    _, image, _ = next(framing.sampled_frames(turned, video, []))
    assert image.shape == (64, 48, 3)
    # Turned a quarter counter-clockwise, the stored picture's white bottom row is on the right.
    assert image[:, -4:].mean() > 200 and image[:, :20].mean() < 50


def test_frames_of_anamorphic_footage_are_sampled_in_its_displayed_shape(tmp_path):
    # 16:9 stored in 48 x 36 with 4:3 pixels: faces in it are drawn a quarter narrower.
    out = tmp_path / "hdv.mp4"
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=48x36:r=5:d=1", "-vf", "setsar=4/3",
           "-c:v", "libx264", str(out))  # fmt: skip
    _, image, _ = next(framing.sampled_frames(out, probe.probe(out).video, []))
    assert image.shape == (36, 64, 3)


def test_a_sample_on_the_last_frame_has_nothing_to_compare_with(tmp_path):
    out = tmp_path / "five.mp4"
    ffmpeg("-f", "lavfi", "-i", "testsrc2=s=64x48:r=5:d=1", "-c:v", "libx264", str(out))
    found = list(framing.sampled_frames(out, probe.probe(out).video, []))
    assert [len(later) for *_, later in found] == [1, 1, 1, 1, 0]


def test_samples_start_with_the_first_frame_of_a_late_picture(numbered_video, tmp_path):
    # Sound from time zero, the picture from 0.5 s.
    late = tmp_path / "late.ts"
    ffmpeg("-f", "lavfi", "-i", "anullsrc=d=2.5", "-itsoffset", "0.5", "-i", str(numbered_video),
           "-map", "0:a", "-map", "1:v", "-c:v", "copy", "-c:a", "mp2", str(late))  # fmt: skip
    times = [t for t, *_ in framing.sampled_frames(late, probe.probe(late).video, [])]
    assert times[0] == pytest.approx(0.6) and times[-1] == pytest.approx(2.4)


def draw_people(path, talk, seconds=6.0, fps=25, size=(640, 360), head=0.08, turn=(0.0, 0.0)):
    """Two drawn people at a desk whose mouths open and close at random while they talk: faces
    YuNet finds, with eyes, brows, a nose and a shaded edge. `talk` lists each one's spans,
    `head` their heads' radius as a share of the picture's height and `turn` how far each head
    is turned to the viewer's right, in degrees: its eyes, nose and mouth slide across it, the
    far eye narrows and hair covers the back of the head."""
    import cv2

    width, height = size
    rng = np.random.default_rng(3)
    args = [imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-y", "-f", "rawvideo",
            "-pix_fmt", "bgr24", "-s", f"{width}x{height}", "-r", str(fps), "-i", "pipe:0",
            "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", str(path)]  # fmt: skip
    encoder = subprocess.Popen(args, stdin=subprocess.PIPE)
    openness = [0.0, 0.0]
    for k in range(int(seconds * fps)):
        t = k / fps
        frame = np.full((height, width, 3), (170, 150, 140), np.uint8)
        for i, x in enumerate((0.3 * width, 0.7 * width)):
            if k % 3 == 0:  # syllables of uneven length
                speaking = any(a <= t < b for a, b in talk[i])
                openness[i] = rng.uniform(0, 1) if speaking else 0.0
            y, r = 0.42 * height, head * height
            cv2.rectangle(frame, (int(x - 2.2 * r), int(y + 1.1 * r)),
                          (int(x + 2.2 * r), height), (140, 90, 60), -1)  # fmt: skip
            yaw = np.radians(turn[i])

            # Where a point on the head's surface, `angle` from its front, is seen across it.
            def across(angle, x=x, r=r, yaw=yaw):
                return x + r * np.sin(angle + yaw)

            cv2.ellipse(frame, (int(x - 0.25 * r * np.sin(yaw)), int(y - 0.3 * r)),
                        (int(1.05 * r), int(0.9 * r)), 0, 0, 360, (40, 50, 70), -1)  # fmt: skip
            cv2.ellipse(frame, (int(x), int(y)), (int(r), int(r)), 0, 0, 360, (90, 120, 170), -1)
            cv2.ellipse(frame, (int(x + 0.07 * r * np.sin(yaw)), int(y)),
                        (int(0.86 * r), int(0.88 * r)), 0, 0, 360, (120, 160, 215), -1)  # fmt: skip
            if abs(np.sin(yaw)) > 0.2:  # hair over the back of the head
                cv2.ellipse(frame, (int(x - np.sign(yaw) * 0.55 * r), int(y - 0.1 * r)),
                            (int(0.5 * r * abs(np.sin(yaw))), int(0.85 * r)),
                            0, 0, 360, (40, 50, 70), -1)  # fmt: skip
            for side in (-1, 1):
                eye = side * np.arcsin(0.38)
                facing = np.cos(eye + yaw) / np.cos(eye)  # how squarely the eye is seen
                ex, ey = int(across(eye)), int(y - 0.1 * r)
                cv2.ellipse(frame, (ex, ey), (max(1, int(0.19 * r * facing)), int(0.09 * r)),
                            0, 0, 360, (245, 245, 245), -1)  # fmt: skip
                cv2.circle(frame, (int(ex + 0.03 * r * np.sin(yaw)), ey),
                           max(1, int(0.08 * r * facing)), (35, 30, 30), -1)  # fmt: skip
                brow = ((int(ex - 0.21 * r * facing), int(ey - 0.24 * r)),
                        (int(ex + 0.19 * r * facing), int(ey - 0.28 * r)))  # fmt: skip
                cv2.line(frame, *brow, (30, 30, 50), 2)
            nx, tip, wide = across(0.0), across(0.0) + 0.25 * r * np.sin(yaw), np.cos(yaw)
            nose = np.array([[nx, y], [tip - 0.11 * r * wide, y + 0.3 * r],
                             [tip + 0.11 * r * wide, y + 0.3 * r]])  # fmt: skip
            cv2.fillPoly(frame, [nose.astype(np.int32)], (90, 120, 170))
            mouth = (max(1, int(0.3 * r * max(wide, 0.35))),
                     max(1, int((0.04 + 0.25 * openness[i]) * r)))  # fmt: skip
            cv2.ellipse(frame, (int(nx + 0.05 * r * np.sin(yaw)), int(y + 0.5 * r)), mouth,
                        0, 0, 360, (40, 30, 90), -1)  # fmt: skip
        encoder.stdin.write(frame.tobytes())
    encoder.stdin.close()
    assert encoder.wait() == 0


@pytest.mark.ml
def test_finds_two_people_and_who_of_them_speaks(tmp_path):
    path = tmp_path / "two.mp4"
    draw_people(path, [[(0.4, 2.6)], [(3.4, 5.6)]])
    info = probe.probe(path)
    speech = [{"start": 0.4, "end": 2.6}, {"start": 3.4, "end": 5.6}]
    found = framing.analyze(path, info.video, [], speech)
    assert found["fps"] == 5
    (shot,) = found["shots"]
    assert (shot["start"], shot["end"], shot["layout"]) == (0.0, 6.0, "two_shot")
    left, right = sorted(shot["faces"], key=lambda f: f["boxes"][0]["x"])
    assert len(left["boxes"]) >= 25 and len(right["boxes"]) >= 25
    assert left["boxes"][0]["x"] == pytest.approx(0.3 - 0.08 * 360 / 640, abs=0.03)
    assert [(s["face"], s["start"], s["end"]) for s in shot["speakers"]] == [
        (left["id"], 0.4, 2.6),
        (right["id"], 3.4, 5.6),
    ]


@pytest.mark.ml
@pytest.mark.parametrize(
    ("size", "turn"), [((640, 360), 30.0), ((640, 360), 40.0), ((1280, 720), 35.0)]
)
def test_a_speaker_turned_aside_is_named_over_a_listener_facing_the_camera(tmp_path, size, turn):
    # YuNet scores the listener facing it 0.90, and the speaker turned aside 0.5 to 0.87: 0.74 to
    # 0.87 turned 30 degrees, 0.5 to 0.8 turned 40 and 0.5 to 0.7 drawn larger turned 35.
    path = tmp_path / "turned.mp4"
    draw_people(path, [[(0.4, 5.6)], []], size=size, head=0.11, turn=(turn, 0.0))
    found = framing.analyze(path, probe.probe(path).video, [], [{"start": 0.4, "end": 5.6}])
    (shot,) = found["shots"]
    assert shot["layout"] == "two_shot"
    speaker, listener = sorted(shot["faces"], key=lambda f: f["boxes"][0]["x"])
    assert [(s["face"], s["start"], s["end"]) for s in shot["speakers"]] == [
        (speaker["id"], 0.4, 5.6)
    ]


@pytest.mark.ml
def test_shots_split_at_transitions_and_number_their_faces_apart(tmp_path):
    path = tmp_path / "two.mp4"
    draw_people(path, [[], []], seconds=4.0)
    found = framing.analyze(path, probe.probe(path).video, [{"start": 2.0, "end": 2.0}], [])
    assert [(s["start"], s["end"], s["layout"]) for s in found["shots"]] == [
        (0.0, 2.0, "two_shot"),
        (2.0, 4.0, "two_shot"),
    ]
    ids = [f["id"] for s in found["shots"] for f in s["faces"]]
    assert sorted(ids) == [0, 1, 2, 3]
    assert all(s["speakers"] == [] for s in found["shots"])
