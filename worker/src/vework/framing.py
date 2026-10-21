"""Faces and the active speaker in each shot: the media index's `framing`. The engine turns it
into crop paths (packages/engine/src/framing.ts)."""

import hashlib
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from itertools import count
from pathlib import Path
from statistics import median

import av
import numpy as np

from vework import gpu, ml
from vework.probe import VideoInfo, start_time, video_stream

# YuNet: small enough for OpenCV to run on a CPU in a few milliseconds per frame. Pinned by
# revision and checked by SHA-256 so an index is reproducible.
MODEL = "opencv/face_detection_yunet"
REVISION = "3cc26e7f1014a5ee5d74a42acee58bafc9d0a310"
WEIGHTS = "face_detection_yunet_2023mar.onnx"
SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"

FPS = 5.0  # samples per second: enough to see a mouth open and close within a word
# YuNet finds faces from about 10 to 300 pixels across, so frames are detected with their longer
# side this long: a portrait frame any taller makes a face held at arm's length larger than that.
ANALYSIS_SIZE = 640
MAX_FACES = 32

# Detector scores: a weaker face next to a strong one is more often a false detection than a
# second person, and a faint one more often than not. Either counts only when it is named the
# speaker for UNSURE_SPEECH seconds of the shot: a head turned aside scores lower than one facing
# the camera, so a drawn speaker turned 30 to 40 degrees scores 0.5 to 0.87 beside a listener's
# 0.9.
FAINT_FACE_SCORE = 0.5
FACE_SCORE_THRESHOLD = 0.72
STRONG_FACE_SCORE = 0.90
COMPETING_FACE_SCORE = 0.85
# More than a nod or a laugh, and as long as the engine's shortest turn (MIN_TURN in framing.ts).
UNSURE_SPEECH = 2.0
# A face counts in a shot when it is seen in this share of the shot's samples.
MIN_TRACK_PRESENCE = 0.35
MAX_TRACK_GAP = 1.0  # seconds a track may go unseen and still continue
# Faces smaller than this (share of the picture's height) in a corner are a webcam overlay.
OVERLAY_MAX_FACE_HEIGHT = 0.17
# Faces smaller than this are ignored: crowds, posters, thumbnails.
MIN_FACE_HEIGHT = 0.035

# Mouth movement is the change in the mouth from a sampled frame to the frames shown in the LATER
# seconds after it, about half a syllable. A head that moves changes the rest of the face as
# much; a mouth that speaks changes more than the eyes and nose above it.
LATER = 0.1
# Regions as shares of the face box: the mouth and jaw around the detector's mouth corners, and
# the same size around the eyes and nose.
REGION_WIDTH, REGION_HEIGHT, MOUTH_DROP, STILL_RAISE = 0.6, 0.3, 0.05, 0.1
WINDOW = 1.0  # seconds of speech judged at a time
# A face speaks in a window when its mouth changes this many times as much as its eyes and nose.
# On the synthetic corpus's drawn faces, a second of listening mostly reads 0.2 to 0.7 and a
# second of speech 0.8 to 3.
MIN_MOUTH_RATIO = 0.8
STILL_FLOOR = 0.5  # grey levels: a perfectly still face does not divide by zero


@dataclass(frozen=True)
class Box:
    x: float
    y: float
    w: float
    h: float

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2

    @property
    def area(self) -> float:
        return self.w * self.h

    def clamp(self) -> "Box":
        """Cut off at the picture's edges."""
        x0, y0 = min(max(self.x, 0.0), 1.0), min(max(self.y, 0.0), 1.0)
        x1, y1 = min(max(self.x + self.w, 0.0), 1.0), min(max(self.y + self.h, 0.0), 1.0)
        return Box(x0, y0, x1 - x0, y1 - y0)


@dataclass(frozen=True)
class Face:
    box: Box
    score: float
    # Mean grey-level change of the mouth and of the eyes and nose, to the frames in the LATER
    # seconds after; None for a sample on the picture's last frame.
    mouth: float | None = None
    still: float | None = None


@dataclass(frozen=True)
class Sample:
    t: float
    faces: list[Face]


@dataclass
class Track:
    """One person's face across the samples of a shot."""

    samples: list[tuple[float, Face]] = field(default_factory=list)

    def median_box(self) -> Box:
        boxes = [face.box for _, face in self.samples]
        return Box(*(median(getattr(b, axis) for b in boxes) for axis in ("x", "y", "w", "h")))

    def median_score(self) -> float:
        return median(face.score for _, face in self.samples)


def analyze(
    path: Path,
    video: VideoInfo,
    transitions: list[dict],
    speech: list[dict],
    progress: Callable[[str], None] = lambda message: None,
) -> dict:
    """The `framing` section of a video's media index. On a Mac, `progress` hears how the video
    was decoded."""
    detect = _detector(analysis_size(video))

    def attempt(hwaccel: av.codec.hwaccel.HWAccel | None) -> dict:
        shots: list[dict] = []
        ids = count()
        pending: list[Sample] = []
        bounds = cut_times(transitions)
        start = 0.0

        def finish(end: float) -> None:
            nonlocal pending, start
            if end > start:
                shots.append(frame_shot(pending, start, end, speech, ids))
            pending, start = [], max(start, end)

        ends: list[float] = []
        for t, image, later in sampled_frames(path, video, ends, hwaccel):
            # Shots finish as soon as their last sample is in, so memory follows the longest shot.
            while bounds and t >= bounds[0]:
                finish(bounds.pop(0))
            pending.append(Sample(t, detect(image, later)))
        picture_end = ends[0] if ends else 0.0
        for end in [*(b for b in bounds if b < picture_end), picture_end]:
            finish(end)
        return {"fps": FPS, "shots": shots}

    return gpu.decode("faces", progress, attempt)


def cut_times(transitions: list[dict]) -> list[float]:
    """Where one shot ends and the next starts: a hard cut's time, a dissolve's middle."""
    return [(t["start"] + t["end"]) / 2 for t in transitions]


def frame_shot(
    samples: list[Sample], start: float, end: float, speech: list[dict], ids: Iterator[int]
) -> dict:
    """One shot of the index: its layout, the faces that count and who speaks when. An unsure
    face that speaks too little is dropped, and who speaks judged again without it, until every
    unsure face left speaks enough."""
    seen = seen_tracks(track_faces(samples), len(samples))
    present = list(enumerate(seen))
    while True:
        spans = speakers(present, start, end, speech)
        spoken: dict[int, float] = {}
        for span in spans:
            spoken[span["face"]] = spoken.get(span["face"], 0.0) + span["end"] - span["start"]
        kept = [
            (k, track)
            for k, track in present
            if not unsure(track, seen) or spoken.get(k, 0.0) >= UNSURE_SPEECH
        ]
        if len(kept) == len(present):
            break
        present = kept
    renumbered = {k: next(ids) for k, _ in present}
    numbered = [(renumbered[k], track) for k, track in present]
    return {
        "start": round(start, 6),
        "end": round(end, 6),
        "layout": classify_shot([track for _, track in present]),
        "faces": [
            {
                "id": i,
                "boxes": [
                    {"t": round(t, 6), **{k: round(v, 4) for k, v in vars(face.box).items()}}
                    for t, face in track.samples
                ],
            }
            for i, track in numbered
        ],
        "speakers": [{**span, "face": renumbered[span["face"]]} for span in spans],
    }


def framing_faces(faces: list[Face]) -> list[Face]:
    """The confident faces of a sample: faint and weak competing detections must not displace
    them."""
    faces = [face for face in faces if face.score >= FACE_SCORE_THRESHOLD]
    if any(face.score >= STRONG_FACE_SCORE for face in faces):
        return [face for face in faces if face.score >= COMPETING_FACE_SCORE]
    return faces


def unsure(track: Track, tracks: list[Track]) -> bool:
    """A faint face, or a weak one in a shot with a confident one: a person only if they speak
    (frame_shot)."""
    score = track.median_score()
    return score < FACE_SCORE_THRESHOLD or (
        score < COMPETING_FACE_SCORE
        and any(other.median_score() >= STRONG_FACE_SCORE for other in tracks)
    )


def is_corner_overlay(box: Box) -> bool:
    """A small face in a corner of the picture: almost always a webcam overlay."""
    if box.h > OVERLAY_MAX_FACE_HEIGHT:
        return False
    return (box.cx < 0.3 or box.cx > 0.7) and (box.cy < 0.4 or box.cy > 0.6)


def track_faces(samples: list[Sample]) -> list[Track]:
    """Associate nearby faces, keeping an unambiguous subject through jumps.

    A sole confident face can move farther than the normal association radius between samples.
    Keep that track while its size stays compatible; never take that shortcut after a frame
    with several confident people or a long dropout. Weak faces beside it are tracked too, but
    only by distance.
    """
    tracks: list[Track] = []
    sole: int | None = None
    recent: list[int] = []  # tracks seen within MAX_TRACK_GAP: an hour-long shot has thousands
    for sample in samples:
        faces = sample.faces
        confident = framing_faces(faces)
        recent = [i for i in recent if sample.t - tracks[i].samples[-1][0] <= MAX_TRACK_GAP]
        used: set[int] = set()
        # The confident face first, so a weak one near it never takes its track.
        for face in sorted(faces, key=lambda f: (f not in confident, -f.box.area)):
            box, best, best_dist = face.box, None, 0.12
            if len(confident) == 1 and face is confident[0] and sole is not None:
                last_t, last = tracks[sole].samples[-1]
                # A zoom cut can exceed the usual 2x size gate; webcam overlays still need
                # their own tracks to be told apart.
                overlay = is_corner_overlay(box) or is_corner_overlay(last.box)
                ratio = box.h / max(last.box.h, 1e-6)
                if sample.t - last_t <= MAX_TRACK_GAP and 0.25 < ratio < 4.0 and not overlay:
                    best = sole
            if best is None:
                for i in sorted(recent):
                    last = tracks[i].samples[-1][1]
                    if i in used:
                        continue
                    dist = ((last.box.cx - box.cx) ** 2 + (last.box.cy - box.cy) ** 2) ** 0.5
                    if dist < best_dist and 0.5 < box.h / max(last.box.h, 1e-6) < 2.0:
                        best, best_dist = i, dist
            if best is None:
                tracks.append(Track())
                best = len(tracks) - 1
            tracks[best].samples.append((sample.t, face))
            used.add(best)
        recent += [i for i in used if i not in recent]
        if len(confident) == 1:
            sole = next(i for i in used if tracks[i].samples[-1][1] is confident[0])
        elif confident:
            sole = None
    return tracks


def seen_tracks(tracks: list[Track], shot_samples: int) -> list[Track]:
    """The face tracks seen long enough and large enough to be someone in the shot, in order of
    first appearance."""
    return [
        t
        for t in tracks
        if len(t.samples) >= max(1, MIN_TRACK_PRESENCE * shot_samples)
        and t.median_box().h >= MIN_FACE_HEIGHT
    ]


def classify_shot(present: list[Track]) -> str:
    """The layout of a shot with these face tracks in it."""
    on_camera = [t for t in present if not is_corner_overlay(t.median_box())]
    on_camera.sort(key=lambda t: -t.median_box().area)
    layout = "screen"
    if len(on_camera) > 2:
        layout = "group"
    elif len(on_camera) == 2:
        a, b = on_camera[0].median_box(), on_camera[1].median_box()
        similar = min(a.h, b.h) / max(a.h, b.h) >= 0.5
        # Side by side, however close: the engine keeps both in view when they fit.
        apart = abs(a.cx - b.cx) >= (a.w + b.w) / 2
        layout = "two_shot" if similar and apart else "talking_head"
    elif len(on_camera) == 1:
        layout = "talking_head"
    elif not on_camera and present:
        layout = "screen_cam"
    return layout


def speakers(
    tracks: list[tuple[int, Track]], start: float, end: float, speech: list[dict]
) -> list[dict]:
    """Who speaks when in a shot (worker/README.md#faces-and-speakers). A single window naming
    someone else between two of the same speaker is taken as noise."""
    spoken = [
        (max(s["start"], start), min(s["end"], end))
        for s in speech
        if s["end"] > start and s["start"] < end
    ]
    # Per face, the times and changes of the samples that have both, for lookups by time.
    moves = {}
    for i, track in tracks:
        measured = [
            (t, face.mouth, face.still)
            for t, face in track.samples
            if face.mouth is not None and face.still is not None
        ]
        moves[i] = np.array(measured).reshape(-1, 3)
    windows: list[list] = []  # [speech stretch, start, end, face or None]
    for stretch, (a, b) in enumerate(spoken):
        parts = max(1, round((b - a) / WINDOW))
        for k in range(parts):
            lo, hi = a + (b - a) * k / parts, a + (b - a) * (k + 1) / parts
            best, best_ratio = None, MIN_MOUTH_RATIO
            for i, measured in moves.items():
                first, last = np.searchsorted(measured[:, 0], [lo, hi])
                if last > first:
                    mouth, still = measured[first:last, 1:].mean(axis=0)
                    ratio = float(mouth / (still + STILL_FLOOR))
                    if ratio >= best_ratio:
                        best, best_ratio = i, ratio
            windows.append([stretch, lo, hi, best])
    for before, here, after in zip(windows, windows[1:], windows[2:], strict=False):
        if before[0] == here[0] == after[0] and before[3] is not None and before[3] == after[3]:
            here[3] = before[3]
    spans: list[dict] = []
    previous = None
    for stretch, lo, hi, face in windows:
        if face is not None and previous == (stretch, face):
            spans[-1]["end"] = round(hi, 6)
        elif face is not None:
            spans.append({"face": face, "start": round(lo, 6), "end": round(hi, 6)})
        previous = (stretch, face)
    return spans


def analysis_size(video: VideoInfo) -> tuple[int, int]:
    """The displayed picture, its pixels made square, scaled to fit YuNet's range, never
    enlarged, in even pixels."""
    width = video.width * video.sample_aspect
    scale = min(1.0, ANALYSIS_SIZE / max(width, video.height))
    return max(2, round(width * scale / 2) * 2), max(2, round(video.height * scale / 2) * 2)


def sampled_frames(
    path: Path,
    video: VideoInfo,
    ends: list[float],
    hwaccel: av.codec.hwaccel.HWAccel | None = None,
) -> Iterator[tuple[float, np.ndarray, list[np.ndarray]]]:
    """The frame on screen at every 1/FPS seconds from time zero, upright, at the analysis size,
    decoded with `hwaccel` when given.

    Yields (time, BGR image, the frames shown in the LATER seconds after it, at most three). When
    the frames run out, where the picture ends is appended to `ends`. Only the frames a sample
    still waits for are held, so memory does not grow with the source.
    """
    width, height = analysis_size(video)
    turns = video.rotation // 90
    stored = (height, width) if turns % 2 else (width, height)
    images: dict[av.VideoFrame, np.ndarray] = {}

    def picture(frame: av.VideoFrame) -> np.ndarray:
        # A slow source shows one frame for several samples; it is converted once.
        if frame not in images:
            bgr = frame.to_ndarray(width=stored[0], height=stored[1], format="bgr24")
            # The display matrix turns the stored picture counter-clockwise.
            images[frame] = np.ascontiguousarray(np.rot90(bgr, turns))
        return images[frame]

    def sample(entry: tuple[float, av.VideoFrame, float, list[av.VideoFrame]]):
        sample_t, shown, _, later = entry
        # A 60 fps source has six frames in that time: the first, middle and last are enough.
        picked = sorted({round(k * (len(later) - 1) / 2) for k in range(3)}) if later else []
        return sample_t, picture(shown), [picture(later[k]) for k in picked]

    with av.open(str(path), hwaccel=hwaccel) as container:
        zero = start_time(container)
        stream = video_stream(container)
        if stream is None:
            raise ValueError(f"{path.name}: no video stream")
        stream.thread_type = "AUTO"
        step = 1 / float(stream.average_rate or stream.guessed_rate or 25)
        tick, held, held_t = 0, None, 0.0
        # Samples waiting for the frames after them: (time, frame, its time, frames after it).
        waiting: list[tuple[float, av.VideoFrame, float, list[av.VideoFrame]]] = []
        for frame in container.decode(stream):
            # Raw elementary streams carry no timestamps; continue from the frame before.
            t = frame.time - zero if frame.time is not None else held_t + step
            # A frame shows from its time until the next one's; samples before the first frame
            # have no picture. The tolerance absorbs timestamp rounding (whole milliseconds).
            while held is not None and tick / FPS < t - 1e-3:
                waiting.append((tick / FPS, held, held_t, []))
                tick += 1
            if held is None:
                tick = max(tick, int(np.ceil((t - 1e-3) * FPS)))
            for _, _, shown_t, later in waiting:
                if t > shown_t + 1e-3:
                    later.append(frame)
            while waiting and t >= waiting[0][2] + LATER - 1e-3:
                yield sample(waiting.pop(0))
            held, held_t = frame, max(t, held_t)
            kept = {held, *(f for _, shown, _, later in waiting for f in (shown, *later))}
            for old in [f for f in images if f not in kept]:
                del images[old]
        if held is not None:
            end = held_t + step
            for entry in waiting:
                yield sample(entry)
            while tick / FPS < end - 1e-3:
                yield tick / FPS, picture(held), []
                tick += 1
            ends.append(end)


def _detector(size: tuple[int, int]) -> Callable[[np.ndarray, list[np.ndarray]], list[Face]]:
    """Load YuNet: a function from a BGR image of `size`, and the frames shown just after it, to
    the faces in the image and how much their mouths and eyes change in those frames."""
    ml.require()
    import cv2
    from huggingface_hub import hf_hub_download

    # OpenCV 5's graph engine warns about unsupported targets on every detector it creates.
    cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)
    weights = hf_hub_download(MODEL, WEIGHTS, revision=REVISION)
    if hashlib.sha256(Path(weights).read_bytes()).hexdigest() != SHA256:
        raise RuntimeError(f"{MODEL}: {weights} does not match its SHA-256; delete it to refetch")
    width, height = size
    detector = cv2.FaceDetectorYN.create(weights, "", size, FAINT_FACE_SCORE, 0.3, 50)

    def patch(image: np.ndarray, centre: tuple[float, float], size: tuple[int, int]):
        return cv2.getRectSubPix(image, size, centre)

    def changes(now, later, face, mouth, still) -> tuple[float, float]:
        """How much the mouth and the eyes and nose change, after following the head: the face's
        shift between the two frames, by phase correlation, is taken out of both."""
        (fx, fy), (rx, ry) = face
        size = (max(8, round(rx)), max(8, round(ry)))
        window = cv2.createHanningWindow(size, cv2.CV_32F)
        (dx, dy), _ = cv2.phaseCorrelate(patch(now, (fx, fy), size), patch(later, (fx, fy), size),
                                         window)  # fmt: skip

        def change(centre: tuple[float, float]) -> float:
            area = (max(2, round(rx * REGION_WIDTH)), max(2, round(ry * REGION_HEIGHT)))
            moved = patch(later, (centre[0] + dx, centre[1] + dy), area)
            return float(np.abs(moved - patch(now, centre, area)).mean())

        return change(mouth), change(still)

    def detect(image: np.ndarray, later: list[np.ndarray]) -> list[Face]:
        _, rows = detector.detect(image)
        if rows is None:
            return []
        now = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY).astype(np.float32)
        then = [cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32) for f in later]
        faces = []
        for row in sorted(rows, key=lambda r: -float(r[14]))[:MAX_FACES]:
            x, y, w, h = (float(v) for v in row[:4])
            box = Box(x / width, y / height, w / width, h / height).clamp()
            if box.w <= 0 or box.h <= 0:
                continue
            # Landmarks: eyes, nose tip, then the mouth's corners.
            mouth_at = (
                (float(row[10]) + float(row[12])) / 2,
                (float(row[11]) + float(row[13])) / 2 + MOUTH_DROP * h,
            )
            still_at = (float(row[8]), float(row[9]) - STILL_RAISE * h)
            face = ((x + w / 2, y + h / 2), (w, h))
            found = [changes(now, frame, face, mouth_at, still_at) for frame in then]
            mouth, still = np.mean(found, axis=0) if found else (None, None)
            faces.append(Face(box, float(row[14]), mouth, still))
        return faces

    return detect
