import queue
import threading
from collections.abc import Callable, Iterable, Iterator
from pathlib import Path

import av
import numpy as np

from vework import ml
from vework.probe import start_time, video_stream

THRESHOLD = 0.5
# How transnetv2-pytorch's predict_frames scores a clip: 100-frame windows that advance 50 frames
# and keep their middle 50, so every frame is judged with 25 frames of context on each side.
WINDOW, STEP, CONTEXT = 100, 50, 25


def thumbnails(
    path: Path, times: list[float], progress: Callable[[str], None] = lambda message: None
) -> Iterator[np.ndarray]:
    """Every frame as 48x27 RGB, the input TransNetV2 was trained on, one at a time.

    A two-hour 60 fps source is 1.7 GB of thumbnails, so they are never held together. Each
    frame's time is appended to `times`, which is sorted once the frames run out. Every 5 % of
    the frames the stream states, or its duration implies, is reported to `progress`.
    """
    with av.open(str(path)) as container:
        zero = start_time(container)
        stream = video_stream(container)
        if stream is None:
            raise ValueError(f"{path.name}: no video stream")
        stream.thread_type = "AUTO"
        step = 1 / float(stream.average_rate or stream.guessed_rate or 25)
        seconds = container.duration / av.time_base if container.duration else 0.0
        total = stream.frames or round(seconds / step)
        said = 0
        for frame in container.decode(stream):
            # Raw elementary streams carry no timestamps; continue from the previous frame.
            # FFmpeg rounds the start time to whole microseconds, so a first frame can come
            # out a fraction of one before zero.
            times.append(max(0.0, frame.time - zero) if frame.time is not None else
                         (times[-1] + step if times else 0.0))  # fmt: skip
            yield frame.to_ndarray(width=48, height=27, format="rgb24")
            # Never 100 %: the stated count can fall short of the frames there are.
            reached = min(len(times) * 20 // total, 19) * 5 if total else 0
            if reached > said:
                said = reached
                progress(f"detecting shots {reached}%")
    # Frames come out in display order, but some containers (AVI with B-frames) label them
    # with timestamps in decode order; sorting restores which time belongs to which frame.
    times.sort()


def windows(frames: Iterable[np.ndarray]) -> Iterator[tuple[np.ndarray, int]]:
    """The windows predict_frames cuts from a whole clip, built from a stream of frames.

    Like predict_frames, the first frame stands in for the context before the clip and the last
    for the context after it, but only one window is held instead of a padded copy of the clip.
    Yields each window with how many of the frames it scores are real.
    """
    window: list[np.ndarray] = []
    count = scored = 0
    for frame in frames:
        if not count:
            window = [frame] * CONTEXT
        window.append(frame)
        count += 1
        if len(window) == WINDOW:
            yield np.stack(window), STEP
            window = window[STEP:]
            scored += STEP
    while scored < count:
        window += [window[-1]] * (WINDOW - len(window))
        yield np.stack(window), min(STEP, count - scored)
        window = window[STEP:]
        scored += STEP


def ahead(frames: Iterable[np.ndarray], size: int = 2 * WINDOW) -> Iterator[np.ndarray]:
    """`frames`, decoded in a thread of their own up to `size` ahead, so decoding overlaps the
    model. An error decoding is raised here."""
    held: queue.Queue = queue.Queue(size)
    stop = threading.Event()
    end = object()

    def put(item: object) -> bool:
        """Waits for room, unless the reader has stopped."""
        while not stop.is_set():
            try:
                held.put(item, timeout=0.1)
                return True
            except queue.Full:
                pass
        return False

    def decode() -> None:
        try:
            for frame in frames:
                if not put(frame):
                    return
            put(end)
        except Exception as exc:  # handed to the reading thread
            put(exc)

    thread = threading.Thread(target=decode, daemon=True)
    thread.start()
    try:
        while (item := held.get()) is not end:
            if isinstance(item, Exception):
                raise item
            yield item
    finally:
        stop.set()
        thread.join()


def predict(frames: Iterable[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """Per-frame probabilities: a transition's center, and any frame inside a transition."""
    ml.require()
    import torch
    from transnetv2_pytorch import TransNetV2

    model = TransNetV2(device="cpu" if not torch.cuda.is_available() else "cuda")
    center, inside = [], []
    # Real footage drives the network's activations into subnormal floats, which a CPU handles
    # several times slower; flushing them to zero leaves the scores the same (MEASUREMENTS.md).
    torch.set_flush_denormal(True)
    try:
        with torch.no_grad():
            for window, scored in windows(ahead(frames)):
                one, many = model.predict_raw(torch.from_numpy(window)[None].to(model.device))
                center.append(one[0, CONTEXT : CONTEXT + scored, 0].cpu().numpy())
                inside.append(many[0, CONTEXT : CONTEXT + scored, 0].cpu().numpy())
    finally:
        torch.set_flush_denormal(False)
    return np.concatenate(center), np.concatenate(inside)


def transitions(
    center: np.ndarray, inside: np.ndarray, times: np.ndarray, threshold: float = THRESHOLD
) -> list[dict]:
    """Turn frame probabilities into transitions spanning [start, end] seconds.

    A run of center-probability frames marks one transition. It is widened to the
    surrounding frames the model places inside a transition, so a dissolve covers its whole
    span. A hard cut collapses to the time of the first frame of the new shot.
    """
    step = float(np.median(np.diff(times))) if len(times) > 1 else 0.0
    hits = center > threshold
    result = []
    i = 0
    while i < len(hits):
        if not hits[i]:
            i += 1
            continue
        j = i
        while j + 1 < len(hits) and hits[j + 1]:
            j += 1
        lo, hi = i, j
        while lo > 0 and inside[lo - 1] > threshold:
            lo -= 1
        while hi + 1 < len(inside) and inside[hi + 1] > threshold:
            hi += 1
        if hi - lo <= 1:
            # The model flags the last frame of the old shot, so the new shot starts on the
            # next frame; a flag on the final frame has no new shot after it.
            if j + 1 < len(times):
                cut = float(times[j + 1])
                result.append({"start": cut, "end": cut})
        else:
            result.append({"start": float(times[lo]), "end": float(times[hi]) + step})
        # Center peaks that dip inside one dissolve belong to the span just emitted.
        i = max(j, hi) + 1
    return result


def detect(path: Path, progress: Callable[[str], None] = lambda message: None) -> list[dict]:
    """Shot transitions in a video file, in seconds from its time zero, reporting how far it is
    to `progress`."""
    times: list[float] = []
    center, inside = predict(thumbnails(path, times, progress))
    return transitions(center, inside, np.array(times))
