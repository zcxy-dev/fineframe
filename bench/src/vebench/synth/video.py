"""Pictures for the synthetic corpus, encoded with the clip's audio.

Talking heads are drawn figures in a drawn room, seen through cameras that crop the same set,
so angle changes look like multicam rather than unrelated test patterns. A face detector finds
their faces, and each mouth opens with its own speaker's voice. Screens are drawn UI with typing,
scrolling and a moving pointer.
"""

import math
import subprocess
import tempfile
import zlib
from functools import cache
from pathlib import Path

import imageio_ffmpeg
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from vebench.synth.layout import RATE, Layout
from vebench.synth.script import Clip

LANDSCAPE = (1280, 720)
MOUTH_LEVELS = 6


def render(clip: Clip, layout: Layout, path: Path, seed: int) -> None:
    """Draw every frame of the clip's shot plan and encode it with the mixed audio to `path`."""
    rng = np.random.default_rng([seed, zlib.crc32(clip.name.encode()), 1])
    width, height = (LANDSCAPE[1], LANDSCAPE[0]) if clip.portrait else LANDSCAPE
    count = math.ceil(layout.duration * clip.fps)
    activity = {s: _activity(t, clip.fps, count) for s, t in layout.tracks.items()}
    scene = (Street if clip.portrait else Room)(rng, clip, (width, height))
    views: dict = {}

    def picture(shot: dict, k: int) -> np.ndarray:
        key = (shot["view"], tuple(shot["text"]))
        if key not in views:
            if shot["view"] in scene.views:
                views[key] = scene.camera(shot["view"], rng)
            else:
                views[key] = Screen(shot["view"], shot["text"], rng, (width, height))
        local = max(0.0, (k - shot["frame"]) / clip.fps)
        return views[key].frame(k / clip.fps, local, {s: a[k] for s, a in activity.items()})

    with tempfile.TemporaryDirectory() as tmp:
        sound = Path(tmp) / "audio.f32"
        _mix(layout.tracks, rng).tofile(sound)
        encoded = Path(tmp) / "plain.mp4" if clip.portrait else path
        stored = (height, width) if clip.portrait else (width, height)
        args = [
            "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{stored[0]}x{stored[1]}",
            "-r", str(clip.fps), "-i", "pipe:0",
            "-f", "f32le", "-ar", str(RATE), "-ac", "1", "-i", str(sound),
            "-map", "0:v", "-map", "1:a",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
            "-g", str(2 * clip.fps), "-threads", "4",
            "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2", str(encoded),
        ]  # fmt: skip
        ffmpeg = subprocess.Popen(_ffmpeg(*args), stdin=subprocess.PIPE)
        try:
            shot = 0
            for k in range(count):
                while shot + 1 < len(layout.shots) and layout.shots[shot + 1]["frame"] <= k:
                    shot += 1
                current = layout.shots[shot]
                frame = picture(current, k)
                into = k - current["frame"]
                if shot and into < current["dissolve"]:
                    alpha = (into + 1) / (current["dissolve"] + 1)
                    before = picture(layout.shots[shot - 1], k).astype(np.float32)
                    frame = (before + alpha * (frame - before)).astype(np.uint8)
                if clip.portrait:
                    # Phones store portrait video sideways plus a display rotation.
                    frame = np.rot90(frame, -1)
                ffmpeg.stdin.write(np.ascontiguousarray(frame).tobytes())
        finally:
            ffmpeg.stdin.close()
            if ffmpeg.wait():
                raise RuntimeError(f"{path}: ffmpeg failed")
        if clip.portrait:
            subprocess.run(
                _ffmpeg("-display_rotation", "90", "-i", str(encoded), "-c", "copy", str(path)),
                check=True,
            )


def _ffmpeg(*args: str) -> list[str]:
    return [imageio_ffmpeg.get_ffmpeg_exe(), "-v", "error", "-y", "-nostdin", *args]


def _activity(track: np.ndarray, fps: int, count: int) -> np.ndarray:
    """How open each frame's mouth is, 0 to 1, from the speaker's loudness around that frame."""
    hop = RATE // fps
    padded = np.zeros(count * hop, np.float32)
    padded[: min(len(track), len(padded))] = track[: len(padded)]
    rms = np.sqrt((padded.reshape(count, hop) ** 2).mean(axis=1))
    loud = np.percentile(rms[rms > 1e-4], 95) if (rms > 1e-4).any() else 1.0
    return np.clip(rms / loud, 0, 1)


def _mix(tracks: dict[str, np.ndarray], rng: np.random.Generator) -> np.ndarray:
    """Speakers at different mic levels over a room's noise floor, as a recording has."""
    mixed = np.zeros_like(next(iter(tracks.values())))
    for gain_db, track in zip((-20, -23), tracks.values(), strict=False):
        voiced = np.abs(track) > 1e-3
        rms = np.sqrt(np.mean(track[voiced] ** 2)) if voiced.any() else 1.0
        mixed += track * (10 ** (gain_db / 20) / rms)
    # Room tone falls off above a few hundred hertz: a rumble, not a hiss.
    spectrum = np.fft.rfft(rng.standard_normal(len(mixed)))
    spectrum /= 1 + np.fft.rfftfreq(len(mixed), 1 / RATE) / 300
    noise = np.fft.irfft(spectrum, len(mixed))
    mixed += noise * (10 ** (-58 / 20) / np.sqrt(np.mean(noise**2)))
    return (mixed * min(1.0, 0.95 / np.abs(mixed).max())).astype(np.float32)


def _label(text: str, size: tuple[int, int], fill, font: int) -> np.ndarray:
    image = Image.new("RGB", size, fill)
    ImageDraw.Draw(image).text(
        (16, (size[1] - font) / 2 - 2), text, font=_font(font), fill=(255, 255, 255)
    )
    return np.asarray(image)


@cache
def _font(size: int) -> ImageFont.FreeTypeFont:
    # Pillow's built-in font: the same glyphs on every machine, no system font needed.
    return ImageFont.load_default(size)


def _gradient(width: int, height: int, top, bottom) -> np.ndarray:
    ramp = np.linspace(0, 1, height, dtype=np.float32)[:, None, None]
    colors = np.array(top, np.float32) + ramp * (np.array(bottom, np.float32) - top)
    return np.broadcast_to(colors, (height, width, 3)).astype(np.uint8)


def _color(rng: np.random.Generator, low: int = 40, high: int = 220) -> tuple[int, int, int]:
    return tuple(int(c) for c in rng.integers(low, high, 3))


def _ellipses(width: float) -> list[np.ndarray]:
    """Boolean mouth shapes, closed to wide open."""
    shapes = []
    for level in range(MOUTH_LEVELS):
        h = max(2.0, width * (0.08 + 0.4 * level / (MOUTH_LEVELS - 1)))
        ys, xs = np.ogrid[-h / 2 : h / 2 : 1, -width / 2 : width / 2 : 1]
        shapes.append((xs / (width / 2)) ** 2 + (ys / (h / 2)) ** 2 <= 1)
    return shapes


def _stamp(frame: np.ndarray, mask: np.ndarray, cx: float, cy: float, color) -> None:
    solid = np.broadcast_to(np.array(color, np.uint8), (*mask.shape, 3))
    _paste(frame, solid, mask, round(cx - mask.shape[1] / 2), round(cy - mask.shape[0] / 2))


def _paste(frame: np.ndarray, image: np.ndarray, mask: np.ndarray, x0: int, y0: int) -> None:
    """Copy the masked pixels of `image` onto `frame` at (x0, y0), clipped to the frame."""
    h, w = mask.shape
    fx0, fy0 = max(x0, 0), max(y0, 0)
    fx1, fy1 = min(x0 + w, frame.shape[1]), min(y0 + h, frame.shape[0])
    if fx0 < fx1 and fy0 < fy1:
        part = mask[fy0 - y0 : fy1 - y0, fx0 - x0 : fx1 - x0, None]
        source = image[fy0 - y0 : fy1 - y0, fx0 - x0 : fx1 - x0]
        np.copyto(frame[fy0:fy1, fx0:fx1], source, where=part)


def _figure(draw: ImageDraw.ImageDraw, x: float, head_y: float, r: float, rng) -> None:
    """A drawn presenter: hair, a shaded head with eyes, brows and a nose, and shoulders.

    YuNet finds the face from its eye whites, brows and nose, and in close-ups from the
    shading at its edge. Their colours are derived from the hair and skin instead of drawn from
    `rng`, so a seed's other random draws, and the rest of its corpus, do not depend on them.
    """
    shirt, hair = _color(rng), _color(rng, 10, 90)
    skin = tuple(int(c) for c in rng.integers((170, 120, 90), (240, 190, 160)))
    shade = tuple(round(0.82 * c) for c in skin)
    draw.rounded_rectangle((x - 2.4 * r, head_y + 1.1 * r, x + 2.4 * r, head_y + 4.5 * r),
                           radius=r, fill=shirt)  # fmt: skip
    draw.rectangle((x - 0.35 * r, head_y + 0.8 * r, x + 0.35 * r, head_y + 1.3 * r), fill=skin)
    draw.ellipse((x - 1.05 * r, head_y - 1.15 * r, x + 1.05 * r, head_y + 0.6 * r), fill=hair)
    draw.ellipse((x - r, head_y - r, x + r, head_y + r), fill=shade)
    draw.ellipse((x - 0.86 * r, head_y - 0.9 * r, x + 0.86 * r, head_y + 0.84 * r), fill=skin)
    brow = tuple(round(0.6 * c) for c in hair)
    for side in (-1, 1):
        ex, ey = x + side * 0.38 * r, head_y - 0.1 * r
        draw.ellipse((ex - 0.19 * r, ey - 0.09 * r, ex + 0.19 * r, ey + 0.09 * r),
                     fill=(245, 245, 245))  # fmt: skip
        draw.ellipse(
            (ex - 0.08 * r, ey - 0.08 * r, ex + 0.08 * r, ey + 0.08 * r), fill=(30, 30, 35)
        )
        draw.line((ex - 0.21 * r, ey - 0.24 * r, ex + 0.19 * r, ey - 0.28 * r),
                  fill=brow, width=max(2, round(0.07 * r)))  # fmt: skip
    draw.polygon([(x, head_y), (x - 0.11 * r, head_y + 0.3 * r), (x + 0.11 * r, head_y + 0.3 * r)],
                 fill=shade)  # fmt: skip


class Camera:
    """A fixed crop of a pre-scaled set that drifts slowly, with a mouth drawn per speaker."""

    def __init__(self, world, box, mouths, size, grade, rng):
        width, height = size
        x0, y0, cw = box
        scale = width / cw
        margin = 0.03 * cw
        ch = cw * height / width
        # Keep the crop and its drift inside the set.
        x0 = min(max(x0 - margin, 0), world.width - cw - 2 * margin)
        y0 = min(max(y0 - margin, 0), world.height - ch - 2 * margin)
        region = (x0, y0, x0 + cw + 2 * margin, y0 + ch + 2 * margin)
        out = (round(width + 2 * margin * scale), round(height + 2 * margin * scale))
        scaled = np.asarray(world.resize(out, Image.BILINEAR, box=region), np.float32)
        self.image = np.clip(scaled * np.array(grade, np.float32), 0, 255).astype(np.uint8)
        self.size, self.slack = size, (out[0] - width, out[1] - height)
        self.mouths = {
            s: ((mx - x0) * scale, (my - y0) * scale) for s, (mx, my, _) in mouths.items()
        }
        self.shapes = {s: _ellipses(w * scale) for s, (_, _, w) in mouths.items()}
        self.phase = rng.uniform(0, 2 * np.pi, 2)
        self.rate = rng.uniform(0.04, 0.12, 2)

    def frame(self, t: float, local: float, activity: dict[str, float]) -> np.ndarray:
        dx = round(
            self.slack[0] * (0.5 + 0.5 * math.sin(2 * np.pi * self.rate[0] * t + self.phase[0]))
        )
        dy = round(
            self.slack[1] * (0.5 + 0.5 * math.sin(2 * np.pi * self.rate[1] * t + self.phase[1]))
        )
        width, height = self.size
        frame = self.image[dy : dy + height, dx : dx + width].copy()
        for speaker, (mx, my) in self.mouths.items():
            level = round(activity.get(speaker, 0.0) * (MOUTH_LEVELS - 1))
            _stamp(frame, self.shapes[speaker][level], mx - dx, my - dy, (90, 30, 40))
        return frame


class Room:
    """A drawn room with the clip's speakers at a desk; cameras are crops of it."""

    def __init__(self, rng, clip: Clip, size):
        width, height = size
        self.size = size
        W, H = round(width * 1.5), round(height * 1.5)
        image = Image.fromarray(_gradient(W, H, _color(rng, 120, 230), _color(rng, 60, 160)))
        draw = ImageDraw.Draw(image)
        draw.rectangle((0, 0.78 * H, W, H), fill=_color(rng, 50, 120))
        wx = rng.uniform(0.05, 0.2) * W if rng.random() < 0.5 else rng.uniform(0.62, 0.78) * W
        sky = _gradient(round(0.2 * W), round(0.3 * H), (110, 170, 230), (210, 230, 250))
        image.paste(Image.fromarray(sky), (round(wx), round(0.12 * H)))
        draw.rectangle((wx, 0.12 * H, wx + 0.2 * W, 0.42 * H), outline=(240, 240, 240), width=10)
        for shelf in range(3):
            sy = (0.2 + 0.14 * shelf) * H
            sx = (0.82 if wx < W / 2 else 0.04) * W
            draw.rectangle((sx, sy, sx + 0.14 * W, sy + 12), fill=(110, 80, 50))
            bx = sx + 6
            while bx < sx + 0.13 * W:
                bw = int(rng.integers(10, 26))
                draw.rectangle((bx, sy - rng.integers(40, 80), bx + bw, sy), fill=_color(rng))
                bx += bw + 3
        px = rng.uniform(0.25, 0.7) * W
        draw.rectangle(
            (px, 0.08 * H, px + 0.12 * W, 0.24 * H), fill=_color(rng), outline=(40, 40, 40), width=6
        )
        draw.ellipse((px + 20, 0.1 * H, px + 0.07 * W, 0.2 * H), fill=_color(rng))
        r = 0.065 * H
        spots = {"A": 0.5} if clip.speakers == ("A",) else {"A": 0.32, "B": 0.68}
        spots = {s: spots.get(s, 0.5) for s in clip.speakers}
        self.mouths, self.boxes = {}, {"wide": (0.06 * W, 0.06 * H, 0.88 * W)}
        for speaker, sx in spots.items():
            x, head_y = sx * W, 0.47 * H
            _figure(draw, x, head_y, r, rng)
            self.mouths[speaker] = (x, head_y + 0.5 * r, 0.6 * r)
            cw = 0.42 * W
            self.boxes[speaker.lower()] = (x - cw / 2, head_y - 0.3 * cw * height / width, cw)
        draw.rectangle((0.15 * W, 0.7 * H, 0.85 * W, 0.8 * H), fill=_color(rng, 60, 140))
        self.boxes["close"] = self.boxes["a"]
        self.views = set(self.boxes)
        self.world = image
        self.grades = {"wide": (1, 1, 1), "a": (1.05, 1.0, 0.94), "b": (0.95, 1.0, 1.06)}

    def camera(self, view: str, rng) -> Camera:
        grade = self.grades.get(view, (1.02, 1.0, 0.98))
        return Camera(self.world, self.boxes[view], self.mouths, self.size, grade, rng)


class Street:
    """A selfie walk down a drawn street: the background pans and the frame bobs with each step."""

    views = {"street"}

    def __init__(self, rng, clip: Clip, size):
        self.size = size
        width, height = size
        W, H = width * 4, height + 120
        image = Image.fromarray(_gradient(W, H, (90, 150, 220), (200, 225, 245)))
        draw = ImageDraw.Draw(image)
        x = 0
        while x < W:
            bw, top = int(rng.integers(160, 360)), int(rng.integers(120, 520))
            draw.rectangle((x, top, x + bw, H), fill=_color(rng, 70, 200))
            for wy in range(top + 30, H - 260, 70):
                for wx in range(x + 20, x + bw - 40, 60):
                    draw.rectangle((wx, wy, wx + 30, wy + 40), fill=(230, 220, 160))
            if rng.random() < 0.4:
                draw.rectangle((x + 10, H - 330, x + bw - 10, H - 280), fill=_color(rng))
                draw.text((x + 20, H - 325), "CAFE", font=_font(36), fill=(255, 255, 255))
            x += bw + int(rng.integers(0, 30))
        draw.rectangle((0, H - 220, W, H), fill=(80, 80, 85))
        draw.rectangle((0, H - 240, W, H - 220), fill=(170, 170, 160))
        self.background = np.asarray(image)
        r = 0.2 * width
        sprite = Image.new("RGBA", (width, height))
        _figure(ImageDraw.Draw(sprite), width / 2, 0.5 * height, r, rng)
        rgba = np.asarray(sprite)
        rows, cols = np.nonzero(rgba[..., 3])
        self.top, self.left = rows.min(), cols.min()
        crop = rgba[self.top : rows.max() + 1, self.left : cols.max() + 1]
        self.mask, self.figure = crop[..., 3] > 0, crop[..., :3]
        self.mouth = (width / 2, 0.5 * height + 0.5 * r)
        self.shapes = _ellipses(0.6 * r)
        self.speaker = clip.speakers[0]
        self.walk = rng.uniform(0.6, 0.9) * (W - width)

    def camera(self, view: str, rng) -> "Street":
        return self

    def frame(self, t: float, local: float, activity: dict[str, float]) -> np.ndarray:
        width, height = self.size
        step = math.sin(2 * np.pi * 1.9 * t)
        x0 = round(8 + min(self.walk, 18 * t) + 8 * math.sin(2 * np.pi * 0.31 * t))
        y0 = round(60 + 40 * step)
        frame = self.background[y0 : y0 + height, x0 : x0 + width].copy()
        sway = round(10 * math.sin(2 * np.pi * 0.5 * t)), round(12 * step)
        _paste(frame, self.figure, self.mask, self.left + sway[0], self.top + sway[1])
        level = round(activity.get(self.speaker, 0.0) * (MOUTH_LEVELS - 1))
        _stamp(
            frame,
            self.shapes[level],
            self.mouth[0] + sway[0],
            self.mouth[1] + sway[1],
            (90, 30, 40),
        )
        return frame


TERMINAL = (
    ("$ cd ~/videos/project", True),
    ("$ ls", True),
    ("talk-a1.mp4   talk-a2.mp4   talk-a3.mp4   music/", False),
    ("$ vework analyze talk-a1.mp4 -o talk-a1.index.json", True),
    ("vework: probing", False),
    ("vework: detecting shots", False),
    ("vework: finding speech", False),
)
EDITOR = [
    '{"words": [',
    *(
        f'  {{"text": "{w}", "start": {1.2 + 0.31 * i:.2f}, "end": {1.45 + 0.31 * i:.2f}}},'
        for i, w in enumerate(
            "we use Claude to plan the edit and keep the best take of every line "
            "then render captions word by word with no clicks at the cuts and audio "
            "that stays in sync from the first frame to the last one".split()
            * 3
        )
    ),
    "]}",
]


class Screen:
    """A screen recording: a terminal, an editor, a settings form or a slide."""

    def __init__(self, kind: str, text, rng, size):
        self.kind, self.size = kind, size
        width, height = size
        self.pointer = rng.uniform(0, 2 * np.pi, 4), rng.uniform(0.05, 0.2, 2)
        if kind == "slide":
            image = Image.fromarray(
                _gradient(width, height, _color(rng, 20, 80), _color(rng, 10, 60))
            )
            draw = ImageDraw.Draw(image)
            draw.text((0.08 * width, 0.14 * height), text[0], font=_font(64), fill=(255, 255, 255))
            for i, line in enumerate(text[1:]):
                y = 0.36 * height + i * 0.12 * height
                draw.ellipse((0.09 * width, y + 14, 0.09 * width + 16, y + 30), fill=(250, 200, 80))
                draw.text((0.12 * width, y), line, font=_font(44), fill=(235, 235, 235))
            self.base = np.asarray(image)
            return
        image = Image.fromarray(_gradient(width, height, _color(rng, 40, 120), _color(rng, 20, 80)))
        draw = ImageDraw.Draw(image)
        dark = kind == "terminal"
        self.background = (30, 30, 34) if dark else (250, 250, 248)
        self.ink = (210, 230, 210) if dark else (40, 40, 60)
        self.area = (60, 90, width - 60, height - 50)
        draw.rounded_rectangle((40, 40, width - 40, height - 30), radius=12, fill=self.background)
        draw.rectangle((40, 40, width - 40, 76), fill=(70, 70, 76) if dark else (225, 225, 228))
        for i, c in enumerate(((240, 90, 80), (240, 190, 60), (90, 200, 90))):
            draw.ellipse((56 + 24 * i, 50, 70 + 24 * i, 64), fill=c)
        title = {"terminal": "zsh", "editor": "transcript.json", "settings": "Settings"}[kind]
        draw.text(
            (width / 2 - 60, 48),
            title,
            font=_font(20),
            fill=(200, 200, 200) if dark else (60, 60, 60),
        )
        if kind == "editor":
            draw.rectangle((40, 76, 260, height - 30), fill=(238, 238, 240))
            for i, name in enumerate(("index.json", "shots.json", "transcript.json", "edit.json")):
                draw.text((60, 100 + 34 * i), name, font=_font(20), fill=(60, 60, 60))
            self.area = (290, 90, width - 60, height - 50)
            page = Image.new(
                "RGB", (self.area[2] - self.area[0], 28 * len(EDITOR) + 600), self.background
            )
            pd = ImageDraw.Draw(page)
            for i, line in enumerate(EDITOR):
                pd.text((0, 28 * i), f"{i + 1:>3}  {line}", font=_font(20), fill=self.ink)
            self.page = np.asarray(page)
        if kind == "settings":
            for i, label in enumerate(("Model", "Output folder", "API key")):
                y = 130 + 90 * i
                draw.text((100, y), label, font=_font(24), fill=(60, 60, 60))
                draw.rectangle((340, y - 6, width - 140, y + 40), outline=(160, 160, 170), width=2)
            draw.text((356, 130), "claude-opus-5-5", font=_font(24), fill=(30, 30, 30))
            draw.text((356, 220), "~/videos/out", font=_font(24), fill=(30, 30, 30))
            self.dot = (356, 310 + 17)
            self.buttons = [
                _label(text, (140, 50), fill, 24)
                for text, fill in (("Save", (120, 120, 130)), ("Save", (60, 140, 230)))
            ]
            self.toast = _label("Saved", (340, 40), (60, 170, 90), 22)
        self.base = np.asarray(image)
        self.lines: dict[str, np.ndarray] = {}

    def _line(self, text: str) -> np.ndarray:
        if text not in self.lines:
            image = Image.new("RGB", (self.area[2] - self.area[0], 30), self.background)
            ImageDraw.Draw(image).text((0, 2), text, font=_font(22), fill=self.ink)
            self.lines[text] = np.asarray(image)
        return self.lines[text]

    def frame(self, t: float, local: float, activity: dict[str, float]) -> np.ndarray:
        if self.kind == "slide":
            return self.base
        frame = self.base.copy()
        x0, y0, x1, y1 = self.area
        if self.kind == "terminal":
            shown, clock = [], 0.5
            for text, typed in TERMINAL:
                if typed:
                    n = int((local - clock) * 14)  # typing speed, characters per second
                    shown.append(text[: max(0, min(len(text), n))])
                    clock += len(text) / 14 + 0.6
                elif local >= clock:
                    shown.append(text)
                    clock += 0.8
                if local < clock:
                    break
            progress = int(max(0.0, local - clock) / 2)
            shown += [f"vework: transcribing {i + 1}/40" for i in range(min(progress, 40))]
            rows = (y1 - y0) // 30
            for i, text in enumerate(shown[-rows:]):
                line = self._line(text)
                frame[y0 + 30 * i : y0 + 30 * i + 30, x0:x1] = line
        elif self.kind == "editor":
            scroll = round(min(max(0.0, local - 2) * 24, len(self.page) - (y1 - y0)))
            frame[y0:y1, x0:x1] = self.page[scroll : scroll + y1 - y0]
        elif self.kind == "settings":
            typed = int(min(32, max(0.0, local - 1.5) * 12))
            for i in range(typed):
                cx = self.dot[0] + 8 + 18 * i
                frame[self.dot[1] - 5 : self.dot[1] + 5, cx - 5 : cx + 5] = (30, 30, 30)
            saved = local > 1.5 + 32 / 12 + 1.0
            frame[y1 - 90 : y1 - 40, x1 - 220 : x1 - 80] = self.buttons[saved]
            if saved:
                frame[y1 - 160 : y1 - 120, x1 - 420 : x1 - 80] = self.toast
        phase, rate = self.pointer
        px = (0.5 + 0.35 * math.sin(2 * np.pi * rate[0] * t + phase[0])) * self.size[0]
        py = (0.5 + 0.3 * math.sin(2 * np.pi * rate[1] * t + phase[1])) * self.size[1]
        _stamp(frame, _ARROW, px + 10, py + 14, (20, 20, 20))
        return frame


_ARROW = np.tril(np.ones((28, 20), bool))  # a pointer's tip at its top left
